/**
 * Supabase(PostgREST + Auth)の最小モックサーバー。
 * 実アプリ(Next.js)を Supabase なしで動かし、ダミーデータで画面を描画させるために使う。
 *
 *  - /rest/v1/<table>  : select / eq,neq,gt,gte,lt,lte,in,is,like,ilike,or,not / order / limit / offset
 *                        / 埋め込み(sites(name) など) / count / 単一行(Accept: vnd.pgrst.object)
 *  - /rest/v1/rpc/<fn> : fixtures.rpc[fn] を返す(関数なら引数を渡す)
 *  - /auth/v1/user     : ダミーの管理者ユーザー
 * 書き込み(POST/PATCH/DELETE)は何もせず成功を返す。
 */
import http from 'node:http';

const singular = (s) => s.replace(/ies$/, 'y').replace(/(ch|sh|x|ss)es$/, '$1').replace(/s$/, '');

export function startMockSupabase({ tables, rpc = {}, users, port = 54321 }) {
  const rel = (row, table, name, hintFk) => {
    // 多対1: row.<name>_id / row.<singular>_id、1対多: 相手表の <singular(table)>_id
    const target = tables[name];
    if (!target) return undefined;
    const ALIAS = { product_categories: 'category_id' };
    const fk = hintFk && row[hintFk] !== undefined ? hintFk : [ALIAS[name], `${singular(name)}_id`, `${name}_id`].find((k) => k && k in row);
    if (fk) return target.find((t) => t.id === row[fk]) ?? null;
    const back = `${singular(table)}_id`;
    return target.filter((t) => t[back] === row.id);
  };

  // select 文字列のトップレベルを分割(括弧内のカンマは無視)
  const splitTop = (s) => {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };

  const embed = (row, table, select) => {
    const res = { ...row };
    for (const part of splitTop(select)) {
      const m = part.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\s*\(([\s\S]*)\)$/);
      if (!m) continue;
      const [, alias, name, hint, inner] = m;
      let tbl = name;
      if (inner.trim() === 'count') { const r0 = rel(row, table, name); res[alias ?? name] = [{ count: Array.isArray(r0) ? r0.length : 0 }]; continue; }
      let r = rel(row, table, tbl, hint && /_id$/.test(hint) ? hint : undefined);
      if (r === undefined && alias) r = rel(row, table, alias);
      if (r === undefined) { res[alias ?? name] = null; continue; }
      const sub = (x) => (x ? embed(x, tbl, inner) : x);
      res[alias ?? name] = Array.isArray(r) ? r.map(sub) : sub(r);
    }
    return res;
  };

  const coerce = (v) => (v === undefined || v === null ? v : v);
  const cmp = (a, b) => {
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'string') return na - nb;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  };

  const test = (row, col, op, val) => {
    if (col.includes('.')) return true; // 埋め込み先の絞り込みは無視
    const v = coerce(row[col]);
    switch (op) {
      case 'eq': return String(v) === val;
      case 'neq': return String(v) !== val;
      case 'gt': return cmp(v, val) > 0 && v != null;
      case 'gte': return cmp(v, val) >= 0 && v != null;
      case 'lt': return cmp(v, val) < 0 && v != null;
      case 'lte': return cmp(v, val) <= 0 && v != null;
      case 'is': return val === 'null' ? v == null : val === 'true' ? v === true : val === 'false' ? v === false : true;
      case 'in': return val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v));
      case 'like': case 'ilike': {
        const re = new RegExp('^' + val.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
        return re.test(String(v ?? ''));
      }
      default: return true;
    }
  };
  const parseCond = (c) => {
    const m = c.match(/^([\w.]+)\.(not\.)?(\w+)\.([\s\S]*)$/);
    if (!m) return () => true;
    const [, col, neg, op, val] = m;
    return (row) => (neg ? !test(row, col, op, val) : test(row, col, op, val));
  };
  const parseOr = (expr) => {
    const conds = splitTop(expr.replace(/^\(|\)$/g, '')).map(parseCond);
    return (row) => conds.some((f) => f(row));
  };

  const query = (table, params, method, accept) => {
    let rows = tables[table];
    if (!rows) return { status: 404, body: { message: `no mock table: ${table}` } };
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'or') { const f = parseOr(v); rows = rows.filter(f); continue; }
      const m = v.match(/^(not\.)?(\w+)\.([\s\S]*)$/);
      if (!m) continue;
      rows = rows.filter((r) => (m[1] ? !test(r, k, m[2], m[3]) : test(r, k, m[2], m[3])));
    }
    const total = rows.length;
    const order = params.get('order');
    if (order) {
      const keys = order.split(',').map((o) => { const [c, ...f] = o.split('.'); return { c, desc: f.includes('desc') }; });
      rows = [...rows].sort((a, b) => {
        for (const { c, desc } of keys) { const d = cmp(a[c], b[c]); if (d) return desc ? -d : d; }
        return 0;
      });
    }
    const off = Number(params.get('offset') ?? 0);
    if (params.has('limit')) rows = rows.slice(off, off + Number(params.get('limit')));
    else if (off) rows = rows.slice(off);
    const select = params.get('select') ?? '*';
    rows = rows.map((r) => embed(r, table, select));
    return { status: 200, rows, total };
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const p = url.pathname;
      if (p === '/auth/v1/user') {
        // Authorization: Bearer <jwt> の sub から対象ユーザーを決める
        let sub;
        try { sub = JSON.parse(Buffer.from(String(req.headers.authorization ?? '').split('.')[1], 'base64url').toString()).sub; } catch {}
        const u = users.find((x) => x.id === sub);
        return u ? send(200, u) : send(401, { code: 401, msg: 'invalid JWT' });
      }
      if (p.startsWith('/auth/v1/')) return send(200, {});
      const rpcM = p.match(/^\/rest\/v1\/rpc\/(\w+)/);
      if (rpcM) {
        const f = rpc[rpcM[1]];
        let args = {};
        try { args = raw ? JSON.parse(raw) : {}; } catch {}
        const out = typeof f === 'function' ? f(args, tables) : f;
        if (out === undefined) console.log('[mock] rpc 未定義:', rpcM[1]);
        return send(200, out === undefined ? null : out);
      }
      const t = p.match(/^\/rest\/v1\/(\w+)/);
      if (!t) return send(404, { message: 'not found' });
      if (req.method === 'GET' || req.method === 'HEAD') {
        const r = query(t[1], url.searchParams, req.method, req.headers.accept);
        if (r.status !== 200) { console.log('[mock] ' + r.body.message); return send(r.status, r.body); }
        const prefer = String(req.headers.prefer ?? '');
        const range = `0-${Math.max(r.rows.length - 1, 0)}/${prefer.includes('count=') ? r.total : '*'}`;
        if (String(req.headers.accept ?? '').includes('vnd.pgrst.object')) {
          return r.rows.length === 1
            ? send(200, r.rows[0])
            : send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${r.rows.length} rows` });
        }
        return send(200, req.method === 'HEAD' ? undefined : r.rows, { 'content-range': range });
      }
      return send(201, []);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
