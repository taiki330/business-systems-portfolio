import { createClient } from "@/lib/supabase/server";
import type {
  MaterialOwnership,
  SiteOutstandingRow,
} from "@/types/site-progress";

type RawOutstanding = {
  site_id: string;
  product_id: string;
  ownership: MaterialOwnership;
  shipped_quantity: number;
  returned_quantity: number;
  outstanding_quantity: number;
  over_return_quantity: number;
  site_quantity: number;
};

/**
 * 未返却資材の現在値。
 *
 * site_material_outstanding はビューのため PostgREST の埋め込みが使えない
 * （埋め込みは外部キーを前提とする）。現場名・商品名は別途取得して結合する。
 * 完工日は site_progress_latest（区分ごとの最新記録）から解体完了を引く。
 */
export async function fetchOutstandingMaterials(options?: {
  /** 完工（解体完了）が記録済みの現場だけに絞る */
  completedOnly?: boolean;
}): Promise<{
  rows: SiteOutstandingRow[];
  error: { message: string } | null;
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("site_material_outstanding")
    .select(
      "site_id, product_id, ownership, shipped_quantity, returned_quantity, outstanding_quantity, over_return_quantity, site_quantity",
    )
    .gt("outstanding_quantity", 0);

  if (error) return { rows: [], error: { message: error.message } };

  const raws = (data ?? []) as RawOutstanding[];
  if (raws.length === 0) return { rows: [], error: null };

  const siteIds = Array.from(new Set(raws.map((r) => r.site_id)));
  const productIds = Array.from(new Set(raws.map((r) => r.product_id)));

  const [sitesResult, productsResult, completedResult] = await Promise.all([
    supabase.from("sites").select("id, name").in("id", siteIds),
    supabase
      .from("products")
      .select("id, code, name, product_categories(name)")
      .in("id", productIds),
    supabase
      .from("site_progress_latest")
      .select("site_id, occurred_on")
      .eq("kind", "dismantle_completed")
      .in("site_id", siteIds),
  ]);

  const siteNames = new Map<string, string>();
  for (const s of (sitesResult.data ?? []) as { id: string; name: string }[]) {
    siteNames.set(s.id, s.name);
  }

  const products = new Map<
    string,
    { code: string | null; name: string; category: string | null }
  >();
  for (const p of (productsResult.data ?? []) as {
    id: string;
    code: string | null;
    name: string;
    product_categories: { name: string } | { name: string }[] | null;
  }[]) {
    const cat = Array.isArray(p.product_categories)
      ? (p.product_categories[0]?.name ?? null)
      : (p.product_categories?.name ?? null);
    products.set(p.id, { code: p.code, name: p.name, category: cat });
  }

  const completedOn = new Map<string, string>();
  for (const c of (completedResult.data ?? []) as {
    site_id: string;
    occurred_on: string;
  }[]) {
    completedOn.set(c.site_id, c.occurred_on);
  }

  let rows: SiteOutstandingRow[] = raws.map((r) => {
    const p = products.get(r.product_id);
    return {
      siteId: r.site_id,
      siteName: siteNames.get(r.site_id) ?? "(現場不明)",
      completedOn: completedOn.get(r.site_id) ?? null,
      productId: r.product_id,
      productName: p?.name ?? "(商品不明)",
      productCode: p?.code ?? null,
      categoryName: p?.category ?? null,
      ownership: r.ownership,
      shippedQuantity: Number(r.shipped_quantity),
      returnedQuantity: Number(r.returned_quantity),
      outstandingQuantity: Number(r.outstanding_quantity),
      overReturnQuantity: Number(r.over_return_quantity),
      siteQuantity: Number(r.site_quantity),
    };
  });

  if (options?.completedOnly) {
    rows = rows.filter((r) => r.completedOn !== null);
  }

  rows.sort(
    (a, b) =>
      a.siteName.localeCompare(b.siteName, "ja") ||
      a.productName.localeCompare(b.productName, "ja") ||
      a.ownership.localeCompare(b.ownership),
  );

  return { rows, error: null };
}
