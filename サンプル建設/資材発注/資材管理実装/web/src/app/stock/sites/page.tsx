import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  canShowStockReturn,
  resolveUiRole,
} from "@/lib/auth/ui-capabilities";
import { fetchSiteStock } from "@/lib/stock/fetch-site-stock";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import { CenterSectionNav } from "@/components/center/CenterSectionNav";
import { ListSearchForm } from "@/components/ui/ListSearchForm";
import { matchesSearchTerm, sanitizeSearchTerm } from "@/lib/search/list-filter";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string; site_id?: string; q?: string }>;
};

export default async function SiteStockPage({ searchParams }: PageProps) {
  const { error: queryError, ok, site_id, q: rawQuery } = await searchParams;
  const selectedSiteId = site_id?.trim() || "";
  const searchTerm = sanitizeSearchTerm(rawQuery);
  const user = await getCurrentUser();
  const uiRole = resolveUiRole(user);
  const showReturn = canShowStockReturn(uiRole);
  const isCenter = uiRole === "center";
  const [{ rows, completedEmptySiteIds, error }, sites] = await Promise.all([
    fetchSiteStock(selectedSiteId || undefined),
    fetchSiteOptions(),
  ]);
  const selectableSites = sites.filter(
    (site) => !completedEmptySiteIds.includes(site.id),
  );
  const selectedSite = selectableSites.find((site) => site.id === selectedSiteId);
  const siteSummaries = selectableSites.map((site) => {
    const siteRows = rows.filter((row) => row.site_id === site.id);
    return {
      ...site,
      plannedProducts: siteRows.filter((row) => row.planned_quantity != null).length,
      stockedProducts: siteRows.filter((row) => row.quantity > 0).length,
      shortageProducts: siteRows.filter(
        (row) => (row.remaining_planned_quantity ?? 0) > 0,
      ).length,
    };
  });
  const visibleSites = siteSummaries.filter((site) =>
    matchesSearchTerm(searchTerm, [site.code, site.name]),
  );
  const visibleRows = rows.filter((row) =>
    matchesSearchTerm(searchTerm, [
      row.products?.code,
      row.products?.name,
      row.products?.unit,
    ]),
  );

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              現場在庫一覧
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              現場を選ぶと、商品ごとの予定数量・現在庫・予定数量までの残数を確認できます。
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {isCenter && <CenterSectionNav active="site-stock" />}

        {ok === "returned" && (
          <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            返却を登録しました。
          </p>
        )}

        {queryError && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(queryError)}
          </p>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">在庫データの読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
          </div>
        )}

        {!error && !selectedSiteId && (
          <section>
            <ListSearchForm
              action="/stock/sites"
              value={searchTerm}
              placeholder="現場名・現場コードで検索"
              count={visibleSites.length}
            />
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">現場を選択</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  確認したい現場を押してください。
                </p>
              </div>
              <span className="text-sm text-zinc-500">{siteSummaries.length} 現場</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleSites.map((site) => (
                <Link
                  key={site.id}
                  href={`/stock/sites?site_id=${encodeURIComponent(site.id)}`}
                  className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      {site.code && (
                        <p className="font-mono text-xs text-zinc-500">{site.code}</p>
                      )}
                      <h3 className="mt-1 font-semibold text-zinc-900 group-hover:text-blue-800">
                        {site.name}
                      </h3>
                    </div>
                    <span className="text-blue-700" aria-hidden="true">→</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
                    <span>予定 {site.plannedProducts}品目</span>
                    <span>在庫あり {site.stockedProducts}品目</span>
                    <span className={site.shortageProducts > 0 ? "font-medium text-amber-700" : ""}>
                      予定数量残数 {site.shortageProducts}品目
                    </span>
                  </div>
                </Link>
              ))}
            </div>
            {visibleSites.length === 0 && (
              <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
                検索条件に一致する現場がありません。
              </p>
            )}
          </section>
        )}

        {!error && selectedSiteId && !selectedSite && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-6 py-5 text-sm text-red-700">
            指定された現場が見つかりません。
          </p>
        )}

        {!error && selectedSite && (
          <section>
            <Link
              href="/stock/sites"
              className="text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline"
            >
              ← 現場一覧へ戻る
            </Link>
            <div className="mt-4 mb-5 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
              <p className="text-xs text-blue-700">選択中の現場</p>
              <h2 className="mt-1 text-xl font-semibold text-blue-950">
                {selectedSite.code ? `${selectedSite.code} ` : ""}{selectedSite.name}
              </h2>
              <p className="mt-2 text-xs text-blue-800">
                「予定数量残数」は、予定数量からこれまでの出庫数と手配中の数量を引いた数です。
              </p>
            </div>

            <ListSearchForm
              action="/stock/sites"
              value={searchTerm}
              placeholder="商品名・商品コードで検索"
              count={visibleRows.length}
              clearHref={`/stock/sites?site_id=${encodeURIComponent(selectedSite.id)}`}
            >
              <input type="hidden" name="site_id" value={selectedSite.id} />
            </ListSearchForm>

            {visibleRows.length === 0 && (
              <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
                {searchTerm
                  ? "検索条件に一致する資材がありません。"
                  : "この現場には予定数量・現在庫が登録されていません。"}
              </p>
            )}

            {visibleRows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">商品コード</th>
                  <th className="px-4 py-3 font-medium">商品名</th>
                  <th className="px-4 py-3 font-medium">単位</th>
                  <th className="px-4 py-3 font-medium text-right">予定数量</th>
                  <th className="px-4 py-3 font-medium text-right">現在庫</th>
                  <th className="px-4 py-3 font-medium text-right">予定数量残数</th>
                  {showReturn && (
                    <th className="px-4 py-3 font-medium">操作</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visibleRows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 font-mono text-zinc-700">
                      {row.products?.code ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      {row.products?.name ?? (
                        <span className="text-amber-700">（商品未紐づけ）</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {row.products?.unit ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                      {row.planned_quantity ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-zinc-900">
                      {row.quantity}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${
                      (row.remaining_planned_quantity ?? 0) > 0
                        ? "text-amber-700"
                        : "text-emerald-700"
                    }`}>
                      {row.remaining_planned_quantity ?? "-"}
                    </td>
                    {showReturn && (
                      <td className="px-4 py-3">
                        <Link
                          href={`/stock/returns/new?product_id=${encodeURIComponent(row.product_id)}&site_id=${encodeURIComponent(row.site_id)}`}
                          className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                        >
                          返却
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            )}

            <p className="mt-4 text-sm text-zinc-500">{visibleRows.length} 品目</p>
          </section>
        )}
      </main>
    </div>
  );
}
