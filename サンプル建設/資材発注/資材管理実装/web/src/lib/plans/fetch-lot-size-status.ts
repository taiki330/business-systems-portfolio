import { createClient } from "@/lib/supabase/server";
import type {
  LotSizeStatusFilters,
  StockRequestLotSizeStatusRow,
} from "@/types/lot-size-status";

/**
 * 半端もん（セット数の倍数以外）の依頼一覧（admin 用）。
 *
 * 計算は DB ビュー stock_request_lot_size_status が行う。
 * 半端もんは警告・確認対象であり、この一覧が出庫依頼の作成・出庫を止めることはない。
 */

type RawRow = StockRequestLotSizeStatusRow & {
  sites: { name: string } | { name: string }[] | null;
  products:
    | { code: string | null; name: string; unit: string | null }
    | { code: string | null; name: string; unit: string | null }[]
    | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstOrNull<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function fetchLotSizeViolations(
  filters: LotSizeStatusFilters,
): Promise<{
  rows: StockRequestLotSizeStatusRow[];
  error: { message: string } | null;
}> {
  const supabase = await createClient();

  let query = supabase
    .from("stock_request_lot_size_status")
    .select(
      "request_id, site_id, product_id, quantity, status, requested_by, requested_at," +
        " lot_size, order_unit, allow_partial_lot, is_lot_size_violation," +
        " sites(name), products(code, name, unit)",
    );

  if (filters.site_id) query = query.eq("site_id", filters.site_id);
  if (filters.product_id) query = query.eq("product_id", filters.product_id);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.violation_only) query = query.eq("is_lot_size_violation", true);
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
      quantity: Number(raw.quantity),
      status: raw.status,
      requested_by: raw.requested_by,
      requested_at: raw.requested_at,
      lot_size: raw.lot_size === null ? null : Number(raw.lot_size),
      order_unit: raw.order_unit === null ? null : Number(raw.order_unit),
      allow_partial_lot: Boolean(raw.allow_partial_lot),
      is_lot_size_violation: Boolean(raw.is_lot_size_violation),
      site_name: site?.name ?? "(現場不明)",
      product_code: product?.code ?? null,
      product_name: product?.name ?? "(商品不明)",
      product_unit: product?.unit ?? null,
      requester_label: null as string | null,
    } satisfies StockRequestLotSizeStatusRow;
  });

  // 依頼者の表示名は resolve_display_names RPC で解決する。
  // app_users の SELECT policy は自分の行のみのため直接 select しても他人の行は返らず、
  // requested_by が uuid 以外の値だと .in("id", ...) が uuid キャストで失敗する
  // （返却履歴・過入庫一覧と同じ方式に揃える）。
  const requesterIds = [
    ...new Set(
      rows
        .map((r) => r.requested_by)
        .filter((v): v is string => !!v && UUID_RE.test(v)),
    ),
  ];

  if (requesterIds.length > 0) {
    const { data: names, error: namesError } = await supabase.rpc(
      "resolve_display_names",
      { p_user_ids: requesterIds },
    );

    if (namesError) {
      console.error("resolve_display_names:", namesError.message);
    } else {
      const byId = new Map(
        ((names ?? []) as { id: string; display_name: string | null }[]).map(
          (u) => [u.id, u.display_name],
        ),
      );

      for (const row of rows) {
        if (row.requested_by) {
          row.requester_label = byId.get(row.requested_by) ?? null;
        }
      }
    }
  }

  return { rows, error: null };
}
