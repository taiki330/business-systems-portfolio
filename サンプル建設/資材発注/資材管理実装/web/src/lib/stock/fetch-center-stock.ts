import { createClient } from "@/lib/supabase/server";
import { CENTER_LOCATION } from "@/lib/stock/constants";
import { normalizeProductRef } from "@/lib/stock/normalize-product-ref";
import type { CenterStockRow, StockProductRef } from "@/types/stock";

export type CenterStockSort = "product_code" | "quantity_desc";

export type CenterStockListRow = CenterStockRow & {
  product_id: string;
};

type RawStockRow = {
  id: string;
  product_id: string;
  location: string;
  quantity: number;
  products: StockProductRef | StockProductRef[] | null;
};

function sortRows(
  rows: CenterStockListRow[],
  sort: CenterStockSort,
): CenterStockListRow[] {
  const copy = [...rows];
  if (sort === "quantity_desc") {
    copy.sort((a, b) => b.quantity - a.quantity);
    return copy;
  }
  copy.sort((a, b) => {
    const codeA = a.products?.code ?? "";
    const codeB = b.products?.code ?? "";
    if (codeA !== codeB) return codeA.localeCompare(codeB, "ja");
    return (a.products?.name ?? "").localeCompare(b.products?.name ?? "", "ja");
  });
  return copy;
}

function filterByQuery(rows: CenterStockListRow[], q: string): CenterStockListRow[] {
  const qLower = q.trim().toLowerCase();
  if (!qLower) return rows;
  return rows.filter((row) => {
    const p = row.products;
    if (!p) return false;
    const code = (p.code ?? "").toLowerCase();
    const name = p.name.toLowerCase();
    return code.includes(qLower) || name.includes(qLower);
  });
}

/**
 * センター倉庫（location=center）の在庫一覧を取得する。
 * - /vendor/stock: sort=product_code
 * - /stock リファクタ時: sort=quantity_desc も可
 */
export async function fetchCenterStock(options?: {
  query?: string;
  sort?: CenterStockSort;
}): Promise<{ rows: CenterStockListRow[]; error: { message: string } | null }> {
  const sort = options?.sort ?? "product_code";
  const q = (options?.query ?? "").trim();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_items")
    .select("id, product_id, location, quantity, products(code, name, unit)")
    .eq("location", CENTER_LOCATION);

  if (error) {
    return { rows: [], error: { message: error.message } };
  }

  const rows: CenterStockListRow[] = (data ?? []).map((row) => {
    const raw = row as RawStockRow;
    return {
      id: raw.id,
      product_id: raw.product_id,
      location: raw.location,
      quantity: Number(raw.quantity),
      products: normalizeProductRef(raw.products),
    };
  });

  return {
    rows: sortRows(filterByQuery(rows, q), sort),
    error: null,
  };
}
