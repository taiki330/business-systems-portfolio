import { createClient } from "@/lib/supabase/server";
import type { ProductOption } from "@/types/stock";

export type ProductOptionForSite = ProductOption & {
  isRegistered: boolean;
};

/**
 * /requests/new 用の商品オプションを並び替え済みで返す。
 * docs/11 §3-1 / Phase C:
 * - siteId が指定され、site_products に登録があれば
 *     登録品（display_order nulls last → created_at）を上位
 *     未登録品（商品コード / 名前順）を下位
 * - siteId 未指定 or 登録 0 件 → 全商品（既存どおり）
 * - いずれの場合も全商品を選択可能（ブロックしない）
 */
export async function fetchProductOptionsForSite(
  siteId: string | null | undefined,
): Promise<ProductOptionForSite[]> {
  const supabase = await createClient();

  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id, code, name, unit, lot_size")
    .order("code", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (pErr || !products) {
    console.error(
      "fetchProductOptionsForSite (products):",
      pErr?.message ?? "no data",
    );
    return [];
  }

  const all = products as ProductOption[];

  if (!siteId) {
    return all.map((p) => ({ ...p, isRegistered: false }));
  }

  const { data: sp, error: sErr } = await supabase
    .from("site_products")
    .select("product_id, display_order, created_at")
    .eq("site_id", siteId)
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (sErr) {
    console.error("fetchProductOptionsForSite (site_products):", sErr.message);
    return all.map((p) => ({ ...p, isRegistered: false }));
  }

  const orderedIds = (sp ?? []).map((r) => r.product_id as string);
  if (orderedIds.length === 0) {
    return all.map((p) => ({ ...p, isRegistered: false }));
  }

  const productById = new Map(all.map((p) => [p.id, p]));
  const registeredIdSet = new Set(orderedIds);

  const registered: ProductOptionForSite[] = [];
  for (const id of orderedIds) {
    const p = productById.get(id);
    if (p) registered.push({ ...p, isRegistered: true });
  }

  const unregistered: ProductOptionForSite[] = all
    .filter((p) => !registeredIdSet.has(p.id))
    .map((p) => ({ ...p, isRegistered: false }));

  return [...registered, ...unregistered];
}
