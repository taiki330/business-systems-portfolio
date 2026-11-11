import { createClient } from "@/lib/supabase/server";
import type { OperationLogRow } from "@/types/operation-log";

const LIMIT = 200;

type RawLog = {
  id: string;
  operation: string;
  entity_type: string;
  entity_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  site_id: string | null;
  product_id: string | null;
  quantity: number | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

/**
 * 操作履歴を新しい順に取得する（admin のみ。RLS で保証）。
 *
 * operation_logs は監査証跡のため他テーブルへの FK を持たない（043）。
 * PostgREST の埋め込みは FK を前提とするため、商品名・現場名は別途取得して結合する。
 */
export async function fetchOperationLogs(
  entityType?: string,
): Promise<{ rows: OperationLogRow[]; error: { message: string } | null }> {
  const supabase = await createClient();

  let query = supabase
    .from("operation_logs")
    .select(
      "id, operation, entity_type, entity_id, actor_name, actor_role, site_id, product_id, quantity, detail, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (entityType) query = query.eq("entity_type", entityType);

  const { data, error } = await query;
  if (error) return { rows: [], error: { message: error.message } };

  const raws = (data ?? []) as RawLog[];

  const productIds = Array.from(
    new Set(raws.map((r) => r.product_id).filter((v): v is string => !!v)),
  );
  const siteIds = Array.from(
    new Set(raws.map((r) => r.site_id).filter((v): v is string => !!v)),
  );

  const productNames = new Map<string, string>();
  const siteNames = new Map<string, string>();

  const [productsResult, sitesResult] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, code, name").in("id", productIds)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length > 0
      ? supabase.from("sites").select("id, name").in("id", siteIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const p of (productsResult.data ?? []) as {
    id: string;
    code: string | null;
    name: string;
  }[]) {
    productNames.set(p.id, p.code ? `${p.code} — ${p.name}` : p.name);
  }
  for (const s of (sitesResult.data ?? []) as { id: string; name: string }[]) {
    siteNames.set(s.id, s.name);
  }

  const rows: OperationLogRow[] = raws.map((raw) => ({
    id: raw.id,
    operation: raw.operation,
    entityType: raw.entity_type,
    entityId: raw.entity_id,
    actorName: raw.actor_name,
    actorRole: raw.actor_role,
    quantity: raw.quantity === null ? null : Number(raw.quantity),
    detail: raw.detail,
    createdAt: raw.created_at,
    productName: raw.product_id
      ? (productNames.get(raw.product_id) ?? null)
      : null,
    siteName: raw.site_id ? (siteNames.get(raw.site_id) ?? null) : null,
  }));

  return { rows, error: null };
}
