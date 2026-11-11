import { createClient } from "@/lib/supabase/server";
import type {
  SiteProductPlan,
  SiteProductPlanStatusRow,
} from "@/types/site-product-plan";

/**
 * 現場×商品の予定数量と実績（既出庫・未処理依頼・見込・超過）。
 *
 * 計算は DB ビュー site_product_plan_status（security_invoker）が行う。
 * 超過は警告用であり、ここでの判定が出庫を止めることはない。
 */

type PlanRawProduct = {
  code: string | null;
  name: string;
  unit: string | null;
  lot_size: number | null;
};

type RawStatusRow = SiteProductPlanStatusRow & {
  sites: { name: string } | { name: string }[] | null;
  products:
    | PlanRawProduct
    | PlanRawProduct[]
    | null;
};

function firstOrNull<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function fetchSiteProductPlanStatus(filters?: {
  siteId?: string;
  productId?: string;
  overOnly?: boolean;
}): Promise<{
  rows: SiteProductPlanStatusRow[];
  error: { message: string } | null;
}> {
  const supabase = await createClient();

  let query = supabase
    .from("site_product_plan_status")
    .select(
      "plan_id, site_id, product_id, planned_quantity, shipped_quantity," +
        " current_site_quantity, pending_quantity, expected_quantity," +
        " over_quantity, is_over, note, updated_at," +
        " sites(name), products(code, name, unit, lot_size)",
    );

  if (filters?.siteId) query = query.eq("site_id", filters.siteId);
  if (filters?.productId) query = query.eq("product_id", filters.productId);
  if (filters?.overOnly) query = query.eq("is_over", true);

  const { data, error } = await query;

  if (error) {
    return { rows: [], error: { message: error.message } };
  }

  const rows: SiteProductPlanStatusRow[] = (
    (data ?? []) as unknown as RawStatusRow[]
  ).map((raw) => {
    const site = firstOrNull(raw.sites);
    const product = firstOrNull(raw.products);
    return {
      plan_id: raw.plan_id,
      site_id: raw.site_id,
      product_id: raw.product_id,
      planned_quantity: Number(raw.planned_quantity),
      shipped_quantity: Number(raw.shipped_quantity),
      current_site_quantity: Number(raw.current_site_quantity),
      pending_quantity: Number(raw.pending_quantity),
      expected_quantity: Number(raw.expected_quantity),
      over_quantity: Number(raw.over_quantity),
      is_over: Boolean(raw.is_over),
      note: raw.note,
      updated_at: raw.updated_at,
      site_name: site?.name ?? "(現場不明)",
      product_code: product?.code ?? null,
      product_name: product?.name ?? "(商品不明)",
      product_unit: product?.unit ?? null,
      product_lot_size:
        product?.lot_size == null ? null : Number(product.lot_size),
    };
  });

  rows.sort((a, b) => {
    if (a.is_over !== b.is_over) return a.is_over ? -1 : 1;
    if (a.site_name !== b.site_name) {
      return a.site_name.localeCompare(b.site_name, "ja");
    }
    return a.product_name.localeCompare(b.product_name, "ja");
  });

  return { rows, error: null };
}

/** 編集フォーム用に予定数量1件を取得する */
export async function fetchSiteProductPlan(
  id: string,
): Promise<SiteProductPlan | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("site_product_plans")
    .select("id, site_id, product_id, planned_quantity, note, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return data as SiteProductPlan;
}
