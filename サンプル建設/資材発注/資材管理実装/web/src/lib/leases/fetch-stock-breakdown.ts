import { createClient } from "@/lib/supabase/server";
import type { MaterialStockBreakdownRow } from "@/types/lease";

/**
 * 在庫内訳（自社所有 / リース会社別 / 借用単位別）。
 *
 * 集計元は DB ビュー material_stock_breakdown（security_invoker）。
 * vendor が呼んだ場合は RLS により担当現場の行のみが返り、
 * lease_companies への参照権が無いため lease_company_name は null になる。
 *
 * 商品名・現場名は PostgREST の埋め込みリソース構文（products(...), sites(...)）を使わず、
 * 個別に SELECT して TypeScript 側で突き合わせる。
 * 埋め込み構文は、material_stock_breakdown が stock_items と lease_stock_items を
 * UNION ALL した「テーブルではないビュー」であるため、PostgREST が products/sites への
 * 外部キー関係を安定して解決できない（vendor ロール + site_id 絞り込みの組み合わせで
 * "Could not find a relationship between 'material_stock_breakdown' and 'products' in
 * the schema cache" エラーが発生することを確認済み。admin/center では発生せず、
 * vendor の RLS ポリシー評価と絞り込み条件の組み合わせ次第でクエリプランが変わるためと
 * 推測される）。埋め込みに依存しない実装にすることで、ロール・絞り込み条件によらず
 * 安定して動作するようにする。
 */

export type StockBreakdownDetail = {
  ownership: "owned" | "leased";
  leaseCompanyId: string | null;
  leaseCompanyName: string | null;
  leaseBatchItemId: string | null;
  leaseBatchId: string | null;
  slipNumber: string | null;
  borrowedAt: string | null;
  returnDueDate: string | null;
  returnObligationQuantity: number | null;
  storageKind: "center" | "site";
  siteId: string | null;
  siteName: string | null;
  quantity: number;
};

export type StockBreakdownProduct = {
  productId: string;
  productCode: string | null;
  productName: string;
  productUnit: string | null;
  ownedQuantity: number;
  leasedQuantity: number;
  totalQuantity: number;
  /** リース会社別の合計（会社名 → 数量）。vendor では会社名不明としてまとめられる */
  leasedByCompany: {
    leaseCompanyId: string | null;
    leaseCompanyName: string | null;
    quantity: number;
  }[];
  details: StockBreakdownDetail[];
};

