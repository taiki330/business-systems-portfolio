/** 数量表示（numeric(12,2)）。末尾の余分な 0 を出さずに最大2桁小数で表示する。 */
export function fmtQty(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** 前月比の差分表示（+3 / -2 / ±0）。 */
export function fmtDelta(current: number, previous: number): string {
  const d = Math.round((current - previous) * 100) / 100;
  if (d === 0) return "±0";
  return d > 0 ? `+${fmtQty(d)}` : `-${fmtQty(Math.abs(d))}`;
}
