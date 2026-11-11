import { AnalyticsNav } from "@/components/analytics/AnalyticsNav";
import { fetchDashboard } from "@/lib/analytics/fetch-phase5";
import { fmtDelta, fmtQty } from "@/lib/analytics/format";
import { monthStart } from "@/lib/analytics/period-range";
import Link from "next/link";

/**
 * 分析ダッシュボード（Phase 5 要件1）。D-20260806-03以降はadminのみ。
 *
 * 今月の出庫・返却（前月比較つき）、現場現在庫（自社）、リース中数量、
 * 返却期限超過件数、予定数量超過件数を KPI として表示する。
 */
export default async function AnalyticsDashboardPage() {
  const month = monthStart();
  const { rows: kpi, error } = await fetchDashboard(month);

  const now = new Date();
  const monthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            分析ダッシュボード
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {monthLabel}時点の利用状況です（出庫・返却は前月比較つき）。
          </p>
          <AnalyticsNav current="/analytics" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            集計を取得できませんでした: {error.message}
          </p>
        )}

        {!error && !kpi && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            表示できるデータがありません。
          </p>
        )}

        {!error && kpi && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiTile
                title="今月の出庫数量"
                value={fmtQty(kpi.thisShipped)}
                sub={`前月比 ${fmtDelta(kpi.thisShipped, kpi.prevShipped)}（前月 ${fmtQty(kpi.prevShipped)}）`}
              />
              <KpiTile
                title="今月の返却数量"
                value={fmtQty(kpi.thisReturned)}
                sub={`前月比 ${fmtDelta(kpi.thisReturned, kpi.prevReturned)}（前月 ${fmtQty(kpi.prevReturned)}）`}
              />
              <KpiTile
                title="現場現在庫（自社）"
                value={fmtQty(kpi.siteStockOwned)}
                sub="現在、現場にある自社所有在庫の合計"
              />
              <KpiTile
                title="リース中数量"
                value={fmtQty(kpi.leaseOutstanding)}
                sub="受入済み − リース会社返却済み（未返却の合計）"
              />
              <KpiTile
                title="返却期限超過"
                value={`${kpi.overdueLeaseCount} 件`}
                sub="未返却が残り、返却期限を過ぎた借用明細"
                emphasis={kpi.overdueLeaseCount > 0}
                href="/leases/due?overdue=1"
              />
              <KpiTile
                title="予定数量超過"
                value={`${kpi.overPlanCount} 件`}
                sub="見込が予定数量を超える現場×商品"
                emphasis={kpi.overPlanCount > 0}
                href="/plans/over"
              />
            </section>

            <section className="mt-8 rounded-lg border border-zinc-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-zinc-900">
                詳しく見る
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <NavLink href="/analytics/period" label="月別・年別集計" />
                <NavLink href="/analytics/sites" label="現場別分析" />
                <NavLink href="/analytics/products" label="商品別分析" />
                <NavLink href="/analytics/leases" label="リース分析" />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function KpiTile({
  title,
  value,
  sub,
  emphasis = false,
  href,
}: {
  title: string;
  value: string;
  sub: string;
  emphasis?: boolean;
  href?: string;
}) {
  const inner = (
    <div
      className={`rounded-lg border p-5 shadow-sm ${
        emphasis
          ? "border-amber-300 bg-amber-50"
          : "border-zinc-200 bg-white"
      }`}
    >
      <p className="text-sm text-zinc-500">{title}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          emphasis ? "text-amber-900" : "text-zinc-900"
        }`}
      >
        {value}
      </p>
      <p className="mt-2 text-xs text-zinc-500">{sub}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
    >
      {label}
    </Link>
  );
}
