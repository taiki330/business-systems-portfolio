import { normalizeProductRef } from "@/lib/stock/normalize-product-ref";
import { createClient } from "@/lib/supabase/server";
import type {
  StockAdjustmentRequestRow,
  StockAdjustmentStatus,
} from "@/types/stock-adjustment";
import type { SiteRef, StockProductRef } from "@/types/stock";

const LIMIT = 200;

type RawRow = {
  id: string;
  storage_kind: "center" | "site";
  location: string;
  counted_quantity: number;
  system_quantity: number;
  delta: number;
  status: StockAdjustmentStatus;
  note: string | null;
  decided_note: string | null;
  requested_at: string;
  decided_at: string | null;
  requested_by: string | null;
  decided_by: string | null;
  products: StockProductRef | StockProductRef[] | null;
  sites: SiteRef | SiteRef[] | null;
};

function normalizeSiteRef(raw: SiteRef | SiteRef[] | null): SiteRef | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

/**
 * 在庫調整申請を新しい順に取得する。
 * 可視範囲は RLS が決める（admin/center は全件、vendor は担当現場のみ）。
 */
export async function fetchAdjustmentRequests(
  status?: StockAdjustmentStatus,
): Promise<{
  rows: StockAdjustmentRequestRow[];
  error: { message: string } | null;
}> {
  const supabase = await createClient();

  let query = supabase
    .from("stock_adjustment_requests")
    .select(
      "id, storage_kind, location, counted_quantity, system_quantity, delta, status, note, decided_note, requested_at, decided_at, requested_by, decided_by, products(code, name, unit), sites(name)",
    )
    .order("requested_at", { ascending: false })
    .limit(LIMIT);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return { rows: [], error: { message: error.message } };

  const raws = (data ?? []) as RawRow[];

  const userIds = Array.from(
    new Set(
      raws
        .flatMap((r) => [r.requested_by, r.decided_by])
        .filter((v): v is string => !!v),
    ),
  );

  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: names, error: nameError } = await supabase.rpc(
      "resolve_display_names",
      { p_user_ids: userIds },
    );
    if (nameError) {
      console.error("resolve_display_names:", nameError.message);
    } else {
      for (const row of (names ?? []) as {
        id: string;
        display_name: string | null;
      }[]) {
        if (row.display_name) nameById.set(row.id, row.display_name);
      }
    }
  }

  const rows: StockAdjustmentRequestRow[] = raws.map((raw) => ({
    id: raw.id,
    storageKind: raw.storage_kind,
    location: raw.location,
    countedQuantity: Number(raw.counted_quantity),
    systemQuantity: Number(raw.system_quantity),
    delta: Number(raw.delta),
    status: raw.status,
    note: raw.note,
    decidedNote: raw.decided_note,
    requestedAt: raw.requested_at,
    decidedAt: raw.decided_at,
    requestedByName: raw.requested_by
      ? (nameById.get(raw.requested_by) ?? null)
      : null,
    decidedByName: raw.decided_by ? (nameById.get(raw.decided_by) ?? null) : null,
    products: normalizeProductRef(raw.products),
    sites: normalizeSiteRef(raw.sites),
  }));

  return { rows, error: null };
}
