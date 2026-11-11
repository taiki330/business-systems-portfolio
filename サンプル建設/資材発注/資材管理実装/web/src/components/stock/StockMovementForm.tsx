import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { CENTER_LOCATION } from "@/lib/stock/constants";
import type { ProductOption } from "@/types/stock";
import type { MovementType } from "@/types/stock-ledger";
import Link from "next/link";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  products: ProductOption[];
  error?: string;
};

function formatProductLabel(product: ProductOption): string {
  return product.code ? `${product.code} — ${product.name}` : product.name;
}

export function StockMovementForm({ action, products, error }: Props) {
  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href="/stock" className="text-sm text-zinc-600 hover:text-zinc-900">
        ← 在庫一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">入出庫登録</h1>
      <p className="mt-2 text-sm text-zinc-500">
        ledger に履歴を残し、現在庫（stock_items）を更新します。
      </p>

      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <span className="font-medium">仮実装:</span>{" "}
        出庫依頼・受付とは未連携です。OUT 登録時点で在庫を減らします（減算タイミングは
        P0-1 未確定のため、顧客確認後に見直し）。
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {products.length === 0 && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          商品マスタにデータがありません。先に
          <Link href="/products/new" className="mx-1 underline">
            商品を登録
          </Link>
          してください。
        </p>
      )}

      <form action={action} className="mt-6 space-y-5">
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
          <span className="block text-sm font-medium text-zinc-700">
            種別 <span className="text-red-600">*</span>
          </span>
          <div className="mt-2 flex gap-4">
            {(
              [
                { value: "in", label: "入庫 (IN)" },
                { value: "out", label: "出庫 (OUT)" },
              ] as { value: MovementType; label: string }[]
            ).map((opt) => (
              <label key={opt.value} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="movement_type"
                  value={opt.value}
                  defaultChecked={opt.value === "in"}
                  required
                  className="text-zinc-900"
                />
                {opt.label}
              </label>
            ))}
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
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>

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
            min={0.01}
            step="1"
            disabled={products.length === 0}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:bg-zinc-100"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={products.length === 0}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            登録
          </button>
          <Link
            href="/stock/ledger"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            履歴一覧
          </Link>
        </div>
      </form>
    </div>
  );
}
