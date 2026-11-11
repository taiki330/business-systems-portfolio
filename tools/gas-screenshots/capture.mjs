#!/usr/bin/env node
/**
 * Google Apps Script(GAS)の Web アプリ画面を、ログイン不要・ダミーデータで撮影するツール。
 *
 *   node tools/gas-screenshots/capture.mjs <設定ファイル.json>
 *
 * GAS の画面は google.script.run でサーバー関数を呼んで描画する。
 * このツールは
 *   1. GAS のテンプレート構文(<?= ?> / <?!= include() ?>)をローカルで展開し
 *   2. google.script.run を差し替えて、mocks/*.json のダミーデータを返し
 *   3. Playwright(Chromium)で撮影する。
 * 実データには一切触れない。
 *
 * 設定ファイルの例は各システムの screenshots.config.json を参照。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const cfgPath = path.resolve(process.argv[2] || '');
if (!fs.existsSync(cfgPath)) {
  console.error('使い方: node capture.mjs <設定ファイル.json>');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const base = path.dirname(cfgPath);
const abs = (p) => path.resolve(base, p);
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});

function render(page) {
  let html = fs.readFileSync(abs(page.html), 'utf8');
  const initParams = { page: page.name, clinic: '', appUrl: '', ...(page.initParams || {}) };

  html = html.replace(/<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g, (_, name) => {
    const f = abs(path.join(path.dirname(page.html), `${name}.html`));
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  });
  html = html.replace(/<\?!?=\s*([\s\S]*?)\s*\?>/g, (_, expr) => {
    try {
      return String(new Function('initParams', `return (${expr});`)(initParams) ?? '');
    } catch {
      return '';
    }
  });
  html = html.replace(/<\?[\s\S]*?\?>/g, '');

  const fixture = JSON.stringify({
    ...readJson(abs(cfg.commonMock || 'mocks/_common.json')),
    ...readJson(abs(page.mock || `mocks/${page.name}.json`))
  });
  const stub = `<script>
  window.__MOCK__ = ${fixture};
  window.google = { script: { run: makeRunner(), host: { close: function(){}, setHeight: function(){} } } };
  function makeRunner(){
    var success = null;
    var runner = new Proxy({}, {
      get: function(t, prop){
        if (prop === 'withSuccessHandler') return function(fn){ success = fn; return runner; };
        if (prop === 'withFailureHandler' || prop === 'withUserObject') return function(){ return runner; };
        return function(){
          var has = Object.prototype.hasOwnProperty.call(window.__MOCK__, prop);
          var data = has ? JSON.parse(JSON.stringify(window.__MOCK__[prop])) : null;
          var cb = success; success = null;
          setTimeout(function(){ if (cb) cb(data); }, 30);
        };
      }
    });
    return runner;
  }
</script>`;
  return html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${stub}`);
}

const pages = new Map(cfg.pages.map((p) => [p.name, p]));
const server = http.createServer((req, res) => {
  const key = new URL(req.url, 'http://x').pathname.replace(/^\/+|\/+$/g, '');
  const page = pages.get(key);
  if (!page) { res.writeHead(404); res.end('not found'); return; }
  try {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(render(page));
  } catch (e) {
    res.writeHead(500); res.end(String(e.stack || e));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const outDir = abs(cfg.outDir || 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: cfg.viewport || { width: 1100, height: 800 },
  deviceScaleFactor: cfg.deviceScaleFactor || 2,
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo'
});
let n = 0;
for (const page of cfg.pages) {
  if (only && page.name !== only) continue;
  const p = await ctx.newPage();
  await p.goto(`${baseUrl}/${page.name}`, { waitUntil: 'load' });
  await p.waitForTimeout(page.settleMs || 600);
  for (const act of page.actions || []) {
    if (act.click) await p.click(act.click);
    if (act.select) await p.selectOption(act.select[0], act.select[1]);
    if (act.fill) await p.fill(act.fill[0], act.fill[1]);
    await p.waitForTimeout(act.wait || 300);
  }
  const file = path.join(outDir, `${page.out || page.name}.png`);
  await p.screenshot({ path: file, fullPage: true });
  console.log('✓', path.relative(process.cwd(), file));
  n++;
  await p.close();
}
await browser.close();
server.close();
console.log(`完了: ${n} 枚`);
