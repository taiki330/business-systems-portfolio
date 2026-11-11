/**
 * ログイン不要でスクリーンショットを撮るためのローカル代替サーバー。
 * ------------------------------------------------------------------
 * GASのWebアプリは「自分だけがアクセス可能」設定だとPlaywrightからログインが必要になる。
 * その回避策として、画面HTMLをそのままローカルで開けるようにする。
 *
 *   - GASのテンプレート構文 <?= ... ?> / <?!= include('X') ?> を展開する
 *   - google.script.run を差し替え、tools/manual/mocks/<画面キー>.json の
 *     ダミーデータを返す（用意が無い関数は null を返す＝空の状態が撮れる）
 *
 * あくまで「見た目を撮るための代替」。本番データでの見た目は --source=remote で撮ること。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { abs } from './lib/config.mjs';

export async function startMockServer(cfg) {
  const screensByKey = new Map(cfg.screens.map((s) => [s.key, s]));
  const mockDir = abs('tools/manual/mocks');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const key = url.pathname.replace(/^\/+|\/+$/g, '');
    const screen = screensByKey.get(key);
    if (!screen) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`未定義の画面キー: ${key}`);
      return;
    }
    try {
      const html = renderScreen(screen, url, mockDir, cfg);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(err.stack || err));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() };
}

function renderScreen(screen, url, mockDir, cfg) {
  let html = fs.readFileSync(abs(screen.html), 'utf8');

  const initParams = {
    page: screen.query?.page || screen.key,
    clinic: url.searchParams.get('clinic') || cfg.source.defaultQuery?.clinic || '',
    appUrl: '',
    productId: url.searchParams.get('p') || ''
  };

  // <?!= include('X') ?> → 対象ファイルの中身
  html = html.replace(/<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g, (_, name) => {
    const f = abs(`${name}.html`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  });

  // <?= 式 ?> → 評価結果（評価できないものは空文字）
  html = html.replace(/<\?!?=\s*([\s\S]*?)\s*\?>/g, (_, expr) => {
    try {
      // eslint-disable-next-line no-new-func
      return String(new Function('initParams', `return (${expr});`)(initParams) ?? '');
    } catch {
      return '';
    }
  });

  // 残ったスクリプトレット <? ... ?> は落とす
  html = html.replace(/<\?[\s\S]*?\?>/g, '');

  // _common.json（全画面共通のダミーデータ）に画面ごとのファイルを上書きする
  const fixture = JSON.stringify({
    ...readJson(path.join(mockDir, '_common.json')),
    ...readJson(path.join(mockDir, `${screen.key}.json`))
  });

  const stub = `<script>
  window.__MOCK__ = ${fixture};
  window.google = { script: { run: makeRunner(), host: { close: function(){}, setHeight: function(){} } } };
  function makeRunner(){
    var success = null;
    var base = {};
    var runner = new Proxy(base, {
      get: function(target, prop){
        if (prop === 'withSuccessHandler') return function(fn){ success = fn; return runner; };
        if (prop === 'withFailureHandler') return function(){ return runner; };
        if (prop === 'withUserObject') return function(){ return runner; };
        return function(){
          var data = Object.prototype.hasOwnProperty.call(window.__MOCK__, prop)
            ? window.__MOCK__[prop] : null;
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

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}
