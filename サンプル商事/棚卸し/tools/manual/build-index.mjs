#!/usr/bin/env node
/**
 * docs/manual/index.md（マニュアルのトップページ）を作り直す。
 * ------------------------------------------------------------------
 * docs/manual/screens/*.md のフロントマターを読み、カテゴリごとの一覧表を組み立てる。
 * 画面が増えても、この1コマンドで目次が最新になる。
 *
 *   node tools/manual/build-index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, abs, ensureDir, log, ROOT } from './lib/config.mjs';
import { readDoc, firstHeading } from './lib/markdown.mjs';

const cfg = loadConfig();
const docsDir = ensureDir(abs(cfg.output.docsDir));
const screensDir = ensureDir(abs(cfg.output.screensDir));
const imagesDir = abs(cfg.capture.outDir);

// 画面ごとの状態（ドキュメント有無・スクショ有無）を集める
const rows = cfg.screens.map((screen) => {
  const docPath = path.join(screensDir, `${screen.key}.md`);
  const hasDoc = fs.existsSync(docPath);
  const doc = hasDoc ? readDoc(docPath) : null;
  return {
    ...screen,
    hasDoc,
    hasShot: fs.existsSync(path.join(imagesDir, `${screen.key}.png`)),
    title: doc?.front.title || (doc && firstHeading(doc.body)) || screen.title,
    summary: doc?.front.summary || '',
    updated: doc?.front.updated || ''
  };
});

const categories = cfg.categories?.length
  ? cfg.categories
  : [{ key: '', title: '画面一覧' }];

const L = [];
const p = (s = '') => L.push(s);

p(`# ${cfg.product.name} ${cfg.product.subtitle || '利用者マニュアル'}`);
p();
if (cfg.product.client) p(`**${cfg.product.client} 様**`);
p();
p('このマニュアルは、画面ごとに「できること・操作手順・項目の説明・注意事項・よくある質問」をまとめたものです。');
p('はじめて使う方は、上から順に読んでいくと迷いません。読みたい画面名をクリックしてください。');
p();
p('---');
p();
p('## 画面一覧');
p();

for (const cat of categories) {
  const list = rows.filter((r) => (r.category || categories[0].key) === cat.key);
  if (!list.length) continue;
  p(`### ${cat.title}`);
  p();
  p('| 画面 | この画面でできること |');
  p('| --- | --- |');
  for (const r of list) {
    const label = r.hasDoc ? `[${r.title}](screens/${r.key}.md)` : `${r.title}（準備中）`;
    p(`| ${label} | ${escapeCell(r.summary || '—')} |`);
  }
  p();
}

p('---');
p();
p('## 困ったときは');
p();
p('- 画面が真っ白なとき、または「読み込みに失敗しました」と出るときは、ページを再読み込みしてください。');
p('- それでも直らないときは、開いていたURLと画面のスクリーンショットを添えてご連絡ください。');
p();

const missingDoc = rows.filter((r) => !r.hasDoc);
const missingShot = rows.filter((r) => !r.hasShot);

p('<!-- このファイルは tools/manual/build-index.mjs が自動生成しています。直接編集しないでください。 -->');
p(`<!-- 生成日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} -->`);
p();

const indexPath = path.join(docsDir, 'index.md');
fs.writeFileSync(indexPath, L.join('\n'), 'utf8');
log(`✓ ${path.relative(ROOT, indexPath)} を更新しました（${rows.length} 画面）`);

if (missingDoc.length) {
  log(`\n【本文が未作成の画面 ${missingDoc.length} 件】`);
  for (const r of missingDoc) log(`  - ${r.key}（${r.title}）`);
  log('  → Claude Code で `/manual-write <画面キー>` を実行してください。');
}
if (missingShot.length) {
  log(`\n【スクリーンショット未取得の画面 ${missingShot.length} 件】`);
  for (const r of missingShot) log(`  - ${r.key}`);
  log('  → `npm run manual:capture -- --only=' + missingShot.map((r) => r.key).join(',') + '`');
}

function escapeCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
