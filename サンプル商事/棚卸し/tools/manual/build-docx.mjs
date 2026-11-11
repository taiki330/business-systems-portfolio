#!/usr/bin/env node
/**
 * Markdown版マニュアルから、そのまま編集できるWord（.docx）を作る。
 * ------------------------------------------------------------------
 *   node tools/manual/build-docx.mjs
 *
 * 流れ: index.md + screens/*.md → 1つのHTML（表紙・目次つき）→ Wordで開いて .docx 保存
 *
 * なぜWordを使うか:
 *   .docx は中身がZIP＋XMLで、画像つきの文書を自前で組み立てるのは割に合わない。
 *   このPCにはWordが入っているので、HTMLを読ませて .docx で保存させるのが
 *   いちばん確実で、出来上がりもWordの標準的な段落スタイルになる。
 *   ＝受け取った側が普通に編集できる。
 *
 * 注意:
 *   Wordがインストールされたパソコンでのみ動く（Windows）。
 *   PDFが要るときは build-pdf.mjs のほうを使う。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, abs, ensureDir, log, ROOT, TOOL_DIR } from './lib/config.mjs';
import { composeManual } from './lib/compose.mjs';

const cfg = loadConfig();
const docxPath = abs(cfg.output.docxFile
  || `${cfg.output.docsDir}/${cfg.product.name}_${cfg.product.subtitle || '利用者マニュアル'}.docx`);

const { htmlPath, docs } = composeManual(cfg, {
  variant: 'word',
  cssFile: 'word.css',
  outFile: 'manual-word.html'
});

ensureDir(path.dirname(docxPath));

const script = path.join(TOOL_DIR, 'to-docx.ps1');
const res = spawnSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', script, '-Html', htmlPath, '-Docx', docxPath
], { encoding: 'utf8' });

if (res.error) {
  console.error('PowerShellを起動できませんでした:', res.error.message);
  process.exit(1);
}
if (res.status !== 0 || !fs.existsSync(docxPath)) {
  console.error('Wordでの変換に失敗しました。');
  if (res.stdout) console.error(res.stdout.trim());
  if (res.stderr) console.error(res.stderr.trim());
  console.error('\nWordが入っていないパソコンでは作成できません。' +
    'その場合は npm run manual:pdf でPDFを作ってください。');
  process.exit(1);
}

// Word側から "OK embedded=13 bytes=…" が返る。画像が0枚のまま出来上がっていないかを確認する。
const embedded = Number((res.stdout || '').match(/embedded=(\d+)/)?.[1] ?? -1);
const kb = Math.round(fs.statSync(docxPath).size / 1024);
log(`✓ Word版を作成しました: ${path.relative(ROOT, docxPath)}（${docs.length} 画面 / ${kb} KB）`);
log(`  画面写真を埋め込んだ枚数: ${embedded < 0 ? '不明' : embedded}`);
if (embedded === 0) {
  log('  ! 画面写真が1枚も入っていません。docs/manual/images/ に画像があるか確認してください。');
}
log(`  組み立てに使ったHTML: ${path.relative(ROOT, htmlPath)}`);
