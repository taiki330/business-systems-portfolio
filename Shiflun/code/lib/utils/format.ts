const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-11-14" → "11/14（土）"。日付として読めないときはそのまま返す。 */
export function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}（${WEEKDAYS[date.getUTCDay()]}）`;
}

/** "17:00:00" → "17:00"。 */
export function shortTime(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : "--:--";
}

/** 日時を「11/14 17:05」の形に（日本時間）。 */
export function shortDateTime(value: string): string {
  return new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
