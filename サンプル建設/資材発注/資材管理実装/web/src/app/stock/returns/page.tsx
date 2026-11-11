import { SiteFilterForm } from "@/components/ui/SiteFilterForm";
import { ListSearchForm } from "@/components/ui/ListSearchForm";
import { PaginationNav } from "@/components/ui/PaginationNav";
import { parsePage } from "@/lib/pagination";
import { sanitizeSearchTerm } from "@/lib/search/list-filter";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import { fetchReturnHistory } from "@/lib/stock/fetch-return-history";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ site_id?: string; q?: string; ok?: string; page?: string }>;
};

export default async function StockReturnsPage({ searchParams }: PageProps) {
  const { site_id, q: rawQuery, ok, page: rawPage } = await searchParams;
  const selectedSiteId = site_id?.trim() || "";
  const searchTerm = sanitizeSearchTerm(rawQuery);
  const page = parsePage(rawPage);

  const [{ rows, error, totalCount, totalPages, page: currentPage }, sites] = await Promise.all([
    fetchReturnHistory({ siteId: selectedSiteId || undefined, search: searchTerm, page }),
    fetchSiteOptions(),
  ]);

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              返却履歴
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              現場からセンターへ返却された履歴です（新しい順に50件ずつ表示）。
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/history-archive"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              1年以上前をExcel出力
            </Link>
            <Link
              href="/stock/returns/new"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              返却を登録
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {ok === "corrected" && <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">返却登録を修正し、在庫数にも反映しました。</p>}
        <SiteFilterForm
          action="/stock/returns"
          sites={sites}
          value={selectedSiteId}
          hiddenParams={{ q: searchTerm }}
          count={error ? undefined : totalCount}
        />

        <ListSearchForm
          action="/stock/returns"
          value={searchTerm}
          placeholder="現場名・商品名・商品コード・メモで検索"
          count={totalCount}
          clearHref={
            selectedSiteId
              ? `/stock/returns?site_id=${encodeURIComponent(selectedSiteId)}`
              : "/stock/returns"
          }
        >
          {selectedSiteId && (
            <input type="hidden" name="site_id" value={selectedSiteId} />
          )}
        </ListSearchForm>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">返却履歴の読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
          </div>
        )}

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            {searchTerm
              ? "検索条件に一致する返却履歴がありません。"
              : "返却履歴のデータがありません。"}
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">現場</th>
                  <th className="px-4 py-3 font-medium">商品名</th>
                  <th className="px-4 py-3 font-medium text-right">返却入力</th>
                  <th className="px-4 py-3 font-medium">内訳</th>
                  <th className="px-4 py-3 font-medium">メモ</th>
                  <th className="px-4 py-3 font-medium">返却者</th>
                  <th className="px-4 py-3 font-medium">返却日時</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-900">
                      {row.sites?.name ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      {row.products?.name ?? (
                        <span className="text-amber-700">（商品未紐づけ）</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-zinc-900">
                      {row.inputQuantity}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-600">通常 {row.quantity}{row.overQuantity > 0 ? `／過入庫 ${row.overQuantity}` : ""}{row.correctedAt && <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-blue-700">修正済み</span>}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {row.memo ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {row.returnedByName ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {new Date(row.createdAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-4 py-3"><Link href={`/stock/returns/${row.id}/edit`} className="font-medium text-blue-700 hover:underline">修正</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && (
          <PaginationNav
            pathname="/stock/returns"
            page={currentPage}
            totalPages={totalPages}
            totalCount={totalCount}
            params={{ site_id: selectedSiteId || undefined, q: searchTerm || undefined }}
          />
        )}
      </main>
    </div>
  );
}
