import { confirmOverReturn } from "@/app/stock/over-returns/actions";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { resolveUiRole } from "@/lib/auth/ui-capabilities";
import { SiteFilterForm } from "@/components/ui/SiteFilterForm";
import { ListSearchForm } from "@/components/ui/ListSearchForm";
import { PaginationNav } from "@/components/ui/PaginationNav";
import { parsePage } from "@/lib/pagination";
import { sanitizeSearchTerm } from "@/lib/search/list-filter";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import { fetchOverReturns } from "@/lib/stock/fetch-over-returns";
import {
  isOverReturnStatus,
  OVER_RETURN_STATUS_LABELS,
  type OverReturnStatus,
} from "@/types/over-return";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{
    status?: string;
    error?: string;
    ok?: string;
    site_id?: string;
    q?: string;
    page?: string;
  }>;
};

const FILTERS: { value: string; label: string }[] = [
  { value: "unconfirmed", label: "未確認" },
  { value: "confirmed", label: "確認済み" },
  { value: "all", label: "すべて" },
];

/**
 * 過入庫一覧（事務向け）。
 * 過入庫は在庫に反映されていない記録であり、確認しても在庫数は変わらない。
 */
export default async function OverReturnsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filter = sp.status && FILTERS.some((f) => f.value === sp.status)
    ? sp.status
    : "unconfirmed";
  const status: OverReturnStatus | undefined = isOverReturnStatus(filter)
    ? filter
    : undefined;

  const selectedSiteId = sp.site_id?.trim() || "";
  const searchTerm = sanitizeSearchTerm(sp.q);
  const page = parsePage(sp.page);

  const [{ rows, error, totalCount, totalPages, page: currentPage }, user, sites] = await Promise.all([
    fetchOverReturns({ status, siteId: selectedSiteId || undefined, search: searchTerm, page }),
    getCurrentUser(),
    fetchSiteOptions(),
  ]);
  const canConfirm = resolveUiRole(user) === "admin";

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">過入庫一覧</h1>
          <p className="mt-1 text-sm text-zinc-500">
            出庫数を超えて返却された分です。在庫には加算されていません。確認済みにしても在庫数は変わりません。
          </p>

          <nav className="mt-4 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={`/stock/over-returns?status=${f.value}${selectedSiteId ? `&site_id=${encodeURIComponent(selectedSiteId)}` : ""}${searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : ""}`}
                className={
                  f.value === filter
                    ? "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white"
                    : "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                }
              >
                {f.label}
              </Link>
            ))}
            <Link
              href="/history-archive"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              1年以上前をExcel出力
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <SiteFilterForm
          action="/stock/over-returns"
          sites={sites}
          value={selectedSiteId}
          hiddenParams={{ status: filter, q: searchTerm }}
          count={error ? undefined : totalCount}
        />

        <ListSearchForm
          action="/stock/over-returns"
          value={searchTerm}
          placeholder="現場名・商品名・商品コード・備考で検索"
          count={totalCount}
          clearHref={`/stock/over-returns?status=${encodeURIComponent(filter)}${selectedSiteId ? `&site_id=${encodeURIComponent(selectedSiteId)}` : ""}`}
        >
          <input type="hidden" name="status" value={filter} />
          {selectedSiteId && (
            <input type="hidden" name="site_id" value={selectedSiteId} />
          )}
        </ListSearchForm>

        {sp.error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(sp.error)}
          </p>
        )}
        {sp.ok === "confirmed" && (
          <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            確認済みにしました（在庫数は変更していません）。
          </p>
        )}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">過入庫一覧の読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
          </div>
        )}

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            {searchTerm
              ? "検索条件に一致する過入庫がありません。"
              : "対象の過入庫はありません。"}
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">現場</th>
                  <th className="px-4 py-3 font-medium">商品名</th>
                  <th className="px-4 py-3 text-right font-medium">返却入力</th>
                  <th className="px-4 py-3 text-right font-medium">在庫加算</th>
                  <th className="px-4 py-3 text-right font-medium">過入庫</th>
                  <th className="px-4 py-3 font-medium">状態</th>
                  <th className="px-4 py-3 font-medium">備考</th>
                  <th className="px-4 py-3 font-medium">登録</th>
                  {canConfirm && <th className="px-4 py-3 font-medium">確認</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-900">{row.sites?.name ?? "-"}</td>
                    <td className="px-4 py-3 text-zinc-900">
                      {row.products
                        ? row.products.code
                          ? `${row.products.code} — ${row.products.name}`
                          : row.products.name
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-600">
                      {row.inputQuantity}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-600">
                      {row.normalQuantity}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-700">
                      {row.quantity}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.status === "unconfirmed"
                            ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                            : "rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600"
                        }
                      >
                        {OVER_RETURN_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{row.memo ?? "-"}</td>
                    <td className="px-4 py-3 text-zinc-500">
                      <div>{new Date(row.createdAt).toLocaleString("ja-JP")}</div>
                      <div className="text-xs">{row.createdByName ?? "-"}</div>
                    </td>
                    {canConfirm && (
                      <td className="px-4 py-3">
                        {row.status === "unconfirmed" ? (
                          <form action={confirmOverReturn} className="flex gap-2">
                            <input type="hidden" name="id" value={row.id} />
                            <input type="hidden" name="status" value={filter} />
                            <input
                              type="text"
                              name="memo"
                              placeholder="備考（任意）"
                              className="w-40 rounded-lg border border-zinc-300 px-2 py-1 text-sm"
                            />
                            <button
                              type="submit"
                              className="rounded-lg bg-zinc-900 px-3 py-1 text-sm font-medium text-white hover:bg-zinc-800"
                            >
                              確認済みにする
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-zinc-500">
                            {row.confirmedAt
                              ? `${new Date(row.confirmedAt).toLocaleString("ja-JP")} / ${row.confirmedByName ?? "-"}`
                              : "-"}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && (
          <PaginationNav
            pathname="/stock/over-returns"
            page={currentPage}
            totalPages={totalPages}
            totalCount={totalCount}
            params={{ status: filter, site_id: selectedSiteId || undefined, q: searchTerm || undefined }}
          />
        )}
      </main>
    </div>
  );
}
