#!/usr/bin/env node
/**
 * 利用者マニュアル（Markdown）を配布用PDFに変換するツール。
 *
 * 対応する Markdown 記法は、このマニュアル生成のために書かれる原稿だけを想定した
 * 最小限のサブセット（見出し#/##/###、**太字**、-/1. リスト、![alt](path) 画像、
 * | a | b | テーブル、> による警告枠、--- 区切り線）。汎用のMarkdownパーサーではない。
 *
 * 使い方（資材管理実装/web ディレクトリから実行。@playwright/test の chromium を使うため）:
 *   node ../../docs/manual/tools/build-pdf.mjs admin
 *   node ../../docs/manual/tools/build-pdf.mjs center
 *   node ../../docs/manual/tools/build-pdf.mjs vendor
 *
 * 入力: docs/manual/<role>/<role>.md
 * 出力: docs/manual/<role>/<PDF_NAMES[role]>
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const WEB_DIR = path.join(REPO_ROOT, "資材管理実装", "web");
const MANUAL_DIR = path.join(REPO_ROOT, "docs", "manual");

const PDF_NAMES = {
  admin: "資材管理システム_事務操作マニュアル.pdf",
  center: "資材管理システム_センター操作マニュアル.pdf",
  vendor: "資材管理システム_現場操作マニュアル.pdf",
};

const ROLE_TITLES = {
  admin: "事務（admin）操作マニュアル",
  center: "センター（サンプル市Aセンター）操作マニュアル",
  vendor: "現場・業者（vendor）操作マニュアル",
};

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 見出し内・段落内のインライン記法（太字・コード・リンク・画像）を変換する。 */
function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const resolvedSrc = /^https?:/.test(src) ? src : src;
    return `<img alt="${alt}" src="${resolvedSrc}" />`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/「([^」]+)」/g, "「<span class=\"btn\">$1</span>」");
  return s;
}

function isTableSeparator(line) {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());
}

function parseTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

