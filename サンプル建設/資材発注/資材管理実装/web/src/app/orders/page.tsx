import { SiteFilterForm } from "@/components/ui/SiteFilterForm";
import { PaginationNav } from "@/components/ui/PaginationNav";
import { CenterSectionNav } from "@/components/center/CenterSectionNav";
import { parsePage } from "@/lib/pagination";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { resolveUiRole } from "@/lib/auth/ui-capabilities";
import { fetchOrders } from "@/lib/orders/fetch-orders";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ order_number?: string; site_id?: string; page?: string }>;
};

export default async function OrdersPage({ searchParams }: PageProps) {
  const { order_number, site_id, page: rawPage } = await searchParams;
  const orderNumber = order_number?.trim() || "";
  const selectedSiteId = site_id?.trim() || "";
  const page = parsePage(rawPage);

  const [{ rows, error, totalCount, totalPages, page: currentPage }, sites, user] = await Promise.all([
    fetchOrders({
      orderNumber: orderNumber || undefined,
      siteId: selectedSiteId || undefined,
      page,
    }),
    fetchSiteOptions(),
    getCurrentUser(),
  ]);
  const isCenter = resolveUiRole(user) === "center";

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            {isCenter ? "オーダーを確認・印刷" : "オーダー（出庫依頼まとめ）"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {isCenter
              ? "現場またはオーダー番号から対象を探し、資材発注書を印刷してください。"
              : "現場が一度にまとめて依頼した単位。資材発注書に印字されたオーダー番号で呼び出せます。"}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {isCenter && <CenterSectionNav active="orders" />}

        {/* 紙の資材発注書に印字された番号で該当オーダーを呼び出す（E-REQ-01 / E-REQ-02） */}
        <form method="get" action="/orders" className="mb-4 flex flex-wrap items-end gap-3">
          {selectedSiteId && (
            <input type="hidden" name="site_id" value={selectedSiteId} />
          )}
          <div>
            <label
              htmlFor="order_number"
              className="block text-sm font-medium text-zinc-700"
            >
              オーダー番号で検索
            </label>
            <input
              id="order_number"
              name="order_number"
              type="text"
              inputMode="numeric"
              defaultValue={orderNumber}
              placeholder="発注書に印字された番号"
              className="mt-1 w-56 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            検索
          </button>
          {(orderNumber || selectedSiteId) && (
            <Link
              href="/orders"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              条件をクリア
            </Link>
          )}
        </form>

        <SiteFilterForm
          action="/orders"
          sites={sites}
          value={selectedSiteId}
          hiddenParams={{ order_number: orderNumber || undefined }}
          count={error ? undefined : totalCount}
        />

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">オーダーの読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
          </div>
        )}

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            {orderNumber || selectedSiteId
              ? "条件に一致するオーダーがありません。"
              : "オーダーがまだありません。"}
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">依頼日時</th>
                  <th className="px-4 py-3 font-medium">現場</th>
                  <th className="px-4 py-3 font-medium">オーダー番号</th>
                  <th className="px-4 py-3 font-medium text-right">商品数</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-600">
                      {new Date(row.created_at).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">{row.site_name}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {row.order_number ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-900">
                      {row.item_count}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/orders/${row.id}`}
                        className={`inline-flex rounded-lg px-3 py-2 text-sm font-semibold ${
                          isCenter
                            ? "bg-blue-700 text-white hover:bg-blue-800"
                            : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
                        }`}
                      >
                        {isCenter ? "確認・印刷 →" : "詳細"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && (
          <PaginationNav
            pathname="/orders"
            page={currentPage}
            totalPages={totalPages}
            totalCount={totalCount}
            params={{ order_number: orderNumber || undefined, site_id: selectedSiteId || undefined }}
          />
        )}

      </main>
    </div>
  );
}
