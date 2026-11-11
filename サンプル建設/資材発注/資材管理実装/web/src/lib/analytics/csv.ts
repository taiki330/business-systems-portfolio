/**
 * CSV 生成ユーティリティ（Phase 5 要件6）。
 *
 * - 文字化けしない形式: 先頭に UTF-8 BOM を付ける（Excel が UTF-8 と正しく認識する）。
 * - 改行は CRLF（Excel 互換）。
 * - 値にカンマ・改行・ダブルクォートを含む場合は二重引用符でエスケープ。
 */

const BOM = "﻿";

/**
 * CSV インジェクション対策。
 * 文字列セルの先頭が = + - @ の場合、表計算ソフトが数式として解釈するのを防ぐため
 * 先頭に ' を付ける。数値セルは対象外（-5 等の正当な負数を壊さない）。
 */
function neutralizeFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  // 数値は数式インジェクションの対象にしない（そのまま文字列化）
  const raw = typeof value === "number" ? String(value) : neutralizeFormula(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const lines = [headers, ...rows].map((cols) =>
    cols.map(escapeCell).join(","),
  );
  return BOM + lines.join("\r\n") + "\r\n";
}

/** CSV 文字列を添付ダウンロードの Response にする */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
