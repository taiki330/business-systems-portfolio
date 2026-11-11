/**
 * コード解析（証拠抽出）
 * ------------------------------------------------------------------
 * マニュアル本文を「推測で書かない」ようにするための土台。
 * 画面HTMLとサーバー側スクリプトから、実際にコードへ書かれている事実だけを
 * 機械的に拾い出す。ここで拾えなかったものは、マニュアルに書いてはいけない。
 *
 * 拾うもの:
 *   - 見出し（h1/h2）
 *   - 入力欄・ボタン・チェックボックス等（静的HTML／JSが組み立てるHTMLの両方）
 *   - <select> の選択肢
 *   - confirm() / alert() / prompt() の文言 = 操作時の確認・警告
 *   - 画面に出るメッセージ（toast等の文字列リテラル）
 *   - google.script.run から呼ばれるサーバー関数と、その引数式
 *   - サーバー関数のJSDoc・シグネチャ・throw されるエラーメッセージ = 注意事項の根拠
 *   - localStorage のキー（画面をまたいで引き継がれる情報）
 *   - 他画面へのリンク（?page=...）
 */
import fs from 'node:fs';
import path from 'node:path';

const HANDLER_NAMES = new Set([
  'withSuccessHandler', 'withFailureHandler', 'withUserObject', 'run'
]);

/* ------------------------------------------------------------------ */
/* 低レベルユーティリティ                                              */
/* ------------------------------------------------------------------ */

/** 文字列リテラルの終端まで飛ばす（i は開始クォート位置） */
function skipString(text, i) {
  const quote = text[i];
  i++;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/** タグ文字列から属性を取り出す */
function parseAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  // 値なし属性（required, disabled, checked, multiple）
  for (const flag of ['required', 'disabled', 'checked', 'multiple', 'readonly']) {
    if (new RegExp(`\\b${flag}\\b(?!\\s*=)`, 'i').test(tag)) attrs[flag] = 'true';
  }
  return attrs;
}