function firstOrNull<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function fetchStockBreakdown(filters?: {
  siteId?: string;
  storageKind?: "center" | "site";
}): Promise<{
  products: StockBreakdownProduct[];
  error: { message: string } | null;
}> {
  const supabase = await createClient();

  let query = supabase
    .from("material_stock_breakdown")
    .select(
      "row_id, ownership, product_id, lease_company_id, lease_company_name," +
        " lease_batch_item_id, slip_number, borrowed_at, return_due_date," +
        " return_obligation_quantity, storage_kind, site_id, location, quantity",
    )
    .gt("quantity", 0);

  if (filters?.siteId) {
    query = query.eq("site_id", filters.siteId);
  }
  if (filters?.storageKind) {
    query = query.eq("storage_kind", filters.storageKind);
  }

  const { data, error } = await query;

  if (error) {
    return { products: [], error: { message: error.message } };
  }

  const rows = (data ?? []) as unknown as MaterialStockBreakdownRow[];

  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const siteIds = [...new Set(rows.map((r) => r.site_id).filter((v): v is string => v !== null))];
  const batchItemIds = [
    ...new Set(
      rows
        .map((r) => r.lease_batch_item_id)
        .filter((v): v is string => v !== null),
    ),
  ];

  const [productResult, siteResult, batchResult] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, code, name, unit").in("id", productIds)
      : Promise.resolve({ data: [] as never[], error: null }),
    siteIds.length > 0
      ? supabase.from("sites").select("id, name").in("id", siteIds)
      : Promise.resolve({ data: [] as never[], error: null }),
    batchItemIds.length > 0
      ? supabase
          .from("lease_batch_items")
          .select("id, lease_batch_id")
          .in("id", batchItemIds)
      : Promise.resolve({ data: [] as never[], error: null }),
  ]);

  const lookupError =
    productResult.error ?? siteResult.error ?? batchResult.error;
  if (lookupError) {
    return { products: [], error: { message: lookupError.message } };
  }

  const productRows = productResult.data;
  const siteRows = siteResult.data;
  const batchRows = batchResult.data;

  const productById = new Map(
    (
      (productRows ?? []) as {
        id: string;
        code: string | null;
        name: string;
        unit: string | null;
      }[]
    ).map((p) => [p.id, p]),
  );
  const siteById = new Map(
    ((siteRows ?? []) as { id: string; name: string }[]).map((s) => [s.id, s]),
  );
  const batchByItemId = new Map(
    (
      (batchRows ?? []) as { id: string; lease_batch_id: string }[]
    ).map((item) => [item.id, item.lease_batch_id]),
  );

  const byProduct = new Map<string, StockBreakdownProduct>();

  for (const raw of rows) {
    const product = firstOrNull(productById.get(raw.product_id) ?? null);
    const site = raw.site_id ? firstOrNull(siteById.get(raw.site_id) ?? null) : null;
    const quantity = Number(raw.quantity);

    let entry = byProduct.get(raw.product_id);
    if (!entry) {
      entry = {
        productId: raw.product_id,
        productCode: product?.code ?? null,
        productName: product?.name ?? "(商品不明)",
        productUnit: product?.unit ?? null,
        ownedQuantity: 0,
        leasedQuantity: 0,
        totalQuantity: 0,
        leasedByCompany: [],
        details: [],
      };
      byProduct.set(raw.product_id, entry);
    }

    if (raw.ownership === "owned") {
      entry.ownedQuantity += quantity;
    } else {
      entry.leasedQuantity += quantity;
      const key = raw.lease_company_id;
      const existing = entry.leasedByCompany.find(
        (c) => c.leaseCompanyId === key,
      );
      if (existing) {
        existing.quantity += quantity;
      } else {
        entry.leasedByCompany.push({
          leaseCompanyId: raw.lease_company_id,
          leaseCompanyName: raw.lease_company_name,
          quantity,
        });
      }
    }

    entry.totalQuantity += quantity;
    entry.details.push({
      ownership: raw.ownership,
      leaseCompanyId: raw.lease_company_id,
      leaseCompanyName: raw.lease_company_name,
      leaseBatchItemId: raw.lease_batch_item_id,
      leaseBatchId: raw.lease_batch_item_id
        ? (batchByItemId.get(raw.lease_batch_item_id) ?? null)
        : null,
      slipNumber: raw.slip_number,
      borrowedAt: raw.borrowed_at,
      returnDueDate: raw.return_due_date,
      returnObligationQuantity:
        raw.return_obligation_quantity === null
          ? null
          : Number(raw.return_obligation_quantity),
      storageKind: raw.storage_kind,
      siteId: raw.site_id,
      siteName: site?.name ?? null,
      quantity,
    });
  }

  const products = [...byProduct.values()].sort((a, b) => {
    const codeA = a.productCode ?? "";
    const codeB = b.productCode ?? "";
    if (codeA !== codeB) return codeA.localeCompare(codeB, "ja");
    return a.productName.localeCompare(b.productName, "ja");
  });

  for (const p of products) {
    p.leasedByCompany.sort((a, b) =>
      (a.leaseCompanyName ?? "").localeCompare(b.leaseCompanyName ?? "", "ja"),
    );
    p.details.sort((a, b) => {
      if (a.ownership !== b.ownership) return a.ownership === "owned" ? -1 : 1;
      const nameA = a.leaseCompanyName ?? "";
      const nameB = b.leaseCompanyName ?? "";
      if (nameA !== nameB) return nameA.localeCompare(nameB, "ja");
      return (a.borrowedAt ?? "").localeCompare(b.borrowedAt ?? "");
    });
  }

  return { products, error: null };
}
