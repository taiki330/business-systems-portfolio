import { createClient } from "@/lib/supabase/server";
import type {
  MovementAggregateRow,
  MovementFilters,
  MovementOwnership,
  MovementSummaryRow,
} from "@/types/movement-analytics";

/**
 * 資材移動の月別・年別集計（Phase 3-6）。
 *
 * 期間・軸ごとの合計は DB ビュー material_movement_monthly / material_movement_yearly が算出する。
 * 本関数は「どの軸（商品 / 現場 / リース会社）で畳み込むか」と表示ラベルの解決のみを担う。
 *
 * 数量の意味:
 *   shipped_quantity              現場へ出た数量（reason='ship' かつ現場側 in）
 *   returned_quantity             現場からセンターへ返った数量（reason='return_from_site' かつ現場側 out）
 *   borrowed_quantity             リース会社から受け入れた数量（reason='receive'）
 *   returned_to_company_quantity  リース会社へ返却した数量（reason='return_to_company'）
 *
 * コードレビュー指摘（Medium）対応: 期間指定が無い場合に全履歴を無制限に読み込まないよう、
 * from 未指定時は直近24ヶ月（年別集計時は直近5年）をデフォルト範囲とし、
 * 行数にもハードリミットを設ける。
 */

const DEFAULT_MONTH_RANGE_MONTHS = 24;
const DEFAULT_YEAR_RANGE_YEARS = 5;
const MAX_ROWS = 2000;

function defaultFrom(period: MovementFilters["period"]): string {
  const now = new Date();
  if (period === "year") {
    now.setFullYear(now.getFullYear() - DEFAULT_YEAR_RANGE_YEARS);
  } else {
    now.setMonth(now.getMonth() - DEFAULT_MONTH_RANGE_MONTHS);
  }
  return now.toISOString().slice(0, 10);
}

export async function fetchMovementSummary(filters: MovementFilters): Promise<{
  rows: MovementAggregateRow[];
  error: { message: string } | null;
}> {
  const supabase = await createClient();

  const viewName =
    filters.period === "year"
      ? "material_movement_yearly"
      : "material_movement_monthly";

  let query = supabase
    .from(viewName)
    .select(
      "period, ownership, product_id, lease_company_id, site_id," +
        " reason, movement_type, total_quantity, movement_count",
    );

  if (filters.ownership && filters.ownership !== "all") {
    query = query.eq("ownership", filters.ownership);
  }
  query = query.gte("period", filters.from || defaultFrom(filters.period));
  if (filters.to) query = query.lte("period", filters.to);
  query = query.limit(MAX_ROWS);

  const { data, error } = await query;

  if (error) {
    return { rows: [], error: { message: error.message } };
  }

  const summaryRows = (data ?? []) as unknown as MovementSummaryRow[];

  // 軸のキーを決める。リース会社別集計では自社所有行は対象外。
  const keyOf = (row: MovementSummaryRow): string | null => {
    if (filters.axis === "product") return row.product_id;
    if (filters.axis === "site") return row.site_id;
    return row.lease_company_id;
  };

  const aggregates = new Map<string, MovementAggregateRow>();

  for (const row of summaryRows) {
    const key = keyOf(row);
    if (!key) continue;

    const mapKey = `${row.period}__${key}`;
    let entry = aggregates.get(mapKey);
    if (!entry) {
      entry = {
        period: row.period,
        key,
        label: key,
        ownership: (filters.ownership ?? "all") as MovementOwnership | "all",
        shipped_quantity: 0,
        returned_quantity: 0,
        borrowed_quantity: 0,
        returned_to_company_quantity: 0,
      };
      aggregates.set(mapKey, entry);
    }

    const quantity = Number(row.total_quantity);

    // 出庫・返却は必ず「現場側の行」で数える。
    // センター側の行は手動の入出庫登録と区別できないため集計に用いない
    // （自社在庫・リース在庫のどちらも同じ規則で扱う）。
    if (
      row.reason === "ship" &&
      row.site_id !== null &&
      row.movement_type === "in"
    ) {
      entry.shipped_quantity += quantity;
    } else if (
      row.reason === "return_from_site" &&
      row.site_id !== null &&
      row.movement_type === "out"
    ) {
      entry.returned_quantity += quantity;
    } else if (row.reason === "receive" && row.movement_type === "in") {
      entry.borrowed_quantity += quantity;
    } else if (
      row.reason === "return_to_company" &&
      row.movement_type === "out"
    ) {
      entry.returned_to_company_quantity += quantity;
    }
  }

  const rows = [...aggregates.values()];
  await resolveLabels(rows, filters);

  rows.sort((a, b) => {
    if (a.period !== b.period) return b.period.localeCompare(a.period);
    return a.label.localeCompare(b.label, "ja");
  });

  return { rows, error: null };
}

/** 軸に応じて key（uuid）を表示名へ解決する */
async function resolveLabels(
  rows: MovementAggregateRow[],
  filters: MovementFilters,
): Promise<void> {
  if (rows.length === 0) return;

  const supabase = await createClient();
  const ids = [...new Set(rows.map((r) => r.key))];

  const table =
    filters.axis === "product"
      ? "products"
      : filters.axis === "site"
        ? "sites"
        : "lease_companies";

  const { data } = await supabase.from(table).select("id, name").in("id", ids);

  const byId = new Map(
    ((data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
  );

  for (const row of rows) {
    row.label = byId.get(row.key) ?? "(不明)";
  }
}
