/**
 * 一覧画面のテキスト検索を組み立てるヘルパー。
 *
 * PostgREST の or フィルタは `col.ilike.%語%,col2.ilike.%語%` という文字列で表現するため、
 * 区切り記号や LIKE のワイルドカードが入力に混ざると式が壊れる。
 * 利用者は名前の一部を打つだけなので、記号は落として素直な部分一致にする。
 */
const UNSAFE = /[,()"'\\*%_]/g;
const MAX_LENGTH = 60;

/** 検索語を安全な形に整える。空文字なら検索しない扱い。 */
export function sanitizeSearchTerm(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.replace(UNSAFE, "").trim().slice(0, MAX_LENGTH);
}

/** 複数列に対する部分一致（大文字小文字を区別しない）の or 条件を作る。 */
export function orIlike(term: string, columns: string[]): string {
  return columns.map((c) => `${c}.ilike.%${term}%`).join(",");
}

function normalizeForSearch(value: string | number): string {
  return String(value).normalize("NFKC").toLocaleLowerCase("ja");
}

/** 取得済み一覧を、複数項目にまたがって部分一致検索する。空白区切りはAND検索。 */
export function matchesSearchTerm(
  term: string,
  values: (string | number | null | undefined)[],
): boolean {
  if (!term) return true;
  const haystack = normalizeForSearch(values.filter((v) => v != null).join(" "));
  return normalizeForSearch(term)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
