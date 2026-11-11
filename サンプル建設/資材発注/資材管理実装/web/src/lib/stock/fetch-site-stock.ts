import { createClient } from "@/lib/supabase/server";
import { normalizeProductRef } from "@/lib/stock/normalize-product-ref";
import type { SiteRef, SiteStockRow, StockProductRef } from "@/types/stock";

type RawSiteStockRow = {
  id: string;
  product_id: string;
  site_id: string | null;
  quantity: number;
  products: StockProductRef | StockProductRef[] | null;
  sites: SiteRef | SiteRef[] | null;
};

type RawPlanRow = {
  plan_id: string;
  site_id: string;
  product_id: string;
  planned_quantity: number;
  current_site_quantity: number;
  expected_quantity: number;
  products: StockProductRef | StockProductRef[] | null;
  sites: SiteRef | SiteRef[] | null;
};

function normalizeSiteRef(raw: SiteRef | SiteRef[] | null): SiteRef | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

/**
 * 現場在庫（storage_kind='site'）の一覧を取得する。
 * siteId を渡すとその現場だけに絞り込む。
 */
export async function fetchSiteStock(siteId?: string): Promise<{
  rows: SiteStockRow[];
  completedEmptySiteIds: string[];
  error: { message: string } | null;
}> {
  const supabase = await createClient();
  let query = supabase
    .from("stock_items")
    .select(
      "id, product_id, site_id, quantity, products(code, name, unit), sites(name)",
    )
    .eq("storage_kind", "site")
    .gt("quantity", 0);

  if (siteId) query = query.eq("site_id", siteId);

  const [
    { data, error },
    { data: plans, error: planError },
    { data: completedSites, error: completedError },
    { data: leasedStock, error: leasedStockError },
  ] = await Promise.all([
    query,
    (siteId
      ? supabase
          .from("site_product_plan_status")
          .select(
            "plan_id, site_id, product_id, planned_quantity, current_site_quantity, expected_quantity, products(code, name, unit), sites(name)",
          )
          .eq("site_id", siteId)
      : supabase
          .from("site_product_plan_status")
          .select(
            "plan_id, site_id, product_id, planned_quantity, current_site_quantity, expected_quantity, products(code, name, unit), sites(name)",
          )),
    supabase
      .from("site_progress_events")
      .select("site_id")
      .eq("kind", "dismantle_completed"),
    supabase
      .from("lease_stock_items")
      .select("site_id")
      .eq("storage_kind", "site")
      .gt("quantity", 0),
  ]);

  if (error || planError || completedError || leasedStockError) {
    return {
      rows: [],
      completedEmptySiteIds: [],
      error: { message: (error ?? planError ?? completedError ?? leasedStockError)!.message },
    };
  }

  // 同じ現場・商品に在庫行が複数あっても、画面では商品単位にまとめる。
  const rowBySiteProduct = new Map<string, SiteStockRow>();
  for (const row of data ?? []) {
    const raw = row as RawSiteStockRow;
    const key = `${raw.site_id}:${raw.product_id}`;
    const existing = rowBySiteProduct.get(key);
    if (existing) {
      existing.quantity += Number(raw.quantity);
      continue;
    }
    rowBySiteProduct.set(key, {
      id: raw.id,
      product_id: raw.product_id,
      site_id: raw.site_id ?? "",
      quantity: Number(raw.quantity),
      products: normalizeProductRef(raw.products),
      sites: normalizeSiteRef(raw.sites),
      planned_quantity: null,
      expected_quantity: null,
      remaining_planned_quantity: null,
    });
  }

  // 予定だけ登録され、まだ在庫が0の商品も詳細に表示する。
  for (const plan of (plans ?? []) as unknown as RawPlanRow[]) {
    const key = `${plan.site_id}:${plan.product_id}`;
    const planned = Number(plan.planned_quantity);
    const current = Number(plan.current_site_quantity);
    const expected = Number(plan.expected_quantity);
    const existing = rowBySiteProduct.get(key);
    if (existing) {
      // 予定ステータスの現在庫は、自社資材とリース資材を合算した値。
      existing.quantity = current;
      existing.planned_quantity = planned;
      existing.expected_quantity = expected;
      existing.remaining_planned_quantity = Math.max(0, planned - expected);
      continue;
    }
    rowBySiteProduct.set(key, {
      id: `plan:${plan.plan_id}`,
      product_id: plan.product_id,
      site_id: plan.site_id,
      quantity: current,
      products: normalizeProductRef(plan.products),
      sites: normalizeSiteRef(plan.sites),
      planned_quantity: planned,
      expected_quantity: expected,
      remaining_planned_quantity: Math.max(0, planned - expected),
    });
  }

  const rows = [...rowBySiteProduct.values()];

  rows.sort((a, b) => {
    const siteA = a.sites?.name ?? "";
    const siteB = b.sites?.name ?? "";
    if (siteA !== siteB) return siteA.localeCompare(siteB, "ja");
    const codeA = a.products?.code ?? "";
    const codeB = b.products?.code ?? "";
    if (codeA !== codeB) return codeA.localeCompare(codeB, "ja");
    return (a.products?.name ?? "").localeCompare(b.products?.name ?? "", "ja");
  });

  const sitesWithPhysicalStock = new Set<string>();
  for (const row of data ?? []) {
    const siteId = (row as RawSiteStockRow).site_id;
    if (siteId) sitesWithPhysicalStock.add(siteId);
  }
  for (const row of leasedStock ?? []) {
    const siteId = (row as { site_id: string | null }).site_id;
    if (siteId) sitesWithPhysicalStock.add(siteId);
  }

  const completedEmptySiteIds = [...new Set(
    (completedSites ?? [])
      .map((row) => (row as { site_id: string }).site_id)
      .filter((completedSiteId) => !sitesWithPhysicalStock.has(completedSiteId)),
  )];

  return { rows, completedEmptySiteIds, error: null };
}
