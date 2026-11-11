import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { AnalyticsNav } from "@/components/analytics/AnalyticsNav";
import { fetchProductUtilization } from "@/lib/analytics/fetch-phase5";
import { fmtQty } from "@/lib/analytics/format";
import {
  defaultRange,
  formatPeriod,
  parseDate,
  parsePeriodKind,
} from "@/lib/analytics/period-range";
import { fetchProductOptions } from "@/lib/products/fetch-options";
import {
  ANALYTICS_PERIOD_LABELS,
  type ProductUtilizationSort,
} from "@/types/analytics-phase5";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    product_id?: string;
    sort?: string;
    direction?: string;
  }>;
};

const SORT_OPTIONS: { value: ProductUtilizationSort; label: string }[] = [
  { value: "owned_utilization", label: "自社稼働率" },
  { value: "lease_dependency", label: "リース依存率" },
  { value: "turnover", label: "回転量" },
  { value: "product", label: "商品名" },
];

function parseSort(value: string | undefined): ProductUtilizationSort {
  return SORT_OPTIONS.some((x) => x.value === value)
    ? (value as ProductUtilizationSort)
    : "owned_utilization";
}

function formatRate(value: number | null): string {
  return value === null ? "算出不可" : `${fmtQty(value)}%`;
}

function chartWidth(value: number | null): string {
  if (value === null) return "0%";
  return `${Math.min(100, Math.max(0, value))}%`;
}

