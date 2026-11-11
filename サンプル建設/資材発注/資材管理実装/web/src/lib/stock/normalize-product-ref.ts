import type { StockProductRef } from "@/types/stock";

/** Supabase のリレーション取得結果を単一オブジェクトに正規化 */
export function normalizeProductRef(
  raw: StockProductRef | StockProductRef[] | null | undefined,
): StockProductRef | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}
