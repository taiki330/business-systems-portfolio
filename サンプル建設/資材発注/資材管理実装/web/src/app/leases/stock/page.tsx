import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { LeaseSectionNav } from "@/components/leases/LeaseSectionNav";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  canShowLeaseCompanyName,
  resolveUiRole,
} from "@/lib/auth/ui-capabilities";
import { fetchStockBreakdown } from "@/lib/leases/fetch-stock-breakdown";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ site_id?: string; storage_kind?: string }>;
};

/**
 * 在庫内訳（自社所有 / リース会社別 / 借用単位別）。
 *
 * 要件定義書 §3 の一覧項目（商品名・自社所有数量・リース会社別数量・合計数量・
 * 現在地・借用日・返却期限・未返却数量）をこの1画面で確認できる。
 * vendor は RLS により担当現場の行のみが見え、リース会社名は表示されない。
 */
export default async function LeaseStockPage({ searchParams }: PageProps) {
  const { site_id: siteId, storage_kind: storageKind } = await searchParams;

  const user = await getCurrentUser();
  const role = resolveUiRole(user);
  const showCompanyName = canShowLeaseCompanyName(role);

  const [{ products, error }, sites] = await Promise.all([
    fetchStockBreakdown({
      siteId: siteId || undefined,
      storageKind:
        storageKind === "center" || storageKind === "site"
          ? storageKind
          : undefined,
    }),
    fetchSiteOptions(),
  ]);
  const totalLeasedQuantity = products.reduce(
    (sum, product) => sum + product.leasedQuantity,
    0,
  );
  const totalOwnedQuantity = products.reduce(
    (sum, product) => sum + product.ownedQuantity,
    0,
  );

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            リース在庫
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            商品ごとに、借入先の会社・現在地・在庫数量を確認できます。
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <LeaseSectionNav active="stock" />

        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            読み込みエラー: {error.message}
          </p>
        )}

        <form method="GET" className="mb-6 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="storage_kind"
              className="block text-xs font-medium text-zinc-600"
            >
              保管場所
            </label>
            <select
              id="storage_kind"
              name="storage_kind"
              defaultValue={storageKind ?? ""}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
            >
              <option value="">すべて</option>
              <option value="center">センターのみ</option>
              <option value="site">現場のみ</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="site_id"
              className="block text-xs font-medium text-zinc-600"
            >
              現場
            </label>
            <SearchableSelect
              id="site_id"
              name="site_id"
              defaultValue={siteId ?? ""}
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
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            絞り込み
          </button>
        </form>

        {!error && (
          <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
              <dt className="text-sm text-zinc-500">表示中の商品</dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-900">
                {products.length}
                <span className="ml-1 text-sm font-normal">種類</span>
              </dd>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
              <dt className="text-sm text-blue-700">リース在庫</dt>
              <dd className="mt-1 text-2xl font-semibold text-blue-950">
                {totalLeasedQuantity}
              </dd>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-100 px-5 py-4">
              <dt className="text-sm text-zinc-600">自社在庫</dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-900">
                {totalOwnedQuantity}
              </dd>
            </div>
          </dl>
        )}

        {!error && products.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            在庫がありません。
          </p>
        )}

        <div className="space-y-4">
          {products.map((p) => (
            <section
              key={p.productId}
              className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-zinc-900">
                  {p.productCode && (
                    <span className="mr-2 rounded bg-zinc-100 px-2 py-1 font-mono text-xs font-medium text-zinc-600">
                      {p.productCode}
                    </span>
                  )}
                  {p.productName}
                  {p.productUnit ? (
                    <span className="ml-1 text-xs font-normal text-zinc-500">
                      （{p.productUnit}）
                    </span>
                  ) : null}
                </h2>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="text-zinc-600">
                    自社所有{" "}
                    <span className="font-medium text-zinc-900">
                      {p.ownedQuantity}
                    </span>
                  </span>
                  {p.leasedByCompany.map((c) => (
                    <span
                      key={c.leaseCompanyId ?? "unknown"}
                      className="text-zinc-600"
                    >
                      {showCompanyName
                        ? `リース ${c.leaseCompanyName ?? "(会社不明)"}`
                        : "リース"}{" "}
                      <span className="font-medium text-zinc-900">
                        {c.quantity}
                      </span>
                    </span>
                  ))}
                  <span className="text-zinc-600">
                    合計{" "}
                    <span className="font-semibold text-zinc-900">
                      {p.totalQuantity}
                    </span>
                  </span>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-zinc-200 text-xs text-zinc-500">
                    <tr>
                      <th className="py-2 font-medium">区分</th>
                      {showCompanyName && (
                        <th className="py-2 font-medium">リース会社</th>
                      )}
                      <th className="py-2 font-medium">現在地</th>
                      <th className="py-2 text-right font-medium">数量</th>
                      <th className="py-2 font-medium">借用日</th>
                      <th className="py-2 font-medium">返却期限</th>
                      <th className="py-2 text-right font-medium">未返却</th>
                      <th className="py-2 text-right font-medium">借用</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {p.details.map((d, index) => (
                      <tr key={`${d.ownership}-${index}`}>
                        <td className="py-2 text-zinc-700">
                          {d.ownership === "owned" ? "自社所有" : "リース"}
                        </td>
                        {showCompanyName && (
                          <td className="py-2 text-zinc-700">
                            {d.leaseCompanyName ?? "—"}
                          </td>
                        )}
                        <td className="py-2 text-zinc-700">
                          {d.storageKind === "center"
                            ? "センター"
                            : (d.siteName ?? "現場")}
                        </td>
                        <td className="py-2 text-right text-zinc-900">
                          {d.quantity}
                        </td>
                        <td className="py-2 text-zinc-600">
                          {d.borrowedAt ?? "—"}
                        </td>
                        <td className="py-2 text-zinc-600">
                          {d.returnDueDate ?? "—"}
                        </td>
                        <td className="py-2 text-right text-zinc-600">
                          {d.returnObligationQuantity ?? "—"}
                        </td>
                        <td className="py-2 text-right">
                          {d.leaseBatchId ? (
                            <Link
                              href={`/leases/batches/${d.leaseBatchId}`}
                              className="font-medium text-blue-700 hover:text-blue-900 hover:underline"
                            >
                              詳細を見る
                            </Link>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>

        <p className="mt-4 text-sm text-zinc-500">{products.length} 商品</p>
      </main>
    </div>
  );
}