/** 制約付き Markdown サブセットを HTML 本文へ変換する。 */
function markdownToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let inUl = false;
  let inOl = false;

  function closeLists() {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      closeLists();
      i++;
      continue;
    }

    // 見出し
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      const cls = level === 1 ? ' class="section-title"' : "";
      out.push(`<h${level}${cls}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // 区切り線
    if (/^-{3,}\s*$/.test(line)) {
      closeLists();
      out.push('<hr class="divider" />');
      i++;
      continue;
    }

    // 警告ブロック（> で始まる連続行）
    if (/^>\s?/.test(line)) {
      closeLists();
      const block = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        block.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const isWarning = /注意|警告|⚠/.test(block.join(""));
      out.push(
        `<div class="callout ${isWarning ? "callout-warning" : "callout-note"}">${block
          .map((l) => `<p>${inline(l)}</p>`)
          .join("")}</div>`,
      );
      continue;
    }

    // テーブル
    if (line.includes("|") && lines[i + 1] && isTableSeparator(lines[i + 1])) {
      closeLists();
      const header = parseTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      out.push('<table class="md-table"><thead><tr>');
      header.forEach((h) => out.push(`<th>${inline(h)}</th>`));
      out.push("</tr></thead><tbody>");
      rows.forEach((r) => {
        out.push("<tr>");
        r.forEach((c) => out.push(`<td>${inline(c)}</td>`));
        out.push("</tr>");
      });
      out.push("</tbody></table>");
      continue;
    }

    // 画像単体行
    const imgOnly = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgOnly) {
      closeLists();
      out.push(`<figure class="screenshot"><img alt="${imgOnly[1]}" src="${imgOnly[2]}" />${
        imgOnly[1] ? `<figcaption>${inline(imgOnly[1])}</figcaption>` : ""
      }</figure>`);
      i++;
      continue;
    }

    // 番号付きリスト
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (!inOl) {
        closeLists();
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      i++;
      continue;
    }

    // 箇条書き
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (!inUl) {
        closeLists();
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      i++;
      continue;
    }

    // 段落
    closeLists();
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !/^-{3,}\s*$/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^!\[/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push(`<p>${paraLines.map(inline).join("<br/>")}</p>`);
  }
  closeLists();
  return out.join("\n");
}

const CSS = `
  @page { size: A4; margin: 18mm 16mm 20mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif;
    color: #1a1a1a;
    font-size: 10.5pt;
    line-height: 1.65;
  }
  .cover {
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    page-break-after: always;
  }
  .cover .system-name { font-size: 14pt; color: #555; margin-bottom: 8pt; }
  .cover h1 { font-size: 26pt; margin: 0 0 12pt 0; }
  .cover .cover-desc { font-size: 11pt; color: #444; margin-top: 24pt; }
  h1.section-title {
    font-size: 16pt;
    border-bottom: 2px solid #1a1a1a;
    padding-bottom: 4pt;
    margin-top: 28pt;
    page-break-before: always;
  }
  body > h1.section-title:first-of-type { page-break-before: avoid; }
  h2 {
    font-size: 13pt;
    margin-top: 18pt;
    padding: 4pt 8pt;
    background: #f0f0f0;
    border-left: 4px solid #333;
    page-break-after: avoid;
  }
  h3 { font-size: 11.5pt; margin-top: 12pt; page-break-after: avoid; color: #222; }
  h4 { font-size: 10.5pt; margin-top: 10pt; page-break-after: avoid; color: #444; }
  p { margin: 6pt 0; }
  ul, ol { margin: 6pt 0; padding-left: 20pt; }
  li { margin: 2pt 0; }
  .btn { font-weight: 600; }
  code { background: #f2f2f2; padding: 1pt 3pt; border-radius: 2pt; font-size: 9.5pt; }
  hr.divider { border: none; border-top: 1px solid #ccc; margin: 14pt 0; }
  .callout {
    border-radius: 4pt;
    padding: 8pt 12pt;
    margin: 10pt 0;
    break-inside: avoid-page;
    page-break-inside: avoid;
  }
  .callout p { margin: 2pt 0; }
  .callout-warning { background: #fff4e5; border: 1px solid #e0a030; }
  .callout-note { background: #eef4fb; border: 1px solid #7fa8d6; }
  figure.screenshot {
    margin: 10pt 0;
    break-inside: avoid-page;
    page-break-inside: avoid;
    text-align: center;
  }
  figure.screenshot img {
    max-width: 100%;
    max-height: 90mm;
    border: 1px solid #ccc;
    display: block;
    margin: 0 auto;
  }
  figure.screenshot figcaption {
    font-size: 9pt;
    color: #555;
    margin-top: 3pt;
    break-before: avoid-page;
    page-break-before: avoid;
  }
  table.md-table {
    border-collapse: collapse;
    width: 100%;
    margin: 8pt 0;
    font-size: 9.5pt;
    break-inside: avoid-page;
    page-break-inside: avoid;
  }
  table.md-table th, table.md-table td {
    border: 1px solid #999;
    padding: 4pt 6pt;
    text-align: left;
    vertical-align: top;
  }
  table.md-table th { background: #eee; }
`;

function buildHtml(md, role) {
  const body = markdownToHtml(md);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>${ROLE_TITLES[role]}</title>
<style>${CSS}</style>
</head>
<body>
<div class="cover">
  <div class="system-name">資材管理システム</div>
  <h1>${ROLE_TITLES[role]}</h1>
  <div class="cover-desc">配布用マニュアル</div>
</div>
${body}
</body>
</html>`;
}

async function main() {
  const role = process.argv[2];
  if (!["admin", "center", "vendor"].includes(role)) {
    console.error("使い方: node build-pdf.mjs <admin|center|vendor>");
    process.exit(1);
  }

  const mdPath = path.join(MANUAL_DIR, role, `${role}.md`);
  const md = readFileSync(mdPath, "utf-8");
  const html = buildHtml(md, role);

  // 画像の相対パス（../screenshots/...）がそのまま解決されるよう、
  // 一時HTMLを docs/manual/<role>/ の中に置く。
  const tmpHtmlPath = path.join(MANUAL_DIR, role, `.${role}.pdf-source.html`);
  writeFileSync(tmpHtmlPath, html, "utf-8");

  // @playwright/test は web/node_modules 配下にのみ存在するため、web/package.json を
  // 起点にした require で解決する（このスクリプト自身の node_modules は無い）。
  const webRequire = createRequire(path.join(WEB_DIR, "package.json"));
  const { chromium } = webRequire("@playwright/test");

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmpHtmlPath).href);
  await page.waitForLoadState("networkidle");

  const outPath = path.join(MANUAL_DIR, role, PDF_NAMES[role]);
  await page.pdf({
    path: outPath,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="font-size:8pt; width:100%; text-align:center; color:#888;">' +
      '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
  });

  await browser.close();
  unlinkSync(tmpHtmlPath);
  console.log(`生成しました: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
