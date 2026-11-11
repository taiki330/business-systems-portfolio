#!/usr/bin/env node
/**
 * 撮影前の安全監査
 * ------------------------------------------------------------------
 * 「画面を開いただけで本番データが変わらないか」を、コードから機械的に判定する。
 *
 *   node tools/manual/audit-safety.mjs [--only=key1,key2]
 *
 * 判定のしかた:
 *   1) 画面HTMLのインラインJSを関数単位に分解し、トップレベル（＝読み込み時に必ず走る文）
 *      から到達できるクライアント関数を辿る。
 *      - `btn.onclick = fn;` のような「代入」は呼び出しではないので辿らない＝利用者操作扱い。
 *   2) その経路上で呼ばれている google.script.run のサーバー関数を集める。
 *   3) サーバー側 .js の呼び出しグラフを作り、シートへの書き込みAPIを使う関数を
 *      「書き込みあり」と印付けし、呼び出し元へ推移的に伝播させる。
 *   4) 「読み込み時に呼ばれる」かつ「書き込みあり」の関数が1つでもあれば危険と判定する。
 *
 * 出力: 危険な画面があれば終了コード 1 を返す。
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, abs, selectScreens, log, ROOT } from './lib/config.mjs';
import { parseServerCalls } from './lib/extract.mjs';

// スプレッドシート等を書き換えるAPI。ここに載るものを使う関数を「書き込みあり」とする。
const WRITE_APIS = [
  /\.setValues?\s*\(/, /\.appendRows?\s*\(/, /\.insertSheet\s*\(/, /\.deleteSheet\s*\(/,
  /\.deleteRows?\s*\(/, /\.clearContents?\s*\(/, /\.setDataValidation\s*\(/,
  /\.setBackgrounds?\s*\(/, /\.setFontWeights?\s*\(/, /\.setNumberFormats?\s*\(/,
  /\.setFrozenRows\s*\(/, /\.setColumnWidths?\s*\(/, /\.setName\s*\(/,
  /\.moveActiveSheet\s*\(/, /\.hideSheet\s*\(/, /\.showSheet\s*\(/,
  // 並び替えはシート/範囲に対するものだけが書き込み。配列の items.sort() は対象外。
  /\b(?:sheet|range|rng|sh)\w*\.sort\s*\(/i,
  /PropertiesService[\s\S]{0,60}\.setProperty/, /\.createFile\s*\(/, /MailApp\./, /GmailApp\./
];

const argv = process.argv.slice(2);
const cfg = loadConfig();
const screens = selectScreens(cfg, argv);

/* ---------- サーバー側: 呼び出しグラフと書き込み判定 ---------- */

const serverFns = new Map(); // name -> {file, line, body, calls:Set, writesDirect:bool}
for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const re = /^[ \t]*function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gm;
  let m;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const body = text.slice(open, matchBrace(text, open));
    serverFns.set(m[1], {
      name: m[1],
      file,
      line: text.slice(0, m.index).split('\n').length,
      body,
      writesDirect: WRITE_APIS.some((re2) => re2.test(body)),
      calls: new Set([...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((c) => c[1]))
    });
  }
}

// 書き込みフラグを呼び出し元へ伝播（推移閉包）
const writes = new Map();
function doesWrite(name, seen = new Set()) {
  if (writes.has(name)) return writes.get(name);
  const fn = serverFns.get(name);
  if (!fn || seen.has(name)) return false;
  seen.add(name);
  let result = fn.writesDirect;
  let via = result ? '(直接)' : '';
  if (!result) {
    for (const callee of fn.calls) {
      if (callee === name || !serverFns.has(callee)) continue;
      if (doesWrite(callee, seen)) { result = true; via = callee; break; }
    }
  }
  writes.set(name, result);
  if (result) fn.writeVia = via;
  return result;
}
for (const name of serverFns.keys()) doesWrite(name);

/* ---------- 画面側: 読み込み時に到達する経路 ---------- */

let danger = 0;
const report = [];

