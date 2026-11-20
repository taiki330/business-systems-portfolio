export function getMonthDays(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const cells: (string | null)[] = Array(startOffset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(toDateStr(year, month, d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function getWeekDays(dateStr: string): string[] {
  const base = new Date(`${dateStr}T00:00:00`);
  const day = base.getDay();
  const monday = new Date(base);
  monday.setDate(base.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
  });
}

export function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatMonthLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export function formatWeekLabel(days: string[]): string {
  const first = new Date(`${days[0]}T00:00:00`);
  const last = new Date(`${days[6]}T00:00:00`);
  const fm = (d: Date) =>
    `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
  return `${fm(first)}（月） 〜 ${fm(last)}（日）`;
}

export function addMonths(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return toDateStr(d.getFullYear(), d.getMonth() + 1, 1);
}

export function addWeeks(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta * 7);
  return toDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function monthStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return toDateStr(d.getFullYear(), d.getMonth() + 1, 1);
}

export function monthEnd(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return toDateStr(last.getFullYear(), last.getMonth() + 1, last.getDate());
}

const WEEKDAY_SHORT = ["月", "火", "水", "木", "金", "土", "日"];
export function weekdayShort(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  return WEEKDAY_SHORT[day === 0 ? 6 : day - 1];
}
