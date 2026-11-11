import { createClient } from "@/lib/supabase/server";

export type CenterInventorySummary = {
  centerId: string;
  centerCode: string;
  centerName: string;
  ownedAtCenter: number;
  ownedAtSites: number;
  leasedAtCenter: number;
  leasedAtSites: number;
  ownedTotal: number;
  leasedTotal: number;
  total: number;
};

export type InventorySummary = {
  centers: CenterInventorySummary[];
  ownedAtCenter: number;
  ownedAtSites: number;
  leasedAtCenter: number;
  leasedAtSites: number;
  ownedTotal: number;
  leasedTotal: number;
  total: number;
  unassignedTotal: number;
};

type CenterRow = { id: string; code: string; name: string; stock_location: string };
type SiteRow = { id: string; center_id: string | null };
type OwnedRow = {
  quantity: number | string;
  storage_kind: "center" | "site";
  center_id: string | null;
  site_id: string | null;
  location: string;
};
type LeasedRow = {
  product_id: string;
  quantity: number | string;
  storage_kind: "center" | "site";
  site_id: string | null;
  location: string;
};

type OwnedDetailRow = OwnedRow & { product_id: string };

export type InventorySummaryDetail = {
  productId: string;
  productCode: string | null;
  productName: string;
  productUnit: string | null;
  ownedQuantity: number;
  leasedQuantity: number;
  totalQuantity: number;
};

export type InventorySummaryFilters = {
  centerId?: string;
  ownership?: "owned" | "leased" | "all";
  storageKind?: "center" | "site" | "all";
};

function emptyCenter(center: CenterRow): CenterInventorySummary {
  return {
    centerId: center.id,
    centerCode: center.code,
    centerName: center.name,
    ownedAtCenter: 0,
    ownedAtSites: 0,
    leasedAtCenter: 0,
    leasedAtSites: 0,
    ownedTotal: 0,
    leasedTotal: 0,
    total: 0,
  };
}

/**
 * 自社材（stock_items）とリース材（lease_stock_items）を混ぜずに集計し、
 * 最後に「総数」として合算する。現場分は sites.center_id から地域へ振り分ける。
 */
export async function fetchInventorySummary(): Promise<{
  summary: InventorySummary;
  error: { message: string } | null;
}> {
  const supabase = await createClient();
  const [centersResult, sitesResult, ownedResult, leasedResult] = await Promise.all([
    supabase.from("centers").select("id, code, name, stock_location").order("code"),
    supabase.from("sites").select("id, center_id"),
    supabase
      .from("stock_items")
      .select("quantity, storage_kind, center_id, site_id, location")
      .gt("quantity", 0),
    supabase
      .from("lease_stock_items")
      .select("quantity, storage_kind, site_id, location")
      .gt("quantity", 0),
  ]);

  const error = centersResult.error ?? sitesResult.error ?? ownedResult.error ?? leasedResult.error;
  if (error) {
    return {
      summary: {
        centers: [], ownedAtCenter: 0, ownedAtSites: 0, leasedAtCenter: 0, leasedAtSites: 0,
        ownedTotal: 0, leasedTotal: 0, total: 0, unassignedTotal: 0,
      },
      error: { message: error.message },
    };
  }

  const centers = (centersResult.data ?? []) as CenterRow[];
  const byCenterId = new Map(centers.map((center) => [center.id, emptyCenter(center)]));
  const centerIdByLocation = new Map(centers.map((center) => [center.stock_location, center.id]));
  const centerIdBySiteId = new Map(((sitesResult.data ?? []) as SiteRow[]).map((site) => [site.id, site.center_id]));
  let unassignedTotal = 0;

  function add(
    ownership: "owned" | "leased",
    storageKind: "center" | "site",
    quantity: number,
    centerId: string | null | undefined,
  ) {
    const row = centerId ? byCenterId.get(centerId) : undefined;
    if (!row) {
      unassignedTotal += quantity;
      return;
    }
    if (ownership === "owned" && storageKind === "center") row.ownedAtCenter += quantity;
    if (ownership === "owned" && storageKind === "site") row.ownedAtSites += quantity;
    if (ownership === "leased" && storageKind === "center") row.leasedAtCenter += quantity;
    if (ownership === "leased" && storageKind === "site") row.leasedAtSites += quantity;
  }

  for (const raw of (ownedResult.data ?? []) as OwnedRow[]) {
    const quantity = Number(raw.quantity);
    const centerId = raw.storage_kind === "center"
      ? raw.center_id ?? centerIdByLocation.get(raw.location)
      : (raw.site_id ? centerIdBySiteId.get(raw.site_id) : null);
    add("owned", raw.storage_kind, quantity, centerId);
  }
  for (const raw of (leasedResult.data ?? []) as LeasedRow[]) {
    const quantity = Number(raw.quantity);
    const centerId = raw.storage_kind === "center"
      ? centerIdByLocation.get(raw.location)
      : (raw.site_id ? centerIdBySiteId.get(raw.site_id) : null);
    add("leased", raw.storage_kind, quantity, centerId);
  }

  const rows = [...byCenterId.values()].map((row) => ({
    ...row,
    ownedTotal: row.ownedAtCenter + row.ownedAtSites,
    leasedTotal: row.leasedAtCenter + row.leasedAtSites,
    total: row.ownedAtCenter + row.ownedAtSites + row.leasedAtCenter + row.leasedAtSites,
  }));
  const sum = (key: keyof CenterInventorySummary) => rows.reduce((total, row) => total + Number(row[key]), 0);
  const ownedAtCenter = sum("ownedAtCenter");
  const ownedAtSites = sum("ownedAtSites");
  const leasedAtCenter = sum("leasedAtCenter");
  const leasedAtSites = sum("leasedAtSites");

  return {
    summary: {
      centers: rows,
      ownedAtCenter,
      ownedAtSites,
      leasedAtCenter,
      leasedAtSites,
      ownedTotal: ownedAtCenter + ownedAtSites,
      leasedTotal: leasedAtCenter + leasedAtSites,
      total: ownedAtCenter + ownedAtSites + leasedAtCenter + leasedAtSites,
      unassignedTotal,
    },
    error: null,
  };
}

