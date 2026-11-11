import type { AnalyticsPeriodKind } from "@/types/analytics-phase5";

/**
 * 分析画面の期間パラメータの解析とデフォルト値。
 *
 * 5年運用を想定し、from 未指定時は「重すぎない既定範囲」に丸める:
 *   月別 … 直近12ヶ月
 *   年別 … 直近5年
 * from/to は各期間の「開始日」（月別なら月初、年別なら年初）を表す yyyy-mm-dd。
 * 現場別・商品別（期間種別なし）の既定は直近12ヶ月とする。
 */

export function parsePeriodKind(v: string | undefined): AnalyticsPeriodKind {
  return v === "year" ? "year" : "month";
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** yyyy-mm-dd 形式として妥当ならそのまま、そうでなければ null */
export function parseDate(v: string | undefined): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** 月初（当月）を yyyy-mm-dd で返す */
export function monthStart(base: Date = new Date()): string {
  return isoDate(new Date(base.getFullYear(), base.getMonth(), 1));
}

/** 期間種別に応じた既定の from/to（開始日ベース） */
export function defaultRange(kind: AnalyticsPeriodKind): {
  from: string;
  to: string;
} {
  const now = new Date();
  const to =
    kind === "year"
      ? isoDate(new Date(now.getFullYear(), 0, 1))
      : monthStart(now);
  const fromDate =
    kind === "year"
      ? new Date(now.getFullYear() - 4, 0, 1)
      : new Date(now.getFullYear(), now.getMonth() - 11, 1);
  return { from: isoDate(fromDate), to };
}

/** 期間種別なし（現場別・商品別）の既定範囲（直近12ヶ月・日付ベース） */
export function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  return { from: isoDate(from), to: isoDate(now) };
}

/** 期間表示（月別: 2026年7月 / 年別: 2026年） */
export function formatPeriod(period: string, kind: AnalyticsPeriodKind): string {
  const d = new Date(period);
  if (Number.isNaN(d.getTime())) return period;
  return kind === "year"
    ? `${d.getFullYear()}年`
    : `${d.getFullYear()}年${d.getMonth() + 1}月`;
}
