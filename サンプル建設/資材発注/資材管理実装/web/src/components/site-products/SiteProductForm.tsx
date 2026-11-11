import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { ProductOption } from "@/types/stock";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  products: ProductOption[];
  excludeProductIds: string[];
};

export function SiteProductForm({ action, products, excludeProductIds }: Props) {
  const excluded = new Set(excludeProductIds);
  const available = products.filter((product) => !excluded.has(product.id));

  if (available.length === 0) {
    return <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">追加できる商品がありません。商品マスタに商品を追加してください。</p>;
  }

  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
      <div>
        <label htmlFor="product_id" className="block text-sm font-medium text-zinc-700">商品 <span className="text-red-600">*</span></label>
        <div className="mt-1">
          <SearchableSelect
            id="product_id"
            name="product_id"
            required
            placeholder="商品名・コードで検索"
            options={available.map((product) => ({
              value: product.id,
              label: product.code ? `${product.code} — ${product.name}` : product.name,
              keywords: product.code ?? undefined,
              group: product.category_name ?? null,
            }))}
          />
        </div>
      </div>
      <div>
        <label htmlFor="display_order" className="block text-sm font-medium text-zinc-700">表示順</label>
        <input id="display_order" name="display_order" type="number" step="1" inputMode="numeric" placeholder="任意" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900" />
      </div>
      <div>
        <label htmlFor="note" className="block text-sm font-medium text-zinc-700">メモ</label>
        <input id="note" name="note" type="text" placeholder="任意" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900" />
      </div>
      <div>
        <label htmlFor="allow_partial_lot_override" className="block text-sm font-medium text-zinc-700">半端な数量の扱い</label>
        <select id="allow_partial_lot_override" name="allow_partial_lot_override" defaultValue="inherit" className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900">
          <option value="inherit">現場の基本設定を使う</option>
          <option value="allow">常に許可する</option>
          <option value="disallow">確認対象にする</option>
        </select>
      </div>
      <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">追加</button>
    </form>
  );
}
