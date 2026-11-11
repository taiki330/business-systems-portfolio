import { fetchOutstandingMaterials } from "@/lib/sites/fetch-outstanding";
import { OWNERSHIP_LABELS } from "@/types/site-progress";
import { ListSearchForm } from "@/components/ui/ListSearchForm";
import { matchesSearchTerm, sanitizeSearchTerm } from "@/lib/search/list-filter";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ scope?: string; q?: string }>;
};

/**
 * 未返却資材一覧（現時点の値）。
 * 「完工したこの日なのに現時点で戻ってきていない」を確認するための画面。
 * 進捗記録のスナップショット（過去の確定値）とは別物。
 */
export default async function OutstandingMaterialsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const completedOnly = sp.scope !== "all";
  const searchTerm = sanitizeSearchTerm(sp.q);
  const { rows, error } = await fetchOutstandingMaterials({ completedOnly });
  const visibleRows = rows.filter((row) =>
    matchesSearchTerm(searchTerm, [
      row.siteName,
      row.productCode,
      row.productName,
      row.categoryName,
      OWNERSHIP_LABELS[row.ownership],
    ]),
  );

  const siteCount = new Set(visibleRows.map((r) => r.siteId)).size;
  const total = visibleRows.reduce((s, r) => s + r.outstandingQuantity, 0);

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">未返却資材一覧</h1>
          <p className="mt-1 text-sm text-zinc-500">
            現時点でまだ現場から戻ってきていない資材です（出庫総数 − 通常返却）。過入庫は返却に含めていません。
          </p>

          <nav className="mt-4 flex gap-2">
            <Link
              href={`/stock/outstanding${searchTerm ? `?q=${encodeURIComponent(searchTerm)}` : ""}`}
              className={
                completedOnly
                  ? "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
              }
            >
              完工済みのみ
            </Link>
            <Link
              href={`/stock/outstanding?scope=all${searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : ""}`}
              className={
                !completedOnly
                  ? "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
              }
            >
              すべての現場
            </Link>
            <Link
              href="/stock/progress"
              className="ml-auto rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              現場進捗へ
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <ListSearchForm
          action="/stock/outstanding"
          value={searchTerm}
          placeholder="現場名・資材名・商品コード・種別で検索"
          count={visibleRows.length}
          clearHref={completedOnly ? "/stock/outstanding" : "/stock/outstanding?scope=all"}
        >
          {!completedOnly && <input type="hidden" name="scope" value="all" />}
        </ListSearchForm>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">未返却資材の読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
          </div>
        )}

        {!error && visibleRows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            {searchTerm
              ? "検索条件に一致する未返却資材がありません。"
              : completedOnly
                ? "完工済みの現場に未返却の資材はありません。"
                : "未返却の資材はありません。"}
          </p>
        )}

        {!error && visibleRows.length > 0 && (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
                <p className="text-xs text-zinc-500">対象現場</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-900">
                  {siteCount}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
                <p className="text-xs text-zinc-500">未返却の品目数</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-900">
                  {visibleRows.length}
                </p>
              </div>
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                <p className="text-xs text-amber-800">未返却 合計数量</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-amber-800">
                  {total}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">現場</th>
                    <th className="px-4 py-3 font-medium">完工日</th>
                    <th className="px-4 py-3 font-medium">資材</th>
                    <th className="px-4 py-3 font-medium">種別</th>
                    <th className="px-4 py-3 font-medium">区分</th>
                    <th className="px-4 py-3 text-right font-medium">出庫</th>
                    <th className="px-4 py-3 text-right font-medium">返却</th>
                    <th className="px-4 py-3 text-right font-medium">未返却</th>
                    <th className="px-4 py-3 text-right font-medium">過入庫</th>
                    <th className="px-4 py-3 text-right font-medium">現場残</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {visibleRows.map((r) => (
                    <tr
                      key={`${r.siteId}-${r.productId}-${r.ownership}`}
                      className="hover:bg-zinc-50/80"
                    >
                      <td className="px-4 py-3 text-zinc-900">{r.siteName}</td>
                      <td className="px-4 py-3 text-zinc-600">
                        {r.completedOn ?? (
                          <span className="text-zinc-400">未完工</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-900">
                        {r.productCode
                          ? `${r.productCode} — ${r.productName}`
                          : r.productName}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {r.categoryName ?? (
                          <span className="text-zinc-400">未分類</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            r.ownership === "leased"
                              ? "rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800"
                              : "rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700"
                          }
                        >
                          {OWNERSHIP_LABELS[r.ownership]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                        {r.shippedQuantity}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                        {r.returnedQuantity}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-700">
                        {r.outstandingQuantity}
                      </td>
                      <td
                        className={
                          r.overReturnQuantity > 0
                            ? "px-4 py-3 text-right font-semibold tabular-nums text-amber-700"
                            : "px-4 py-3 text-right tabular-nums text-zinc-400"
                        }
                      >
                        {r.overReturnQuantity}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-900">
                        {r.siteQuantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
