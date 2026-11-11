import { fetchProductOptions } from "@/lib/products/fetch-options";
import { fetchPurchases } from "@/lib/purchases/fetch-purchases";
import { fetchSupplierOptions } from "@/lib/purchases/fetch-suppliers";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    product_id?: string;
    supplier_id?: string;
  }>;
};

/** 仕入れ（購入）履歴の一覧（事務のみ）。 */
export default async function PurchasesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const productId = sp.product_id?.trim() || "";
  const supplierId = sp.supplier_id?.trim() || "";

  const [{ rows, error }, products, suppliers] = await Promise.all([
    fetchPurchases({
      productId: productId || undefined,
      supplierId: supplierId || undefined,
    }),
    fetchProductOptions(),
    fetchSupplierOptions(supplierId || undefined),
  ]);

  const total = rows.reduce((s, r) => s + r.quantity, 0);
  const csvQuery = new URLSearchParams();
  if (productId) csvQuery.set("product_id", productId);
  if (supplierId) csvQuery.set("supplier_id", supplierId);
  const csvHref = `/purchases/export${csvQuery.toString() ? `?${csvQuery}` : ""}`;

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-start justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">仕入れ管理</h1>
            <p className="mt-1 text-sm text-zinc-500">
              購入した資材の記録です。登録するとセンター在庫が増え、在庫履歴には「仕入れ」として記録されます。
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/purchases/suppliers"
              className="whitespace-nowrap rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              仕入先マスタ
            </Link>
            <Link
              href="/purchases/new"
              className="whitespace-nowrap rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              仕入れを登録
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {sp.error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(sp.error)}
          </p>
        )}
        {sp.ok === "registered" && (
          <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            仕入れを登録しました。センター在庫に反映されています。
          </p>
        )}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">仕入れ履歴の読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
          </div>
        )}

        <form
          method="GET"
          action="/purchases"
          className="mb-6 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="text-xs font-medium text-zinc-600">
            資材
            <SearchableSelect
              name="product_id"
              ariaLabel="資材で絞り込む"
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
          <label className="text-xs font-medium text-zinc-600">
            仕入先
            <SearchableSelect
              name="supplier_id"
              ariaLabel="仕入先で絞り込む"
              defaultValue={supplierId}
              allowEmpty
              emptyLabel="すべて"
              placeholder="仕入先名の一部を入力"
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              絞り込む
            </button>
            {(productId || supplierId) && (
              <Link
                href="/purchases"
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                クリア
              </Link>
            )}
          </div>
          <div className="flex items-end">
            <Link
              href={csvHref}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Excel（CSV）出力
            </Link>
          </div>
        </form>

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            仕入れの記録がまだありません。
          </p>
        )}

        {!error && rows.length > 0 && (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
                <p className="text-xs text-zinc-500">件数</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-900">
                  {rows.length}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
                <p className="text-xs text-zinc-500">仕入れ数量 合計</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-900">
                  {total}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">購入日</th>
                    <th className="px-4 py-3 font-medium">仕入先</th>
                    <th className="px-4 py-3 font-medium">資材</th>
                    <th className="px-4 py-3 font-medium">種別</th>
                    <th className="px-4 py-3 text-right font-medium">数量</th>
                    <th className="px-4 py-3 font-medium">備考</th>
                    <th className="px-4 py-3 font-medium">登録</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-50/80">
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-900">
                        {row.purchaseDate}
                      </td>
                      <td className="px-4 py-3 text-zinc-900">{row.supplierName}</td>
                      <td className="px-4 py-3 text-zinc-900">
                        {row.productCode
                          ? `${row.productCode} — ${row.productName}`
                          : row.productName}
                        {row.productUnit && (
                          <span className="ml-1 text-xs text-zinc-500">
                            ({row.productUnit})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {row.categoryName ?? (
                          <span className="text-zinc-400">未分類</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-zinc-900">
                        {row.quantity}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">{row.note ?? "—"}</td>
                      <td className="px-4 py-3 text-zinc-500">
                        <div>{new Date(row.createdAt).toLocaleString("ja-JP")}</div>
                        <div className="text-xs">{row.createdByName ?? "-"}</div>
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
