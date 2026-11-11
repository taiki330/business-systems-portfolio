import { createClient } from "@/lib/supabase/server";
import {
  emptyTotals,
  type MaterialOwnership,
  type SiteProgressDetail,
  type SiteProgressEventRow,
  type SiteProgressKind,
  type SiteProgressSnapshotItem,
  type SiteProgressTotals,
} from "@/types/site-progress";

const LIMIT = 200;

type RawItem = {
  product_id: string;
  ownership: MaterialOwnership;
  shipped_quantity: number;
  returned_quantity: number;
  outstanding_quantity: number;
  over_return_quantity: number;
  site_quantity: number;
};

type RawEvent = {
  id: string;
  site_id: string;
  kind: SiteProgressKind;
  occurred_on: string;
  recorded_at: string;
  recorded_by: string | null;
  note: string | null;
  sites: { name: string } | { name: string }[] | null;
  site_progress_snapshot_items: RawItem[] | null;
};

function siteName(raw: RawEvent["sites"]): string {
  if (raw == null) return "(現場不明)";
  return Array.isArray(raw) ? (raw[0]?.name ?? "(現場不明)") : raw.name;
}

function sumTotals(items: RawItem[] | null): SiteProgressTotals {
  const t = emptyTotals();
  for (const i of items ?? []) {
    t.shipped += Number(i.shipped_quantity);
    t.returned += Number(i.returned_quantity);
    t.outstanding += Number(i.outstanding_quantity);
    t.overReturn += Number(i.over_return_quantity);
    t.siteQuantity += Number(i.site_quantity);
  }
  return t;
}

async function resolveNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase.rpc("resolve_display_names", {
    p_user_ids: ids,
  });
  if (error) {
    console.error("resolve_display_names:", error.message);
    return map;
  }
  for (const row of (data ?? []) as { id: string; display_name: string | null }[]) {
    if (row.display_name) map.set(row.id, row.display_name);
  }
  return map;
}

/** 進捗記録の一覧（新しい順）。 */
export async function fetchSiteProgressEvents(
  siteId?: string,
  limit = LIMIT,
): Promise<{ rows: SiteProgressEventRow[]; error: { message: string } | null }> {
  const supabase = await createClient();

  let query = supabase
    .from("site_progress_events")
    .select(
      "id, site_id, kind, occurred_on, recorded_at, recorded_by, note, sites(name), site_progress_snapshot_items(product_id, ownership, shipped_quantity, returned_quantity, outstanding_quantity, over_return_quantity, site_quantity)",
    )
    .order("recorded_at", { ascending: false })
    .limit(limit);

  if (siteId) query = query.eq("site_id", siteId);

  const { data, error } = await query;
  if (error) return { rows: [], error: { message: error.message } };

  const raws = (data ?? []) as RawEvent[];
  const names = await resolveNames(
    supabase,
    Array.from(
      new Set(raws.map((r) => r.recorded_by).filter((v): v is string => !!v)),
    ),
  );

  const rows = raws.map((raw) => ({
    id: raw.id,
    siteId: raw.site_id,
    siteName: siteName(raw.sites),
    kind: raw.kind,
    occurredOn: raw.occurred_on,
    recordedAt: raw.recorded_at,
    recordedByName: raw.recorded_by ? (names.get(raw.recorded_by) ?? null) : null,
    note: raw.note,
    totals: sumTotals(raw.site_progress_snapshot_items),
  }));

  return { rows, error: null };
}

type RawDetailItem = RawItem & {
  products:
    | {
        code: string | null;
        name: string;
        unit: string | null;
        product_categories: { name: string } | { name: string }[] | null;
      }
    | {
        code: string | null;
        name: string;
        unit: string | null;
        product_categories: { name: string } | { name: string }[] | null;
      }[]
    | null;
};

function firstOf<T>(raw: T | T[] | null): T | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

/**
 * 進捗記録の詳細（＝その時点の確定レポート）。
 * 解体開始・解体完了のときは、比較用に直前の組立完了時の記録も返す
 * （「組立完了時から出庫総数が変わっていないか」を見たいという要望に対応）。
 */
export async function fetchSiteProgressDetail(
  eventId: string,
): Promise<{ detail: SiteProgressDetail | null; error: { message: string } | null }> {
  const supabase = await createClient();

  const { data: eventData, error: eventError } = await supabase
    .from("site_progress_events")
    .select(
      "id, site_id, kind, occurred_on, recorded_at, recorded_by, note, sites(name)",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) return { detail: null, error: { message: eventError.message } };
  if (!eventData) return { detail: null, error: null };

  const raw = eventData as Omit<RawEvent, "site_progress_snapshot_items">;

  const { data: itemData, error: itemError } = await supabase
    .from("site_progress_snapshot_items")
    .select(
      "product_id, ownership, shipped_quantity, returned_quantity, outstanding_quantity, over_return_quantity, site_quantity, products(code, name, unit, product_categories(name))",
    )
    .eq("event_id", eventId);

  if (itemError) return { detail: null, error: { message: itemError.message } };

  const rawItems = (itemData ?? []) as RawDetailItem[];
  const items: SiteProgressSnapshotItem[] = rawItems.map((i) => {
    const product = firstOf(i.products);
    const category = firstOf(product?.product_categories ?? null);
    return {
      productId: i.product_id,
      productName: product?.name ?? "(商品不明)",
      productCode: product?.code ?? null,
      productUnit: product?.unit ?? null,
      categoryName: category?.name ?? null,
      ownership: i.ownership,
      shippedQuantity: Number(i.shipped_quantity),
      returnedQuantity: Number(i.returned_quantity),
      outstandingQuantity: Number(i.outstanding_quantity),
      overReturnQuantity: Number(i.over_return_quantity),
      siteQuantity: Number(i.site_quantity),
    };
  });

  const names = await resolveNames(
    supabase,
    raw.recorded_by ? [raw.recorded_by] : [],
  );

  const event: SiteProgressEventRow = {
    id: raw.id,
    siteId: raw.site_id,
    siteName: siteName(raw.sites),
    kind: raw.kind,
    occurredOn: raw.occurred_on,
    recordedAt: raw.recorded_at,
    recordedByName: raw.recorded_by ? (names.get(raw.recorded_by) ?? null) : null,
    note: raw.note,
    totals: sumTotals(rawItems),
  };

  // 比較対象: 同じ現場の、この記録より前の「組立完了」で最も新しいもの
  let baseline: SiteProgressDetail["baseline"] = null;
  if (raw.kind !== "assembly_completed") {
    const { data: baseData } = await supabase
      .from("site_progress_events")
      .select(
        "kind, occurred_on, site_progress_snapshot_items(product_id, ownership, shipped_quantity, returned_quantity, outstanding_quantity, over_return_quantity, site_quantity)",
      )
      .eq("site_id", raw.site_id)
      .eq("kind", "assembly_completed")
      .lt("recorded_at", raw.recorded_at)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (baseData) {
      const b = baseData as {
        kind: SiteProgressKind;
        occurred_on: string;
        site_progress_snapshot_items: RawItem[] | null;
      };
      baseline = {
        kind: b.kind,
        occurredOn: b.occurred_on,
        totals: sumTotals(b.site_progress_snapshot_items),
      };
    }
  }

  return { detail: { event, items, baseline }, error: null };
}