/** HTMLタグを除いた素のテキスト */
function stripTags(s) {
  return s.replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** <script> ブロックの範囲一覧 */
function scriptRanges(text) {
  const ranges = [];
  const re = /<script\b[^>]*>/gi;
  let m;
  while ((m = re.exec(text))) {
    const end = text.indexOf('</script>', m.index);
    ranges.push([m.index, end < 0 ? text.length : end]);
  }
  return ranges;
}

function inRanges(ranges, pos) {
  return ranges.some(([s, e]) => pos >= s && pos <= e);
}

/* ------------------------------------------------------------------ */
/* 画面HTMLの解析                                                      */
/* ------------------------------------------------------------------ */

export function extractHtml(htmlText) {
  const scripts = scriptRanges(htmlText);
  const isDynamic = (pos) => inRanges(scripts, pos);

  /* --- 見出し --- */
  const headings = [];
  const hRe = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let hm;
  while ((hm = hRe.exec(htmlText))) {
    const textValue = stripTags(hm[2]);
    if (!textValue) continue;
    headings.push({ level: hm[1].toLowerCase(), text: textValue, dynamic: isDynamic(hm.index) });
  }

  /* --- ボタン（テキスト付き） --- */
  const controls = [];
  const btnRe = /<button\b([^>]*)>([\s\S]{0,200}?)<\/button>/gi;
  let bm;
  const btnPositions = new Set();
  while ((bm = btnRe.exec(htmlText))) {
    btnPositions.add(bm.index);
    const attrs = parseAttrs(bm[1]);
    controls.push({
      tag: 'button',
      label: stripTags(bm[2]) || attrs.title || '(テキストは実行時に決まる)',
      id: attrs.id || '',
      class: attrs.class || '',
      onclick: attrs.onclick || '',
      dynamic: isDynamic(bm.index),
      context: contextOf(htmlText, bm.index)
    });
  }

  /* --- input / select / textarea --- */
  const ctrlRe = /<(input|select|textarea)\b([^>]*)>/gi;
  let cm;
  while ((cm = ctrlRe.exec(htmlText))) {
    const tag = cm[1].toLowerCase();
    const attrs = parseAttrs(cm[2]);
    const entry = {
      tag,
      type: attrs.type || (tag === 'input' ? 'text' : ''),
      id: attrs.id || '',
      name: attrs.name || '',
      class: attrs.class || '',
      placeholder: attrs.placeholder || '',
      value: attrs.value || '',
      min: attrs.min ?? '',
      max: attrs.max ?? '',
      step: attrs.step ?? '',
      required: attrs.required === 'true',
      disabled: attrs.disabled === 'true',
      checked: attrs.checked === 'true',
      dynamic: isDynamic(cm.index),
      context: contextOf(htmlText, cm.index)
    };
    if (tag === 'select') entry.options = optionsAfter(htmlText, cm.index);
    controls.push(entry);
  }

  /* --- ダイアログ文言 --- */
  const dialogs = [];
  const dlgRe = /\b(confirm|alert|prompt)\s*\(\s*(['"])((?:[^\\]|\\.)*?)\2/g;
  let dm;
  while ((dm = dlgRe.exec(htmlText))) {
    dialogs.push({ kind: dm[1], text: unescapeJs(dm[3]), suffix: trailingConcat(htmlText, dlgRe.lastIndex) });
  }

  /* --- 画面メッセージ（toast / textContent / innerHTML の日本語リテラル） --- */
  const messages = [];
  for (const msgRe of [/'((?:[^'\\\n]|\\.)*)'/g, /"((?:[^"\\\n]|\\.)*)"/g]) {
    let mm;
    while ((mm = msgRe.exec(htmlText))) {
      if (!isDynamic(mm.index)) continue;
      const value = stripTags(unescapeJs(mm[1])).trim();
      if (value.length < 4) continue;
      if (!/[ぁ-んァ-ヶ一-龠]/.test(value)) continue;
      if (messages.some((x) => x.text === value)) continue;
      messages.push({ text: value });
    }
  }

  /* --- サーバー関数呼び出し --- */
  const serverCalls = parseServerCalls(htmlText);

  /* --- localStorage キー --- */
  const storageKeys = [...new Set(
    [...htmlText.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*(?:(['"])(.*?)\1|([A-Za-z_$][\w$]*))/g)]
      .map((m) => m[2] || constantValue(htmlText, m[3]) || `(変数) ${m[3]}`)
  )];

  /* --- 他画面へのリンク --- */
  const pageLinks = [...new Set(
    [...htmlText.matchAll(/[?&]page=([A-Za-z0-9_]+)|link\(\s*'([a-z]+)'/g)]
      .map((m) => m[1] || m[2]).filter(Boolean)
  )];

  /* --- GASテンプレート式（サーバーから渡される値） --- */
  const templateExprs = [...new Set(
    [...htmlText.matchAll(/<\?!?=?\s*([\s\S]*?)\s*\?>/g)].map((m) => m[1].trim())
  )];

  return { headings, controls, dialogs, messages, serverCalls, storageKeys, pageLinks, templateExprs };
}

/** 直前の非タグテキストを少しだけ添える（ラベル推定の材料。断定はしない） */
function contextOf(text, pos) {
  const before = stripTags(text.slice(Math.max(0, pos - 160), pos));
  return before.slice(-60);
}

function optionsAfter(text, pos) {
  const end = text.indexOf('</select>', pos);
  if (end < 0) return [];
  const block = text.slice(pos, end);
  return [...block.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)].map((m) => stripTags(m[1]));
}

/** `var NAME = 'value'` の形で定義された定数の値を引く */
function constantValue(text, name) {
  if (!name) return '';
  const m = new RegExp(`\\b(?:var|let|const)\\s+${name}\\s*=\\s*(['"])(.*?)\\1`).exec(text);
  return m ? m[2] : '';
}

function unescapeJs(s) {
  return s.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** 'あ' + 変数 + 'い' のような連結の続きがあるかを示す */
function trailingConcat(text, from) {
  const tail = text.slice(from, from + 60);
  return /^\s*\+/.test(tail) ? '…(可変部分あり)' : '';
}

/**
 * google.script.run チェーンを解析し、最終的に呼ばれるサーバー関数名と引数式を返す。
 * 文字列・括弧の入れ子を追いながら走査するので、複数行チェーンでも正しく取れる。
 */
export function parseServerCalls(text) {
  const calls = [];
  const marker = 'google.script.run';
  let start = text.indexOf(marker);
  while (start >= 0) {
    let i = start + marker.length;
    let depth = 0;
    const chain = [];
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i); continue; }
      if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i) + 1 || text.length; continue; }
      if (ch === '(' || ch === '[' || ch === '{') { depth++; i++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') {
        depth--; i++;
        if (depth < 0) break;
        continue;
      }
      if (depth === 0 && (ch === ';' || ch === '\n' && chain.length && /[^.\s]/.test(text[i - 1] || ''))) {
        if (ch === ';') break;
      }
      if (ch === '.' && depth === 0) {
        const m = /^\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(text.slice(i, i + 200));
        if (m) {
          const argStart = i + m[0].length;
          chain.push({ name: m[1], argStart });
          i = argStart;
          depth++;
          continue;
        }
      }
      i++;
    }
    const target = [...chain].reverse().find((c) => !HANDLER_NAMES.has(c.name));
    if (target) {
      calls.push({ fn: target.name, args: argText(text, target.argStart) });
    }
    start = text.indexOf(marker, start + marker.length);
  }
  // 同じ関数の重複はまとめる
  const seen = new Map();
  for (const c of calls) {
    if (!seen.has(c.fn)) seen.set(c.fn, c);
  }
  return [...seen.values()];
}

function argText(text, from) {
  let i = from;
  let depth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i); continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break;
      depth--;
    }
    i++;
  }
  return text.slice(from, i).replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* サーバー側スクリプトの解析                                          */
