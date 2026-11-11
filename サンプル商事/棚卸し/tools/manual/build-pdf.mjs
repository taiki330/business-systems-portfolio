#!/usr/bin/env node
/**
 * Markdown版マニュアルから、そのまま配布できるPDFを作る。
 * ------------------------------------------------------------------
 *   node tools/manual/build-pdf.mjs
 *
 * 流れ: index.md + screens/*.md → 1つのHTML（表紙・目次つき）→ Playwright で印刷
 * 画像は file:// の絶対パスに書き換えるので、PDF内にそのまま埋め込まれる。
 *
 * 本文の集め方・目次・リンクの書き換えは lib/compose.mjs に置いてWord版と共通化している。
 * 編集できる形で渡したいときは build-docx.mjs のほうを使う。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { loadConfig, abs, ensureDir, log, ROOT } from './lib/config.mjs';
import { composeManual, escapeHtml } from './lib/compose.mjs';

const cfg = loadConfig();
const pdfPath = abs(cfg.output.pdfFile);

const { htmlPath, docs } = composeManual(cfg, {
  variant: 'pdf',
  cssFile: 'pdf.css',
  outFile: 'manual.html'
});

/* --- 印刷 --- */
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'ja-JP' });
const p = await ctx.newPage();
await p.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
await p.emulateMedia({ media: 'print' });
ensureDir(path.dirname(pdfPath));
await p.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
  displayHeaderFooter: true,
  headerTemplate: `<div style="font-size:8px;color:#888;width:100%;padding:0 16mm;text-align:right;">${escapeHtml(cfg.product.name)} ${escapeHtml(cfg.product.subtitle || '')}</div>`,
  footerTemplate: '<div style="font-size:9px;color:#666;width:100%;padding:0 16mm;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
});
await browser.close();

log(`✓ PDFを作成しました: ${path.relative(ROOT, pdfPath)}（${docs.length} 画面）`);