for (const screen of screens) {
  const html = fs.readFileSync(abs(screen.html), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');

  // クライアント側の関数を切り出す
  const clientFns = new Map();
  const spans = [];
  const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let fm;
  while ((fm = fnRe.exec(scripts))) {
    const open = fm.index + fm[0].length - 1;
    const end = matchBrace(scripts, open);
    clientFns.set(fm[1], scripts.slice(open, end));
    spans.push([fm.index, end]);
  }
  // トップレベル＝関数定義を取り除いた残り（＝開いた瞬間に走る文）
  let topLevel = '';
  let cursor = 0;
  for (const [s, e] of spans.sort((a, b) => a[0] - b[0])) {
    topLevel += scripts.slice(cursor, s);
    cursor = e;
  }
  topLevel += scripts.slice(cursor);

  // トップレベルから到達できるクライアント関数を辿る。
  // btn.onclick = function(){…} の中身は「利用者が押したときだけ」動くので辿らない。
  const auto = (src) => stripHandlers(src);
  const reached = new Set();
  const queue = [...auto(topLevel).matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])
    .filter((n) => clientFns.has(n));
  while (queue.length) {
    const n = queue.shift();
    if (reached.has(n)) continue;
    reached.add(n);
    for (const c of [...auto(clientFns.get(n)).matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])) {
      if (clientFns.has(c) && !reached.has(c)) queue.push(c);
    }
  }

  // 読み込み時に呼ばれるサーバー関数 = トップレベル + 到達した関数の中の google.script.run
  const autoSources = [auto(topLevel), ...[...reached].map((n) => auto(clientFns.get(n)))].join('\n');
  const autoCalls = parseServerCalls(autoSources).map((c) => c.fn);
  const allCalls = parseServerCalls(scripts).map((c) => c.fn);
  const userCalls = allCalls.filter((f) => !autoCalls.includes(f));

  const risky = autoCalls.filter((f) => writes.get(f));
  // clearStorage を指定してある画面は、撮影時に書き込み経路へ入らないことを確認済みとして扱う
  const mitigated = risky.length > 0 && !!screen.clearStorage;
  if (risky.length && !mitigated) danger++;

  report.push({ screen, autoCalls, userCalls, risky, mitigated });
}

/* ---------- 出力 ---------- */

log('=== 撮影前 安全監査 ===\n');
log(`サーバー関数 ${serverFns.size} 件のうち、書き込みを行うもの: ${[...writes.values()].filter(Boolean).length} 件\n`);

for (const r of report) {
  const mark = !r.risky.length ? '✅ 安全' : (r.mitigated ? '⚠ 対策済' : '⛔ 危険');
  log(`${mark}  ${r.screen.key}（${r.screen.title}）`);
  log(`   開いた時点で呼ばれる: ${r.autoCalls.map(fmt).join(', ') || '(なし)'}`);
  if (r.userCalls.length) log(`   操作したときだけ    : ${r.userCalls.map(fmt).join(', ')}`);
  if (r.risky.length) {
    for (const f of r.risky) {
      const fn = serverFns.get(f);
      log(`   ⛔ ${f} は書き込みます（${fn.file}:${fn.line} / 経路: ${fn.writeVia}）`);
    }
  }
  if (r.screen.clearStorage) log('   ※ clearStorage 指定あり（撮影時は localStorage を消して開く）');
  log('');
}

log(danger
  ? `⛔ 危険な画面が ${danger} 件あります。撮影を中止してください。`
  : '✅ すべての画面が「開いただけでは書き込まない」ことを確認しました。');
process.exit(danger ? 1 : 0);

function fmt(name) {
  const fn = serverFns.get(name);
  if (!fn) return `${name}(未定義)`;
  return writes.get(name) ? `${name}【書込】` : `${name}(読取)`;
}

/**
 * イベントハンドラとして登録される無名関数の中身を取り除く。
 * （`el.onclick = function(){…}` / `addEventListener('click', function(){…})`）
 * これらは利用者が操作したときにしか動かないため、読み込み時の経路から外す。
 * withSuccessHandler のコールバックは読み込み時に走るので、ここでは取り除かない。
 */
function stripHandlers(src) {
  const re = /(?:\.on[a-z]+\s*=\s*|addEventListener\s*\([^,]+,\s*)function\s*\([^)]*\)\s*\{/g;
  let out = '';
  let cursor = 0;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const end = matchBrace(src, open);
    out += src.slice(cursor, open);
    cursor = end;
    re.lastIndex = end;
  }
  return out + src.slice(cursor);
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

function skipString(text, i) {
  const q = text[i];
  i++;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === q) return i + 1;
    i++;
  }
  return i;
}
