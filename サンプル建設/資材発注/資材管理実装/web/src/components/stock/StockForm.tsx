import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { CENTER_LOCATION } from "@/lib/stock/constants";
import type { ProductOption, StockItem } from "@/types/stock";
import Link from "next/link";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  products: ProductOption[];
  stockItem?: StockItem;
  mode: "create" | "edit";
  error?: string;
  title: string;
  submitLabel: string;
};

function formatProductLabel(product: ProductOption): string {
  return product.code ? `${product.code} — ${product.name}` : product.name;
}

export function StockForm({
  action,
  products,
  stockItem,
  mode,
  error,
  title,
  submitLabel,
}: Props) {
  const isEdit = mode === "edit";
  const selectedProduct = stockItem
    ? products.find((p) => p.id === stockItem.product_id)
    : undefined;
  const productLabel =
    selectedProduct != null
      ? formatProductLabel(selectedProduct)
      : stockItem?.products
        ? stockItem.products.code
          ? `${stockItem.products.code} — ${stockItem.products.name}`
          : stockItem.products.name
        : "（商品情報なし）";

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href="/stock" className="text-sm text-zinc-600 hover:text-zinc-900">
        ← 在庫一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">{title}</h1>
      {isEdit && (
        <p className="mt-2 text-sm text-zinc-500">
          暫定メンテ：数量のみ変更できます。
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {mode === "create" && products.length === 0 && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          商品マスタにデータがありません。先に
          <Link href="/products/new" className="mx-1 underline">
            商品を登録
          </Link>
          してください。
        </p>
      )}

      <form action={action} className="mt-6 space-y-5">
        {isEdit ? (
          <>
            <div>
              <span className="block text-sm font-medium text-zinc-700">商品</span>
              <p className="mt-1 text-zinc-900">{productLabel}</p>
              <input type="hidden" name="product_id" value={stockItem?.product_id} />
            </div>
            <div>
              <span className="block text-sm font-medium text-zinc-700">
                保管場所
              </span>
              <p className="mt-1 font-mono text-zinc-900">
                {stockItem?.location ?? CENTER_LOCATION}
              </p>
              <input
                type="hidden"
                name="location"
                value={stockItem?.location ?? CENTER_LOCATION}
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label
                htmlFor="product_id"
                className="block text-sm font-medium text-zinc-700"
              >
                商品 <span className="text-red-600">*</span>
              </label>
              <div className="mt-1">
                <SearchableSelect
                  id="product_id"
                  name="product_id"
                  required
                  disabled={products.length === 0}
                  placeholder="資材名・コードの一部を入力"
                  options={products.map((p) => ({
                    value: p.id,
                    label: formatProductLabel(p),
                    keywords: p.code ?? undefined,
                    group: p.category_name ?? null,
                  }))}
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="location"
                className="block text-sm font-medium text-zinc-700"
              >
                保管場所
              </label>
              <input
                id="location"
                name="location"
                type="text"
                defaultValue={CENTER_LOCATION}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
              <p className="mt-1 text-xs text-zinc-500">
                センター在庫は通常「{CENTER_LOCATION}」
              </p>
            </div>
          </>
        )}

        <div>
          <label
            htmlFor="quantity"
            className="block text-sm font-medium text-zinc-700"
          >
            数量 <span className="text-red-600">*</span>
          </label>
          <input
            id="quantity"
            name="quantity"
            type="number"
            required
            min={0}
            step="1"
            defaultValue={stockItem?.quantity ?? 0}
            disabled={mode === "create" && products.length === 0}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:bg-zinc-100"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={mode === "create" && products.length === 0}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitLabel}
          </button>
          <Link
            href="/stock"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  );
}
