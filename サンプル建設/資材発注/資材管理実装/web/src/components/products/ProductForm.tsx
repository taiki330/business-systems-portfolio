import type { Product } from "@/types/product";
import type { ProductCategoryOption } from "@/types/product-category";
import Link from "next/link";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  product?: Product;
  /** 資材種別の選択肢（Phase 7-1）。未登録なら種別欄は案内のみを表示する。 */
  categories: ProductCategoryOption[];
  error?: string;
  title: string;
  submitLabel: string;
};

export function ProductForm({
  action,
  product,
  categories,
  error,
  title,
  submitLabel,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <Link
        href="/products"
        className="text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← 商品一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">{title}</h1>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={action} className="mt-6 space-y-5">
        <div>
          <label
            htmlFor="code"
            className="block text-sm font-medium text-zinc-700"
          >
            コード
          </label>
          <input
            id="code"
            name="code"
            type="text"
            defaultValue={product?.code ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            placeholder="任意"
          />
        </div>

        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-zinc-700"
          >
            名称 <span className="text-red-600">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={product?.name ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>

        <div>
          <label
            htmlFor="unit"
            className="block text-sm font-medium text-zinc-700"
          >
            単位
          </label>
          <input
            id="unit"
            name="unit"
            type="text"
            defaultValue={product?.unit ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            placeholder="任意（例: 本、個）"
          />
        </div>

        <div>
          <label
            htmlFor="category_id"
            className="block text-sm font-medium text-zinc-700"
          >
            分類
          </label>
          <select
            id="category_id"
            name="category_id"
            defaultValue={product?.category_id ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          >
            <option value="">未分類</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {categories.length === 0 && <p className="mt-1 text-xs text-zinc-500">分類は未設定です。</p>}
        </div>

        <div>
          <label
            htmlFor="lot_size"
            className="block text-sm font-medium text-zinc-700"
          >
            セット数
          </label>
          <input
            id="lot_size"
            name="lot_size"
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            defaultValue={product?.lot_size ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            placeholder="任意（空欄=制約なし）"
          />
          <p className="mt-1 text-xs text-zinc-500">
            設定すると、半端もんが許可されていない現場でこの数の倍数以外の依頼があったとき、
            「半端もんの確認」画面で確認できるようになります（依頼自体はブロックされません）。
          </p>
        </div>

        <div>
          <label
            htmlFor="weight_kg"
            className="block text-sm font-medium text-zinc-700"
          >
            重量（kg）
          </label>
          <input
            id="weight_kg"
            name="weight_kg"
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            defaultValue={product?.weight_kg ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            placeholder="任意（1単位あたりの重量）"
          />
          <p className="mt-1 text-xs text-zinc-500">
            資材発注書の合計重量を自動計算するために使います。未登録の資材は合計に含まれません。
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            {submitLabel}
          </button>
          <Link
            href="/products"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  );
}
