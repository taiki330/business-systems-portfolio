import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { AnalyticsNav } from "@/components/analytics/AnalyticsNav";
import { fetchSiteSummary } from "@/lib/analytics/fetch-phase5";
import { fmtQty } from "@/lib/analytics/format";
import { defaultDateRange, parseDate } from "@/lib/analytics/period-range";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ from?: string; to?: string; site_id?: string }>;
};

/** 現場別分析（Phase 5 要件3）。D-20260806-03以降はadminのみ。 */
export default async function SiteAnalyticsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const def = defaultDateRange();
  const from = parseDate(sp.from) ?? def.from;
  const to = parseDate(sp.to) ?? def.to;
  const siteId = sp.site_id?.trim() || "";

  const [{ rows: all, error }, sites] = await Promise.all([
    fetchSiteSummary(from, to),
    fetchSiteOptions(),
  ]);
  const rows = siteId ? all.filter((r) => r.siteId === siteId) : all;

  const q = new URLSearchParams({ from, to });
  if (siteId) q.set("site_id", siteId);
  const csvHref = `/analytics/sites/export?${q.toString()}`;

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">現場別分析</h1>
          <p className="mt-1 text-sm text-zinc-500">
            出庫・返却は指定期間、現在庫・未処理依頼・予定数量・超過数量は現況です。
          </p>
          <AnalyticsNav current="/analytics/sites" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            集計を取得できませんでした: {error.message}
          </p>
        )}

        <form method="GET" className="mb-6 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="site_id" className="block text-xs font-medium text-zinc-600">現場</label>
            <SearchableSelect
              id="site_id"
              name="site_id"
              defaultValue={siteId}
              allowEmpty
              emptyLabel="すべて"
              placeholder="現場名の一部を入力"
              options={sites.map((s) => ({
                value: s.id,
                label: s.code ? `${s.code} ${s.name}` : s.name,
                keywords: s.code ?? undefined,
              }))}
            />
          </div>
          <div>
            <label htmlFor="from" className="block text-xs font-medium text-zinc-600">出庫/返却 開始</label>
            <input id="from" name="from" type="date" defaultValue={from}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs font-medium text-zinc-600">出庫/返却 終了</label>
            <input id="to" name="to" type="date" defaultValue={to}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">絞り込み</button>
            <Link href={csvHref} className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">CSV</Link>
          </div>
        </form>

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            対象の現場データがありません。
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">現場</th>
                  <th className="px-4 py-3 text-right font-medium">出庫</th>
                  <th className="px-4 py-3 text-right font-medium">返却</th>
                  <th className="px-4 py-3 text-right font-medium">現在庫</th>
                  <th className="px-4 py-3 text-right font-medium">未処理依頼</th>
                  <th className="px-4 py-3 text-right font-medium">予定数量</th>
                  <th className="px-4 py-3 text-right font-medium">超過</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => (
                  <tr key={r.siteId} className={r.overQuantity > 0 ? "bg-amber-50/60" : "hover:bg-zinc-50/80"}>
                    <td className="px-4 py-3 text-zinc-900">{r.siteName}</td>
                    <td className="px-4 py-3 text-right text-zinc-900">{fmtQty(r.shippedQuantity)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmtQty(r.returnedQuantity)}</td>
                    <td className="px-4 py-3 text-right text-zinc-900">{fmtQty(r.currentStock)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmtQty(r.pendingRequests)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmtQty(r.plannedTotal)}</td>
                    <td className="px-4 py-3 text-right">
                      {r.overQuantity > 0 ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">+{fmtQty(r.overQuantity)}</span>
                      ) : (<span className="text-zinc-400">—</span>)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/leases/stock?site_id=${r.siteId}`} className="text-sm font-medium text-zinc-700 hover:text-zinc-900">
                        在庫内訳
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-sm text-zinc-500">{rows.length} 現場</p>
      </main>
    </div>
  );
}
