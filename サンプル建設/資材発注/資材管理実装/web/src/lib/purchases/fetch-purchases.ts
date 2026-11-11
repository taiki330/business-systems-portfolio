import { createClient } from "@/lib/supabase/server";
import type { StockPurchaseRow } from "@/types/purchase";

const LIMIT = 200;

type RawPurchase = {
  id: string;
  quantity: number;
  purchase_date: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
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
  suppliers: { name: string } | { name: string }[] | null;
};

function firstOf<T>(raw: T | T[] | null): T | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

/**
 * 仕入れ（購入）履歴を新しい順に取得する。
 * 操作者名は fetchReturnHistory と同じく resolve_display_names RPC で解決する。
 */
export async function fetchPurchases(options?: {
  productId?: string;
  supplierId?: string;
}): Promise<{ rows: StockPurchaseRow[]; error: { message: string } | null }> {
  const supabase = await createClient();

  let query = supabase
    .from("stock_purchases")
    .select(
      "id, quantity, purchase_date, note, created_at, created_by, products(code, name, unit, product_categories(name)), suppliers(name)",
    )
    .order("purchase_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (options?.productId) query = query.eq("product_id", options.productId);
  if (options?.supplierId) query = query.eq("supplier_id", options.supplierId);

  const { data, error } = await query;
  if (error) return { rows: [], error: { message: error.message } };

  const raws = (data ?? []) as RawPurchase[];

  const userIds = Array.from(
    new Set(raws.map((r) => r.created_by).filter((v): v is string => !!v)),
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

  const rows: StockPurchaseRow[] = raws.map((raw) => {
    const product = firstOf(raw.products);
    const category = firstOf(product?.product_categories ?? null);
    const supplier = firstOf(raw.suppliers);
    return {
      id: raw.id,
      quantity: Number(raw.quantity),
      purchaseDate: raw.purchase_date,
      note: raw.note,
      createdAt: raw.created_at,
      createdByName: raw.created_by
        ? (nameById.get(raw.created_by) ?? null)
        : null,
      productName: product?.name ?? "(商品不明)",
      productCode: product?.code ?? null,
      productUnit: product?.unit ?? null,
      categoryName: category?.name ?? null,
      supplierName: supplier?.name ?? "(仕入先不明)",
    };
  });

  return { rows, error: null };
}
