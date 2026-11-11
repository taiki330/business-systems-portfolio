import { AnalyticsNav } from "@/components/analytics/AnalyticsNav";
import { fetchPeriodSummary } from "@/lib/analytics/fetch-phase5";
import { fmtQty } from "@/lib/analytics/format";
import {
  defaultRange,
  formatPeriod,
  parseDate,
  parsePeriodKind,
} from "@/lib/analytics/period-range";
import { ANALYTICS_PERIOD_LABELS } from "@/types/analytics-phase5";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
};

function chartWidth(value: number, max: number): string {
  if (max <= 0) return "0%";
  return `${Math.min(100, Math.max(0, (value / max) * 100))}%`;
}

/** 月別・年別集計（Phase 5 要件2）。D-20260806-03以降はadminのみ。 */
export default async function PeriodSummaryPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const kind = parsePeriodKind(sp.period);
  const def = defaultRange(kind);
  const from = parseDate(sp.from) ?? def.from;
  const to = parseDate(sp.to) ?? def.to;

  const { rows, error } = await fetchPeriodSummary(kind, from, to);

  const csvHref = `/analytics/period/export?period=${kind}&from=${from}&to=${to}`;
  const chartRows = rows.slice(-12);
  const movementMax = Math.max(...chartRows.flatMap((row) => [row.shippedQuantity, row.returnedQuantity]), 0);

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            月別・年別集計
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            出庫・返却・純増減・リース受入/返却・現場数・依頼件数を集計します。
          </p>
          <AnalyticsNav current="/analytics/period" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            集計を取得できませんでした: {error.message}
          </p>
        )}

        <form
          method="GET"
          className="mb-6 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div>
            <label htmlFor="period" className="block text-xs font-medium text-zinc-600">
              期間単位
            </label>
            <select
              id="period"
              name="period"
              defaultValue={kind}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
            >
              <option value="month">{ANALYTICS_PERIOD_LABELS.month}</option>
              <option value="year">{ANALYTICS_PERIOD_LABELS.year}</option>
            </select>
          </div>
          <div>
            <label htmlFor="from" className="block text-xs font-medium text-zinc-600">
              開始
            </label>
            <input id="from" name="from" type="date" defaultValue={from}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs font-medium text-zinc-600">
              終了
            </label>
            <input id="to" name="to" type="date" defaultValue={to}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
              集計
            </button>
            <Link href={csvHref}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              CSV
            </Link>
          </div>
        </form>

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            対象期間に集計できるデータがありません。
          </p>
        )}

        {!error && rows.length > 0 && (
          <>
            <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" aria-labelledby="movement-chart-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 id="movement-chart-heading" className="text-base font-semibold text-zinc-900">出庫・返却の推移</h2>
                  <p className="mt-1 text-sm text-zinc-600">直近12期間を表示しています。棒の長さは、この範囲内での最大数量を基準にしています。</p>
                </div>
                <p className="text-xs text-zinc-600"><span className="mr-3 inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />出庫</span><span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />返却</span></p>
              </div>
              <div className="mt-5 space-y-4">
                {chartRows.map((row) => (
                  <div key={`chart-${row.period}`}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <p className="font-medium text-zinc-900">{formatPeriod(row.period, kind)}</p>
                      <p className="shrink-0 tabular-nums text-zinc-700">出庫 {fmtQty(row.shippedQuantity)} / 返却 {fmtQty(row.returnedQuantity)}</p>
                    </div>
                    <div className="space-y-1.5" aria-label={`${formatPeriod(row.period, kind)}の出庫と返却`}>
                      <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-blue-600" style={{ width: chartWidth(row.shippedQuantity, movementMax) }} /></div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: chartWidth(row.returnedQuantity, movementMax) }} /></div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
              <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">期間</th>
                  <th className="px-4 py-3 text-right font-medium">出庫</th>
                  <th className="px-4 py-3 text-right font-medium">返却</th>
                  <th className="px-4 py-3 text-right font-medium">純増減</th>
                  <th className="px-4 py-3 text-right font-medium">リース受入</th>
                  <th className="px-4 py-3 text-right font-medium">リース会社返却</th>
                  <th className="px-4 py-3 text-right font-medium">現場数</th>
                  <th className="px-4 py-3 text-right font-medium">依頼件数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => (
                  <tr key={r.period} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-900">{formatPeriod(r.period, kind)}</td>
                    <td className="px-4 py-3 text-right text-zinc-900">{fmtQty(r.shippedQuantity)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmtQty(r.returnedQuantity)}</td>
                    <td className="px-4 py-3 text-right text-zinc-900">{fmtQty(r.netQuantity)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmtQty(r.leaseReceivedQuantity)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmtQty(r.leaseReturnedToCompany)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{r.siteCount}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{r.requestCount}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </>
        )}

        <p className="mt-4 text-sm text-zinc-500">{rows.length} 期間</p>
      </main>
    </div>
  );
}
