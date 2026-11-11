import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { AnalyticsNav } from "@/components/analytics/AnalyticsNav";
import {
  fetchLeaseCompanySummary,
  fetchLeasePeriod,
} from "@/lib/analytics/fetch-phase5";
import { fmtQty } from "@/lib/analytics/format";
import {
  defaultRange,
  formatPeriod,
  parseDate,
  parsePeriodKind,
} from "@/lib/analytics/period-range";
import { fetchLeaseCompanyOptions } from "@/lib/leases/fetch-company-options";
import { fetchProductOptions } from "@/lib/products/fetch-options";
import { ANALYTICS_PERIOD_LABELS } from "@/types/analytics-phase5";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    company_id?: string;
    product_id?: string;
    state?: string;
  }>;
};

/** リース分析（Phase 5 要件5）。D-20260806-03以降はadminのみ。 */
export default async function LeaseAnalyticsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const kind = parsePeriodKind(sp.period);
  const def = defaultRange(kind);
  const from = parseDate(sp.from) ?? def.from;
  const to = parseDate(sp.to) ?? def.to;
  const companyId = sp.company_id?.trim() || "";
  const productId = sp.product_id?.trim() || "";
  const state = sp.state || "all";

  const [{ rows: summaryAll, error: sErr }, { rows: periodAll, error: pErr }, companies, products] =
    await Promise.all([
      fetchLeaseCompanySummary(from, to, productId || undefined),
      fetchLeasePeriod(kind, from, to, productId || undefined),
      fetchLeaseCompanyOptions(),
      fetchProductOptions(),
    ]);

  let summary = companyId
    ? summaryAll.filter((r) => r.leaseCompanyId === companyId)
    : summaryAll;
  if (state === "overdue") summary = summary.filter((r) => r.overdueCount > 0);
  else if (state === "in_field") summary = summary.filter((r) => r.siteStock > 0);

  const period = companyId
    ? periodAll.filter((r) => r.leaseCompanyId === companyId)
    : periodAll;

  const q = new URLSearchParams({ period: kind, from, to });
  if (companyId) q.set("company_id", companyId);
  if (productId) q.set("product_id", productId);
  if (state !== "all") q.set("state", state);
  const csvHref = `/analytics/leases/export?${q.toString()}`;

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">リース分析</h1>
          <p className="mt-1 text-sm text-zinc-500">
            リース会社別の受入・出庫・返却（指定期間）と、現場在庫・返却期限超過（現況）。
          </p>
          <AnalyticsNav current="/analytics/leases" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {(sErr || pErr) && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            集計を取得できませんでした: {(sErr ?? pErr)?.message}
          </p>
        )}

        <form method="GET" className="mb-6 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label htmlFor="company_id" className="block text-xs font-medium text-zinc-600">リース会社</label>
            <select id="company_id" name="company_id" defaultValue={companyId}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">
              <option value="">すべて</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>
          <div>
            <label htmlFor="product_id" className="block text-xs font-medium text-zinc-600">商品</label>
            <SearchableSelect
              id="product_id"
              name="product_id"
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
          </div>
          <div>
            <label htmlFor="state" className="block text-xs font-medium text-zinc-600">状態</label>
            <select id="state" name="state" defaultValue={state}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">
              <option value="all">すべて</option>
              <option value="in_field">現場在庫あり</option>
              <option value="overdue">期限超過あり</option>
            </select>
          </div>
          <div>
            <label htmlFor="period" className="block text-xs font-medium text-zinc-600">期間単位</label>
            <select id="period" name="period" defaultValue={kind}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">
              <option value="month">{ANALYTICS_PERIOD_LABELS.month}</option>
              <option value="year">{ANALYTICS_PERIOD_LABELS.year}</option>
            </select>
          </div>
          <div>
            <label htmlFor="from" className="block text-xs font-medium text-zinc-600">開始</label>
            <input id="from" name="from" type="date" defaultValue={from}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs font-medium text-zinc-600">終了</label>
            <input id="to" name="to" type="date" defaultValue={to}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex items-end gap-2 lg:col-span-6">
            <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">絞り込み</button>
            <Link href={csvHref} className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">CSV（会社別）</Link>
          </div>
        </form>

        {/* 会社別 現況 + 期間フロー */}
        <h2 className="mb-2 text-sm font-semibold text-zinc-900">リース会社別（現況＋期間集計）</h2>
        {!sErr && summary.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            該当するリース会社データがありません。
          </p>
        )}
        {!sErr && summary.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">リース会社</th>
                  <th className="px-4 py-3 text-right font-medium">受入</th>
                  <th className="px-4 py-3 text-right font-medium">出庫</th>
                  <th className="px-4 py-3 text-right font-medium">会社返却</th>
                  <th className="px-4 py-3 text-right font-medium">現場在庫</th>
                  <th className="px-4 py-3 text-right font-medium">返却期限超過</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {summary.map((r) => (
                  <tr key={r.leaseCompanyId} className={r.overdueCount > 0 ? "bg-amber-50/60" : "hover:bg-zinc-50/80"}>
                    <td className="px-4 py-3 text-zinc-900">{r.leaseCompanyName}</td>
                    <td className="px-4 py-3 text-right text-zinc-900">{fmtQty(r.receivedQuantity)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmtQty(r.shippedQuantity)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmtQty(r.returnedQuantity)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmtQty(r.siteStock)}</td>
                    <td className="px-4 py-3 text-right">
                      {r.overdueCount > 0 ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{r.overdueCount} 件</span>
                      ) : (<span className="text-zinc-400">0</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 月別・年別フロー */}
        <h2 className="mb-2 mt-8 text-sm font-semibold text-zinc-900">{ANALYTICS_PERIOD_LABELS[kind]}フロー</h2>
        {!pErr && period.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            対象期間のリースフローがありません。
          </p>
        )}
        {!pErr && period.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">期間</th>
                  <th className="px-4 py-3 font-medium">リース会社</th>
                  <th className="px-4 py-3 text-right font-medium">受入</th>
                  <th className="px-4 py-3 text-right font-medium">出庫</th>
                  <th className="px-4 py-3 text-right font-medium">会社返却</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {period.map((r) => (
                  <tr key={`${r.period}-${r.leaseCompanyId}`} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-900">{formatPeriod(r.period, kind)}</td>
                    <td className="px-4 py-3 text-zinc-900">{r.leaseCompanyName}</td>
                    <td className="px-4 py-3 text-right text-zinc-900">{fmtQty(r.receivedQuantity)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmtQty(r.shippedQuantity)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmtQty(r.returnedToCompany)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
