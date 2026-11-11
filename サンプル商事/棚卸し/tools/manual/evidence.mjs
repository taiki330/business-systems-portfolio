#!/usr/bin/env node
/**
 * 画面ごとの「証拠ファイル」を生成する。
 *   node tools/manual/evidence.mjs [--only=receive,stock]
 *
 * 出力先: tools/manual/.evidence/<key>.md
 * マニュアル本文を書くときは、この証拠ファイルとスクリーンショットだけを根拠にする。
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, abs, ensureDir, selectScreens, argFlag, log, ROOT } from './lib/config.mjs';
import { extractHtml, indexServerFunctions, renderEvidence } from './lib/extract.mjs';

const argv = process.argv.slice(2);
const cfg = loadConfig();
const screens = selectScreens(cfg, argv);

const evidenceDir = ensureDir(abs(cfg.output.evidenceDir));
const shotDir = abs(cfg.capture.outDir);

// 解析対象の .js を集める（tools/ と node_modules/ は除外）
const scriptFiles = collectScripts(cfg.source.scriptDirs || ['.']);
const fnIndex = indexServerFunctions(scriptFiles);
log(`サーバー関数 ${fnIndex.size} 件を ${scriptFiles.length} ファイルから索引化しました。`);

let ok = 0;
for (const screen of screens) {
  const htmlPath = abs(screen.html);
  if (!fs.existsSync(htmlPath)) {
    console.error(`× ${screen.key}: HTMLが見つかりません → ${screen.html}`);
    continue;
  }
  const htmlText = fs.readFileSync(htmlPath, 'utf8');
  const parsed = extractHtml(htmlText);

  const shotPath = path.join(shotDir, `${screen.key}.png`);
  const meta = {
    url: buildUrl(cfg, screen),
    scriptFiles: resolveScripts(screen, parsed, fnIndex),
    hasShot: fs.existsSync(shotPath),
    shotPath: path.relative(ROOT, shotPath).replace(/\\/g, '/')
  };

  const out = path.join(evidenceDir, `${screen.key}.md`);
  fs.writeFileSync(out, renderEvidence(screen, parsed, fnIndex, meta), 'utf8');
  log(`✓ ${screen.key.padEnd(14)} 入力欄/ボタン ${String(parsed.controls.length).padStart(3)} 件 / サーバー関数 ${parsed.serverCalls.length} 件 → ${path.relative(ROOT, out)}`);
  ok++;
}

log(`\n完了: ${ok}/${screens.length} 画面`);
if (screens.some((s) => !fs.existsSync(path.join(shotDir, `${s.key}.png`)))) {
  log('※ スクリーンショット未取得の画面があります。`npm run manual:capture` を先に実行してください。');
}

/* ---------------------------------------------------------------- */

function collectScripts(dirs) {
  const files = [];
  for (const dir of dirs) {
    for (const entry of fs.readdirSync(abs(dir), { withFileTypes: true })) {
      if (entry.isDirectory()) continue;
      if (!entry.name.endsWith('.js')) continue;
      files.push(path.join(abs(dir), entry.name));
    }
  }
  return files;
}

/** 呼び出しているサーバー関数が実際に定義されているファイルを実測で求める */
function resolveScripts(screen, parsed, fnIndex) {
  const found = new Set(screen.scripts || []);
  for (const c of parsed.serverCalls) {
    const def = fnIndex.get(c.fn);
    if (def) found.add(def.file);
  }
  return [...found].sort();
}

function buildUrl(cfg, screen) {
  const base = cfg.source.appUrl || '<manual.config.json の source.appUrl を設定してください>';
  const q = { ...(cfg.source.defaultQuery || {}), ...(screen.query || {}) };
  const qs = Object.entries(q).filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return qs ? `${base}?${qs}` : base;
}