/** 総在庫サマリーの数字を押したときに表示する、商品別の明細。 */
export async function fetchInventorySummaryDetails(filters: InventorySummaryFilters): Promise<{
  rows: InventorySummaryDetail[];
  centerName: string | null;
  error: { message: string } | null;
}> {
  const supabase = await createClient();
  const [centersResult, sitesResult, ownedResult, leasedResult] = await Promise.all([
    supabase.from("centers").select("id, name, stock_location").order("code"),
    supabase.from("sites").select("id, center_id"),
    supabase
      .from("stock_items")
      .select("product_id, quantity, storage_kind, center_id, site_id, location")
      .gt("quantity", 0),
    supabase
      .from("lease_stock_items")
      .select("product_id, quantity, storage_kind, site_id, location")
      .gt("quantity", 0),
  ]);
  const error = centersResult.error ?? sitesResult.error ?? ownedResult.error ?? leasedResult.error;
  if (error) return { rows: [], centerName: null, error: { message: error.message } };

  const centers = (centersResult.data ?? []) as Pick<CenterRow, "id" | "name" | "stock_location">[];
  const requestedCenter = filters.centerId ? centers.find((center) => center.id === filters.centerId) : undefined;
  if (filters.centerId && !requestedCenter) {
    return { rows: [], centerName: null, error: { message: "指定されたセンターが見つかりません。" } };
  }

  const centerIdByLocation = new Map(centers.map((center) => [center.stock_location, center.id]));
  const centerIdBySiteId = new Map(((sitesResult.data ?? []) as SiteRow[]).map((site) => [site.id, site.center_id]));
  const storageKind = filters.storageKind ?? "all";
  const ownership = filters.ownership ?? "all";
  const byProduct = new Map<string, { ownedQuantity: number; leasedQuantity: number }>();

  function include(storage: "center" | "site", centerId: string | null | undefined) {
    return (storageKind === "all" || storageKind === storage) && (!filters.centerId || centerId === filters.centerId);
  }
  function add(productId: string, kind: "owned" | "leased", quantity: number) {
    const row = byProduct.get(productId) ?? { ownedQuantity: 0, leasedQuantity: 0 };
    if (kind === "owned") row.ownedQuantity += quantity;
    else row.leasedQuantity += quantity;
    byProduct.set(productId, row);
  }

  if (ownership === "all" || ownership === "owned") {
    for (const raw of (ownedResult.data ?? []) as OwnedDetailRow[]) {
      const centerId = raw.storage_kind === "center"
        ? raw.center_id ?? centerIdByLocation.get(raw.location)
        : (raw.site_id ? centerIdBySiteId.get(raw.site_id) : null);
      if (include(raw.storage_kind, centerId)) add(raw.product_id, "owned", Number(raw.quantity));
    }
  }
  if (ownership === "all" || ownership === "leased") {
    for (const raw of (leasedResult.data ?? []) as LeasedRow[]) {
      const centerId = raw.storage_kind === "center"
        ? centerIdByLocation.get(raw.location)
        : (raw.site_id ? centerIdBySiteId.get(raw.site_id) : null);
      if (include(raw.storage_kind, centerId)) add(raw.product_id, "leased", Number(raw.quantity));
    }
  }

  const productIds = [...byProduct.keys()];
  const { data: productData, error: productError } = productIds.length
    ? await supabase.from("products").select("id, code, name, unit").in("id", productIds)
    : { data: [], error: null };
  if (productError) return { rows: [], centerName: requestedCenter?.name ?? null, error: { message: productError.message } };
  const productById = new Map(((productData ?? []) as { id: string; code: string | null; name: string; unit: string | null }[]).map((product) => [product.id, product]));

  const rows = productIds.map((productId) => {
    const quantities = byProduct.get(productId)!;
    const product = productById.get(productId);
    return {
      productId,
      productCode: product?.code ?? null,
      productName: product?.name ?? "（商品不明）",
      productUnit: product?.unit ?? null,
      ownedQuantity: quantities.ownedQuantity,
      leasedQuantity: quantities.leasedQuantity,
      totalQuantity: quantities.ownedQuantity + quantities.leasedQuantity,
    };
  }).sort((a, b) => (a.productCode ?? a.productName).localeCompare(b.productCode ?? b.productName, "ja"));

  return { rows, centerName: requestedCenter?.name ?? null, error: null };
}
