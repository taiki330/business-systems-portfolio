/**
 * 画面マニュアル(.md)のフロントマターを読み書きする最小限のユーティリティ。
 * 依存を増やさないため、`key: value` 形式だけを扱う簡易パーサにしている。
 */
import fs from 'node:fs';

export function readDoc(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { front: {}, body: raw, raw };
  const front = {};
  for (const line of m[1].split(/\r?\n/)) {
    const hit = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!hit) continue;
    front[hit[1]] = hit[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { front, body: raw.slice(m[0].length), raw };
}

/** 本文の最初の見出し（# 画面名）を返す */
export function firstHeading(body) {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1].trim() : '';
}