/** 商品ごとの日次残高を在庫台帳から逆算して平均した稼働率分析。台帳の信頼開始日より前は算出しない。 */
export default async function ProductAnalyticsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const kind = parsePeriodKind(sp.period);
  const def = defaultRange(kind);
  const from = parseDate(sp.from) ?? def.from;
  const to = parseDate(sp.to) ?? def.to;
  const productId = sp.product_id?.trim() || "";
  const sort = parseSort(sp.sort);
  const direction = sp.direction === "asc" ? "asc" : "desc";

  const [{ rows, error }, products] = await Promise.all([
    fetchProductUtilization(kind, from, to, {
      productId: productId || undefined,
      sort,
      direction,
    }),
    fetchProductOptions(),
  ]);

  const q = new URLSearchParams({ period: kind, from, to, sort, direction });
  if (productId) q.set("product_id", productId);
  const csvHref = `/analytics/products/export?${q.toString()}`;
  const chartRows = rows.filter((row) => row.isAvailable).slice(0, 10);

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-[1600px] px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">ホーム</Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">商品別 稼働率分析</h1>
          <p className="mt-1 text-sm text-zinc-500">
            在庫台帳から日別の残高を逆算して平均します。当月は本日までの経過日数で算出します。
          </p>
          <AnalyticsNav current="/analytics/products" />
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-8">
        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">分析を取得できませんでした: {error.message}</p>}

        <form method="GET" className="mb-6 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs font-medium text-zinc-600">商品
            <SearchableSelect
              name="product_id"
              ariaLabel="商品"
              defaultValue={productId}
              allowEmpty
              emptyLabel="すべて"
              placeholder="資材名の一部を入力"
              options={products.map((p) => ({
                value: p.id,
                label: p.code ? `${p.code} ${p.name}` : p.name,
                keywords: p.code ?? undefined,
                group: p.category_name ?? null,
              }))}
            />
          </label>
          <label className="text-xs font-medium text-zinc-600">期間種別
            <select name="period" defaultValue={kind} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">
              <option value="month">{ANALYTICS_PERIOD_LABELS.month}</option>
              <option value="year">{ANALYTICS_PERIOD_LABELS.year}</option>
            </select>
          </label>
          <label className="text-xs font-medium text-zinc-600">開始
            <input name="from" type="date" defaultValue={from} className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium text-zinc-600">終了
            <input name="to" type="date" defaultValue={to} className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium text-zinc-600">並び順
            <select name="sort" defaultValue={sort} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">
              {SORT_OPTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <select name="direction" defaultValue={direction} aria-label="並び方向" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">
              <option value="desc">降順</option><option value="asc">昇順</option>
            </select>
            <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">表示</button>
            <Link href={csvHref} className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">CSV</Link>
          </div>
        </form>

        {!error && rows.length === 0 && <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">対象データがありません。</p>}
        {!error && rows.length > 0 && (
          <>
            <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" aria-labelledby="utilization-chart-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 id="utilization-chart-heading" className="text-base font-semibold text-zinc-900">稼働率グラフ</h2>
                  <p className="mt-1 text-sm text-zinc-600">表示順の上位10商品です。自社保有分の稼働率と、現場在庫に占めるリース品の割合を比較できます。</p>
                </div>
                <p className="text-xs text-zinc-600"><span className="mr-3 inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />自社稼働率</span><span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-violet-500" />リース依存率</span></p>
              </div>
              {chartRows.length === 0 ? (
                <p className="mt-5 text-sm text-zinc-600">グラフに表示できる確定済みの集計データがありません。</p>
              ) : (
                <div className="mt-5 space-y-4">
                  {chartRows.map((row) => (
                    <div key={`chart-${row.period}-${row.productId}`}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                        <p className="min-w-0 truncate font-medium text-zinc-900" title={`${row.productCode ?? ""} ${row.productName}`}>{row.productCode ? `${row.productCode} ` : ""}{row.productName}</p>
                        <p className="shrink-0 tabular-nums text-zinc-700">自社 {formatRate(row.ownedUtilizationRate)} / リース {formatRate(row.leaseDependencyRate)}</p>
                      </div>
                      <div className="space-y-1.5" aria-label={`${row.productName}の稼働率`}>
                        <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-blue-600" style={{ width: chartWidth(row.ownedUtilizationRate) }} /></div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-violet-500" style={{ width: chartWidth(row.leaseDependencyRate) }} /></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
              <table className="w-full min-w-[1800px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600"><tr>
                <th className="px-3 py-3 font-medium">期間</th><th className="px-3 py-3 font-medium">商品</th><th className="px-3 py-3 text-right font-medium">平均自社保有</th><th className="px-3 py-3 text-right font-medium">自社平均稼働</th><th className="px-3 py-3 text-right font-medium">自社稼働率</th><th className="px-3 py-3 text-right font-medium">リース平均稼働</th><th className="px-3 py-3 text-right font-medium">総平均稼働</th><th className="px-3 py-3 text-right font-medium">リース依存率</th><th className="px-3 py-3 text-right font-medium">出庫</th><th className="px-3 py-3 text-right font-medium">返却</th><th className="px-3 py-3 text-right font-medium">回転量</th><th className="px-3 py-3 text-right font-medium">稼働現場</th><th className="px-3 py-3 text-right font-medium">対象日数</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-100">{rows.map((r) => (
                <tr key={`${r.period}-${r.productId}`} className={!r.isAvailable ? "bg-zinc-50 text-zinc-500" : r.ownedUtilizationRate !== null && r.ownedUtilizationRate >= 80 ? "bg-amber-50/60" : "hover:bg-zinc-50/80"}>
                  <td className="px-3 py-3">{formatPeriod(r.period, kind)}</td><td className="px-3 py-3 text-zinc-900">{r.productCode ? `${r.productCode} ` : ""}{r.productName}</td>
                  <td className="px-3 py-3 text-right">{r.avgOwnedHolding === null ? "算出不可" : fmtQty(r.avgOwnedHolding)}</td><td className="px-3 py-3 text-right">{r.avgOwnedSiteQuantity === null ? "算出不可" : fmtQty(r.avgOwnedSiteQuantity)}</td><td className="px-3 py-3 text-right font-medium">{formatRate(r.ownedUtilizationRate)}</td><td className="px-3 py-3 text-right">{r.avgLeasedSiteQuantity === null ? "算出不可" : fmtQty(r.avgLeasedSiteQuantity)}</td><td className="px-3 py-3 text-right">{r.avgTotalSiteQuantity === null ? "算出不可" : fmtQty(r.avgTotalSiteQuantity)}</td><td className="px-3 py-3 text-right font-medium">{formatRate(r.leaseDependencyRate)}</td><td className="px-3 py-3 text-right">{fmtQty(r.shippedQuantity)}</td><td className="px-3 py-3 text-right">{fmtQty(r.returnedQuantity)}</td><td className="px-3 py-3 text-right">{fmtQty(r.turnoverQuantity)}</td><td className="px-3 py-3 text-right">{r.operatingSiteCount ?? "算出不可"}</td><td className="px-3 py-3 text-right">{r.snapshotDays}/{r.expectedDays}</td>
                </tr>
              ))}</tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
