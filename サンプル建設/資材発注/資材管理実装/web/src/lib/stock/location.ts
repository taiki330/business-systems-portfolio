/** 選択値（"center" または site の UUID）から stock_items.location 互換値を作る。 */
export function toStockLocation(value: string): string {
  return value === "center" ? "center" : `site:${value}`;
}
