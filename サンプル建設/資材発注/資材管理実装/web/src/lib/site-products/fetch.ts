import { createClient } from "@/lib/supabase/server";
import type { SiteProductRow } from "@/types/site-product";

type RawRow = Omit<SiteProductRow, "products"> & {
  products:
    | { code: string | null; name: string; unit: string | null }
    | { code: string | null; name: string; unit: string | null }[]
    | null;
};

function pickFirst<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * 当該現場に登録された site_products を取得。
 * docs/11 §3-1 / docs/06 site_products_site_order_idx の方針に揃え、
 * display_order nulls last → 商品コード昇順で並べる。
 */
export async function fetchSiteProductsBySite(
  siteId: string,
): Promise<SiteProductRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("site_products")
    .select(
      "id, site_id, product_id, display_order, note, allow_partial_lot_override, created_at, updated_at, products(code, name, unit)",
    )
    .eq("site_id", siteId)
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("fetchSiteProductsBySite:", error.message);
    return [];
  }

  return ((data ?? []) as RawRow[]).map((raw) => ({
    id: raw.id,
    site_id: raw.site_id,
    product_id: raw.product_id,
    display_order: raw.display_order,
    note: raw.note,
    allow_partial_lot_override: raw.allow_partial_lot_override,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    products: pickFirst(raw.products),
  }));
}
