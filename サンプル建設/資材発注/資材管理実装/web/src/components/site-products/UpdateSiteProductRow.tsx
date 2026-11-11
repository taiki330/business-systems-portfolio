import { updateSiteProduct } from "@/app/sites/[id]/products/actions";
import { DeleteSiteProductButton } from "@/components/site-products/DeleteSiteProductButton";
import type { SiteProductRow } from "@/types/site-product";

type Props = { siteId: string; row: SiteProductRow };

export function UpdateSiteProductRow({ siteId, row }: Props) {
  const action = updateSiteProduct.bind(null, siteId, row.id);
  const productLabel = row.products?.code
    ? `${row.products.code} — ${row.products.name}`
    : (row.products?.name ?? "商品情報なし");
  const overrideValue = row.allow_partial_lot_override === null
    ? "inherit"
    : row.allow_partial_lot_override ? "allow" : "disallow";

  return (
    <tr className="border-b border-zinc-100 last:border-0">
      <td className="px-3 py-3 align-top text-zinc-900">
        {productLabel}
        {row.products?.unit && <span className="ml-2 text-xs text-zinc-500">({row.products.unit})</span>}
      </td>
      <td className="px-3 py-3 align-top" colSpan={3}>
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <form action={action} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-nowrap">
            <input id={`display_order-${row.id}`} name="display_order" type="number" step="1" inputMode="numeric" defaultValue={row.display_order ?? ""} placeholder="表示順" className="w-24 rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900" />
            <input id={`note-${row.id}`} name="note" type="text" defaultValue={row.note ?? ""} placeholder="メモ" className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900" />
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-zinc-700">
              <span>半端な数量</span>
              <select name="allow_partial_lot_override" defaultValue={overrideValue} className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900">
                <option value="inherit">現場の基本設定</option>
                <option value="allow">常に許可</option>
                <option value="disallow">確認対象</option>
              </select>
            </label>
            <button type="submit" className="rounded-lg border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-50">更新</button>
          </form>
          <DeleteSiteProductButton siteId={siteId} id={row.id} productLabel={productLabel} />
        </div>
      </td>
    </tr>
  );
}
