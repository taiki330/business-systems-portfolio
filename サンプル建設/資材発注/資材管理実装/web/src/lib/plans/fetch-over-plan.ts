import { createClient } from "@/lib/supabase/server";
import type {
  OverPlanFilters,
  StockRequestPlanStatusRow,
} from "@/types/site-product-plan";

/**
 * 予定数量超過の依頼一覧（admin 用・Phase 3-7）。
 *
 * 計算は DB ビュー stock_request_plan_status が行う。
 * 超過は警告・確認対象であり、この一覧が出庫を止めることはない。
 */

type RawRow = StockRequestPlanStatusRow & {
  sites: { name: string } | { name: string }[] | null;
  products:
    | { code: string | null; name: string; unit: string | null }
    | { code: string | null; name: string; unit: string | null }[]
    | null;
};

function firstOrNull<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function fetchOverPlanRequests(
  filters: OverPlanFilters,
): Promise<{
  rows: StockRequestPlanStatusRow[];
  error: { message: string } | null;
}> {
  const supabase = await createClient();

  let query = supabase
    .from("stock_request_plan_status")
    .select(
      "request_id, site_id, product_id, status, requested_by, requested_at," +
        " requested_quantity, adjusted_quantity, is_adjusted, planned_quantity," +
        " shipped_quantity, expected_quantity, over_quantity, is_over, plan_missing," +
        " sites(name), products(code, name, unit)",
    );

  if (filters.site_id) query = query.eq("site_id", filters.site_id);
  if (filters.product_id) query = query.eq("product_id", filters.product_id);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.over_only) query = query.eq("is_over", true);
  if (filters.pending_only) {
    query = query.in("status", ["requested", "accepted"]);
  }
  if (filters.from) query = query.gte("requested_at", filters.from);
  if (filters.to) {
    // 終了日は当日を含める
    query = query.lte("requested_at", `${filters.to}T23:59:59.999Z`);
  }

  const { data, error } = await query
    .order("requested_at", { ascending: false })
    .limit(500);

  if (error) {
    return { rows: [], error: { message: error.message } };
  }

  const rows = ((data ?? []) as unknown as RawRow[]).map((raw) => {
    const site = firstOrNull(raw.sites);
    const product = firstOrNull(raw.products);
    return {
      request_id: raw.request_id,
      site_id: raw.site_id,
      product_id: raw.product_id,
      status: raw.status,
      requested_by: raw.requested_by,
      requested_at: raw.requested_at,
      requested_quantity: Number(raw.requested_quantity),
      adjusted_quantity: Number(raw.adjusted_quantity),
      is_adjusted: Boolean(raw.is_adjusted),
      planned_quantity:
        raw.planned_quantity === null ? null : Number(raw.planned_quantity),
      shipped_quantity: Number(raw.shipped_quantity),
      expected_quantity: Number(raw.expected_quantity),
      over_quantity:
        raw.over_quantity === null ? null : Number(raw.over_quantity),
      is_over: Boolean(raw.is_over),
      plan_missing: Boolean(raw.plan_missing),
      site_name: site?.name ?? "(現場不明)",
      product_code: product?.code ?? null,
      product_name: product?.name ?? "(商品不明)",
      product_unit: product?.unit ?? null,
      requester_label: null as string | null,
    } satisfies StockRequestPlanStatusRow;
  });

  // 依頼者の表示名を解決（app_users は admin のみ参照可）
  const requesterIds = [
    ...new Set(rows.map((r) => r.requested_by).filter((v): v is string => !!v)),
  ];

  if (requesterIds.length > 0) {
    const { data: users } = await supabase
      .from("app_users")
      .select("id, display_name")
      .in("id", requesterIds);

    const byId = new Map(
      ((users ?? []) as { id: string; display_name: string | null }[]).map(
        (u) => [u.id, u.display_name],
      ),
    );

    for (const row of rows) {
      if (row.requested_by) {
        row.requester_label = byId.get(row.requested_by) ?? null;
      }
    }
  }

  return { rows, error: null };
}
