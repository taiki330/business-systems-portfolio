import { createClient } from "@/lib/supabase/server";
import type {
  LeaseBatch,
  LeaseBatchItemRow,
  LeaseBatchRow,
  LeaseBatchStatus,
} from "@/types/lease";

type RawBatch = {
  id: string;
  lease_company_id: string;
  slip_number: string | null;
  borrowed_at: string;
  delivery_kind: "center" | "site";
  delivery_site_id: string | null;
  note: string | null;
  status: LeaseBatchStatus;
  registered_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  lease_companies: { name: string } | { name: string }[] | null;
  sites: { name: string } | { name: string }[] | null;
  lease_batch_items:
    | {
        product_id: string;
        quantity: number;
        received_quantity: number;
        returned_quantity: number;
        products:
          | { code: string | null; name: string; unit: string | null }
          | { code: string | null; name: string; unit: string | null }[]
          | null;
      }[]
    | null;
};

function firstOrNull<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

const BATCH_SELECT =
  "id, lease_company_id, slip_number, borrowed_at, delivery_kind, delivery_site_id," +
  " note, status, registered_by, approved_by, approved_at, cancelled_at," +
  " created_at, updated_at," +
  " lease_companies(name), sites(name)," +
  " lease_batch_items(product_id, quantity, received_quantity, returned_quantity," +
  " products(code, name, unit))";

function toBatchRow(raw: RawBatch): LeaseBatchRow {
  const items = raw.lease_batch_items ?? [];
  return {
    id: raw.id,
    lease_company_id: raw.lease_company_id,
    slip_number: raw.slip_number,
    borrowed_at: raw.borrowed_at,
    delivery_kind: raw.delivery_kind,
    delivery_site_id: raw.delivery_site_id,
    note: raw.note,
    status: raw.status,
    registered_by: raw.registered_by,
    approved_by: raw.approved_by,
    approved_at: raw.approved_at,
    cancelled_at: raw.cancelled_at,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    lease_company_name: firstOrNull(raw.lease_companies)?.name ?? null,
    delivery_site_name: firstOrNull(raw.sites)?.name ?? null,
    item_summaries: items.map((item) => {
      const product = firstOrNull(item.products);
      return {
        product_id: item.product_id,
        product_code: product?.code ?? null,
        product_name: product?.name ?? "(商品不明)",
        product_unit: product?.unit ?? null,
        quantity: Number(item.quantity),
      };
    }),
    item_count: items.length,
    total_quantity: items.reduce((sum, i) => sum + Number(i.quantity), 0),
    total_received: items.reduce(
      (sum, i) => sum + Number(i.received_quantity),
      0,
    ),
    total_returned: items.reduce(
      (sum, i) => sum + Number(i.returned_quantity),
      0,
    ),
  };
}

/** 借用一覧（新しい借用日順）。RLS により admin / center のみ取得できる。 */
export async function fetchLeaseBatches(filters?: {
  status?: string;
  leaseCompanyId?: string;
}): Promise<{ rows: LeaseBatchRow[]; error: { message: string } | null }> {
  const supabase = await createClient();

  let query = supabase.from("lease_batches").select(BATCH_SELECT);

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.leaseCompanyId) {
    query = query.eq("lease_company_id", filters.leaseCompanyId);
  }

  const { data, error } = await query
    .order("borrowed_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return { rows: [], error: { message: error.message } };
  }

  return {
    rows: (data ?? []).map((row) => toBatchRow(row as unknown as RawBatch)),
    error: null,
  };
}

/** 借用1件（ヘッダー） */
export async function fetchLeaseBatch(
  id: string,
): Promise<{ batch: LeaseBatchRow | null; error: { message: string } | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lease_batches")
    .select(BATCH_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { batch: null, error: { message: error.message } };
  }
  if (!data) {
    return { batch: null, error: null };
  }

  return { batch: toBatchRow(data as unknown as RawBatch), error: null };
}

type RawItem = {
  id: string;
  lease_batch_id: string;
  product_id: string;
  quantity: number;
  return_due_date: string | null;
  received_quantity: number;
  returned_quantity: number;
  receiving_closed: boolean;
  receiving_closed_at: string | null;
  receiving_closed_by: string | null;
  receiving_closed_reason: string | null;
  unreturned_quantity: number;
  return_obligation_quantity: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  products:
    | { code: string | null; name: string; unit: string | null }
    | { code: string | null; name: string; unit: string | null }[]
    | null;
};