/* ------------------------------------------------------------------ */

/** プロジェクト内の全 .js から「関数名 → 定義情報」の索引を作る */
export function indexServerFunctions(files) {
  const index = new Map();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /^[ \t]*function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gm;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1];
      const bodyStart = m.index + m[0].length - 1;
      const bodyEnd = matchBrace(text, bodyStart);
      const body = text.slice(bodyStart, bodyEnd);
      index.set(name, {
        name,
        params: m[2].split(',').map((s) => s.trim()).filter(Boolean),
        file: path.basename(file),
        line: text.slice(0, m.index).split('\n').length,
        jsdoc: jsdocAbove(text, m.index),
        throws: [...body.matchAll(/throw new Error\(\s*(['"])((?:[^\\]|\\.)*?)\1(\s*\+)?/g)]
          .map((t) => unescapeJs(t[2]) + (t[3] ? '…(具体的な値が続く)' : '')),
        returnsShape: firstReturnShape(body)
      });
    }
  }
  return index;
}

function matchBrace(text, openPos) {
  let depth = 0;
  let i = openPos;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i); continue; }
    if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i) + 1 || text.length; continue; }
    if (ch === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 2; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return text.length;
}

function jsdocAbove(text, pos) {
  const before = text.slice(0, pos).trimEnd();
  if (!before.endsWith('*/')) return '';
  const open = before.lastIndexOf('/**');
  if (open < 0) return '';
  return before.slice(open)
    .replace(/^\/\*\*/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*+\s?/, '').trim())
    .filter((l) => l !== '')
    .join('\n');
}

function firstReturnShape(body) {
  const m = /return\s*\{([^}]{0,300})\}/.exec(body);
  return m ? `{ ${m[1].replace(/\s+/g, ' ').trim()} }` : '';
}

/* ------------------------------------------------------------------ */
/* Markdown（証拠ファイル）の組み立て                                  */
/* ------------------------------------------------------------------ */

