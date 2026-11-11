/**
 * ログイン後の `next` クエリのサニタイズ（同期・サーバ/クライアント両用）。
 *
 * オープンリダイレクト防止のため、以下のみを許可する:
 *   - 先頭が "/"
 *   - "//" で始まらない（プロトコル相対 URL）
 *   - "/\\" で始まらない（バックスラッシュ経由の回避）
 *   - "http://" / "https://" を含まない（簡易チェック）
 *
 * 不正値は null を返す（呼び出し側で "/" にフォールバック）。
 */
export function sanitizeNext(rawNext: string | null | undefined): string | null {
  if (!rawNext) return null;
  let next: string;
  try {
    next = decodeURIComponent(rawNext);
  } catch {
    return null;
  }
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  if (next.startsWith("/\\")) return null;
  const lower = next.toLowerCase();
  if (lower.includes("http://") || lower.includes("https://")) return null;
  return next;
}