type RawLeaseStock = {
  lease_batch_item_id: string;
  storage_kind: "center" | "site";
  site_id: string | null;
  quantity: number;
  sites: { name: string } | { name: string }[] | null;
};

/**
 * 借用明細と、その借用単位ごとの現在地内訳（センター / 各現場）を取得する。
 * 現在地は lease_stock_items（借用単位 × 現在地）から組み立てる。
 */
export async function fetchLeaseBatchItems(
  batchId: string,
): Promise<{ rows: LeaseBatchItemRow[]; error: { message: string } | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("lease_batch_items")
    .select(
      "id, lease_batch_id, product_id, quantity, return_due_date," +
        " received_quantity, returned_quantity," +
        " receiving_closed, receiving_closed_at, receiving_closed_by, receiving_closed_reason," +
        " unreturned_quantity, return_obligation_quantity, note," +
        " created_at, updated_at, products(code, name, unit)",
    )
    .eq("lease_batch_id", batchId)
    .order("created_at", { ascending: true });

  if (error) {
    return { rows: [], error: { message: error.message } };
  }

  const items = (data ?? []) as unknown as RawItem[];
  const itemIds = items.map((i) => i.id);

  let stockByItem = new Map<string, RawLeaseStock[]>();
  if (itemIds.length > 0) {
    const { data: stockData, error: stockError } = await supabase
      .from("lease_stock_items")
      .select("lease_batch_item_id, storage_kind, site_id, quantity, sites(name)")
      .in("lease_batch_item_id", itemIds);

    if (stockError) {
      return { rows: [], error: { message: stockError.message } };
    }

    stockByItem = (stockData ?? []).reduce((map, raw) => {
      const row = raw as unknown as RawLeaseStock;
      const list = map.get(row.lease_batch_item_id) ?? [];
      list.push(row);
      map.set(row.lease_batch_item_id, list);
      return map;
    }, new Map<string, RawLeaseStock[]>());
  }

  const rows: LeaseBatchItemRow[] = items.map((raw) => {
    const product = firstOrNull(raw.products);
    const stocks = stockByItem.get(raw.id) ?? [];

    const centerQuantity = stocks
      .filter((s) => s.storage_kind === "center")
      .reduce((sum, s) => sum + Number(s.quantity), 0);

    const siteQuantities = stocks
      .filter((s) => s.storage_kind === "site" && s.site_id !== null)
      .map((s) => ({
        site_id: s.site_id as string,
        site_name: firstOrNull(s.sites)?.name ?? "(現場不明)",
        quantity: Number(s.quantity),
      }))
      .filter((s) => s.quantity > 0)
      .sort((a, b) => a.site_name.localeCompare(b.site_name, "ja"));

    return {
      id: raw.id,
      lease_batch_id: raw.lease_batch_id,
      product_id: raw.product_id,
      quantity: Number(raw.quantity),
      return_due_date: raw.return_due_date,
      received_quantity: Number(raw.received_quantity),
      returned_quantity: Number(raw.returned_quantity),
      receiving_closed: raw.receiving_closed,
      receiving_closed_at: raw.receiving_closed_at,
      receiving_closed_by: raw.receiving_closed_by,
      receiving_closed_reason: raw.receiving_closed_reason,
      unreturned_quantity: Number(raw.unreturned_quantity),
      return_obligation_quantity: Number(raw.return_obligation_quantity),
      note: raw.note,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
      product_code: product?.code ?? null,
      product_name: product?.name ?? "(商品不明)",
      product_unit: product?.unit ?? null,
      remaining_to_receive:
        Number(raw.quantity) - Number(raw.received_quantity),
      center_quantity: centerQuantity,
      site_quantities: siteQuantities,
    };
  });

  return { rows, error: null };
}

/** 明細1件の所属借用を取得する（Server Action の遷移先解決用） */
export async function fetchBatchIdOfItem(
  itemId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lease_batch_items")
    .select("lease_batch_id")
    .eq("id", itemId)
    .maybeSingle();

  if (error || !data) return null;
  return (data as Pick<LeaseBatch, "id"> & { lease_batch_id: string })
    .lease_batch_id;
}