export function renderEvidence(screen, html, fnIndex, meta) {
  const L = [];
  const p = (s = '') => L.push(s);

  p(`# 証拠ファイル: ${screen.title}（${screen.key}）`);
  p();
  p('> このファイルは `npm run manual:evidence` が自動生成します。手で編集しないでください。');
  p('> **マニュアルに書いてよいのは、ここに載っている事実とスクリーンショットで確認できる事実だけです。**');
  p();
  p('## 基本情報');
  p();
  p(`- 画面キー: \`${screen.key}\``);
  p(`- HTMLファイル: [${screen.html}](../../../${screen.html})`);
  p(`- 関連スクリプト: ${(meta.scriptFiles || []).map((f) => `\`${f}\``).join(', ') || '(なし)'}`);
  p(`- URL: \`${meta.url}\``);
  if (screen.note) p(`- 補足: ${screen.note}`);
  p(`- スクリーンショット: ${meta.hasShot ? `\`${meta.shotPath}\`` : '**未取得**（`npm run manual:capture` を実行）'}`);
  p();

  p('## 画面に固定で書かれている見出し');
  p();
  for (const h of html.headings) {
    p(`- \`${h.level}\` ${h.text}${h.dynamic ? '　※JSが動的に出力' : ''}`);
  }
  if (!html.headings.length) p('- (なし)');
  p();

  p('## 入力欄・ボタン・選択肢');
  p();
  p('| 種類 | 表示/ID | 属性 | 動的 | 近くのテキスト |');
  p('| --- | --- | --- | --- | --- |');
  for (const c of html.controls) {
    const kind = c.tag === 'button' ? 'ボタン' : `${c.tag}${c.type ? `(${c.type})` : ''}`;
    const shown = c.tag === 'button' ? c.label : (c.id || c.class || c.name || '-');
    const attrs = [];
    if (c.placeholder) attrs.push(`placeholder="${c.placeholder}"`);
    if (c.min !== '' && c.min != null) attrs.push(`min=${c.min}`);
    if (c.max !== '' && c.max != null) attrs.push(`max=${c.max}`);
    if (c.step !== '' && c.step != null) attrs.push(`step=${c.step}`);
    if (c.required) attrs.push('必須');
    if (c.checked) attrs.push('初期チェックON');
    if (c.disabled) attrs.push('初期無効');
    if (c.value) attrs.push(`value="${c.value}"`);
    if (c.options?.length) attrs.push(`選択肢: ${c.options.join(' / ')}`);
    if (c.onclick) attrs.push(`onclick=${c.onclick}`);
    p(`| ${kind} | ${md(shown)} | ${md(attrs.join(' , ') || '-')} | ${c.dynamic ? 'JS生成' : '静的'} | ${md(c.context || '-')} |`);
  }
  p();

  p('## 操作時に出る確認・警告ダイアログ');
  p();
  for (const d of html.dialogs) {
    p(`- \`${d.kind}()\`: 「${d.text}${d.suffix}」`);
  }
  if (!html.dialogs.length) p('- (なし)');
  p();

  p('## 画面に表示されるメッセージ（コード内の日本語リテラル）');
  p();
  for (const m of html.messages) p(`- 「${m.text}」`);
  if (!html.messages.length) p('- (なし)');
  p();

  p('## 呼び出しているサーバー関数');
  p();
  for (const call of html.serverCalls) {
    const def = fnIndex.get(call.fn);
    p(`### \`${call.fn}(${call.args})\``);
    p();
    if (!def) {
      p('- **定義が見つかりません**（関数名の誤りか、解析対象外のファイルにある可能性）');
      p();
      continue;
    }
    p(`- 定義: \`${def.file}\` ${def.line}行目 — \`function ${def.name}(${def.params.join(', ')})\``);
    if (def.jsdoc) {
      p('- 説明（JSDoc）:');
      p();
      p('  ```');
      for (const line of def.jsdoc.split('\n')) p(`  ${line}`);
      p('  ```');
    }
    if (def.returnsShape) p(`- 戻り値の形: \`${def.returnsShape}\``);
    if (def.throws.length) {
      p('- **エラーになる条件（そのままエラーメッセージとして利用者に表示される）**:');
      for (const t of def.throws) p(`  - 「${t}」`);
    }
    p();
  }
  if (!html.serverCalls.length) { p('- (なし)'); p(); }

  p('## 画面をまたいで引き継がれる情報（localStorage）');
  p();
  for (const k of html.storageKeys) p(`- \`${k}\``);
  if (!html.storageKeys.length) p('- (なし)');
  p();

  p('## この画面から行ける画面');
  p();
  for (const k of html.pageLinks) p(`- \`?page=${k}\``);
  if (!html.pageLinks.length) p('- (なし)');
  p();

  p('## サーバーから渡される値（GASテンプレート式）');
  p();
  for (const e of html.templateExprs) p(`- \`<?= ${e} ?>\``);
  if (!html.templateExprs.length) p('- (なし)');
  p();

  return L.join('\n');
}

function md(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
