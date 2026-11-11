/**
 * Markdown版マニュアル（index.md + screens/*.md）を1枚のHTMLに組み立てる。
 * ------------------------------------------------------------------
 * PDF版（build-pdf.mjs）とWord版（build-docx.mjs）で中身は同じものを配るため、
 * 本文の集め方・目次の作り方・リンクの書き換えはここに1本化する。
 * 違うのは当てるCSSと、ページ区切りの表し方だけ。
 *
 * variant:
 *   'pdf'  … Chromeで印刷する前提。CSSはそのまま効く
 *   'word' … Wordで開く前提。Wordが解釈できない指定（flex等）は使わず、
 *            ページ区切りは空divに page-break-before を付けて表す
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import MarkdownIt from 'markdown-it';
import { abs, ensureDir, log, ROOT, TOOL_DIR } from './config.mjs';
import { readDoc } from './markdown.mjs';

/**
 * @param {Object} cfg manual.config.json
 * @param {{variant:('pdf'|'word'), cssFile:string, outFile:string}} opts
 * @return {{htmlPath:string, docs:Array}}
 */
export function composeManual(cfg, opts) {
  const variant = opts.variant || 'pdf';
  const screensDir = abs(cfg.output.screensDir);
  const docsDir = abs(cfg.output.docsDir);
  const buildDir = ensureDir(path.join(docsDir, '.build'));

  const md = new MarkdownIt({ html: true, linkify: false, breaks: false });
  // markdown-it は既定で file: を危険なURLとして弾く。ここではローカルの画像を
  // 成果物へ埋め込むために意図的に許可する（入力は自分たちのMarkdownのみ）。
  md.validateLink = () => true;

  /* --- 本文を集める --- */
  const docs = [];
  for (const screen of cfg.screens) {
    const file = path.join(screensDir, `${screen.key}.md`);
    if (!fs.existsSync(file)) {
      log(`… ${screen.key}: 本文が未作成のためスキップします`);
      continue;
    }
    const { front, body } = readDoc(file);
    docs.push({ screen, front, body });
  }
  if (!docs.length) {
    throw new Error('配布物にできる画面マニュアルが1つもありません。先に本文を作成してください。');
  }

  /* --- 目次 --- */
  // Wordはアンカーリンクの飛び先を作り直すため、目次は見出しの文字だけを並べる。
  // また span の display:block を無視するので、Word版は <br> で明示的に改行する
  // （そうしないと「画面名＋説明文」が1行につながって読みにくい）。
  const tocHtml = cfg.categories.map((cat) => {
    const list = docs.filter((d) => (d.screen.category || '') === cat.key);
    if (!list.length) return '';
    const items = list.map((d) => {
      const title = escapeHtml(d.front.title || d.screen.title);
      const sum = escapeHtml(d.front.summary || '');
      const label = variant === 'word' ? title : `<a href="#${d.screen.key}">${title}</a>`;
      const br = variant === 'word' ? '<br>' : '';
      return `<li>${label}${br}<span class="toc-sum">${sum}</span></li>`;
    }).join('\n');
    return `<h3>${escapeHtml(cat.title)}</h3>\n<ol class="toc">${items}</ol>`;
  }).filter(Boolean).join('\n');

  /* --- 各画面 --- */
  const brk = variant === 'word' ? '<div class="pagebreak"></div>\n' : '';
  const bodyHtml = docs.map((d, i) => {
    const html = md.render(rewriteLinks(d.body, screensDir, buildDir, variant));
    // Word版は section に page-break-before を効かせにくいので、区切り用のdivを前に置く
    const lead = (variant === 'word' && i > 0) ? brk : '';
    return `${lead}<div class="screen" id="${d.screen.key}">\n${html}\n</div>`;
  }).join('\n');

  const css = fs.readFileSync(path.join(TOOL_DIR, 'templates', opts.cssFile), 'utf8');
  const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });

  const page = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>${escapeHtml(cfg.product.name)}</title>
<style>${css}</style></head><body>
<div class="cover">
  <div class="cover-inner">
    <p class="cover-client">${escapeHtml(cfg.product.client || '')}</p>
    <h1 class="cover-title">${escapeHtml(cfg.product.name)}</h1>
    <p class="cover-sub">${escapeHtml(cfg.product.subtitle || '利用者マニュアル')}</p>
    <p class="cover-meta">版数 ${escapeHtml(cfg.product.version || '1.0')}　／　${today} 作成</p>
  </div>
</div>
${variant === 'word' ? brk : ''}<div class="toc-page">
  <h2>目次</h2>
  ${tocHtml}
</div>
${variant === 'word' ? brk : ''}${bodyHtml}
</body></html>`;

  const htmlPath = path.join(buildDir, opts.outFile);
  fs.writeFileSync(htmlPath, page, 'utf8');
  return { htmlPath, docs };
}

/**
 * 画像の参照先を成果物から見えるパスに、画面間リンクは文書内アンカーに書き換える。
 *
 * Word版が相対パスなのは、このプロジェクトのフォルダ名が日本語のため。
 * markdown-it は src をURLエンコードするので、絶対パスのままだと
 * 「%E3%83%97…」という文字列になり、Wordが画像を見つけられず
 * 1枚も取り込まないまま .docx ができあがってしまう。
 * 組み立て先（.build/）からの相対パスなら全部ASCIIになり、この問題が起きない。
 */
function rewriteLinks(body, screensDir, buildDir, variant) {
  return body
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
      if (/^https?:/.test(src)) return m;
      const absolute = path.resolve(screensDir, src);
      if (!fs.existsSync(absolute)) {
        log(`! 画像が見つかりません: ${path.relative(ROOT, absolute)}`);
        return '';
      }
      const href = variant === 'word'
        ? path.relative(buildDir, absolute).replace(/\\/g, '/')
        : pathToFileURL(absolute).href;
      return `![${alt}](${href})`;
    })
    .replace(/\]\((?:\.\/)?([a-z0-9_-]+)\.md\)/gi, '](#$1)')
    .replace(/\]\(\.\.\/index\.md\)/g, '](#top)');
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
