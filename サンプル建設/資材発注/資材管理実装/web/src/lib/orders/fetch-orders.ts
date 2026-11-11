import { createClient } from "@/lib/supabase/server";
import { HISTORY_PAGE_SIZE, getPagination } from "@/lib/pagination";
import type {
  OrderDetail,
  OrderItemRow,
  OrderListRow,
  OrderPrintData,
  OwnershipKind,
} from "@/types/order";

type RawOrderRow = {
  id: string;
  site_id: string;
  order_number: string | null;
  requested_by: string | null;
  created_at: string;
  delivery_deadline: string | null;
  yard_loading_date: string | null;
  approved_at: string | null;
  approved_by: string | null;
  sites: { name: string } | { name: string }[] | null;
  stock_requests: { count: number }[] | null;
  /** 依頼登録時点の現場名。NULL は過去分（対象外）。D-20260805-10 */
  site_name_snapshot?: string | null;
  /** 依頼登録時点の発注者表示名。NULL は過去分（対象外）。D-20260805-10 */
  requester_label_snapshot?: string | null;
  prime_contractor_name_snapshot?: string | null;
  prime_contractor_slip_number_snapshot?: string | null;
  slip_site_number_snapshot?: number | null;
};

function firstOrNull<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * オーダー一覧（新しい順）。admin/center 限定（RLS）。P1-E Phase E-2
 *
 * filters.orderNumber:
 *   紙の資材発注書に印字されたオーダー番号で呼び出すための検索（E-REQ-01 / E-REQ-02）。
 *   事務は紙を見ながら番号を打つため、前方一致ではなく部分一致にする。
 */
export async function fetchOrders(filters?: {
  orderNumber?: string;
  siteId?: string;
  page?: number;
}): Promise<{
  rows: OrderListRow[];
  totalCount: number;
  page: number;
  totalPages: number;
  error: { message: string } | null;
}> {
  const supabase = await createClient();
  const orderNumber = filters?.orderNumber
    ? filters.orderNumber.replace(/[%_\\]/g, (m) => "\\" + m)
    : "";

  let countQuery = supabase.from("orders").select("id", { count: "exact", head: true });
  if (orderNumber) countQuery = countQuery.ilike("order_number", `%${orderNumber}%`);
  if (filters?.siteId) countQuery = countQuery.eq("site_id", filters.siteId);
  const { count, error: countError } = await countQuery;
  if (countError) return { rows: [], totalCount: 0, page: 1, totalPages: 1, error: { message: countError.message } };
  const pagination = getPagination(filters?.page ?? 1, count ?? 0, HISTORY_PAGE_SIZE);

  let query = supabase
    .from("orders")
    .select(
      "id, site_id, order_number, requested_by, created_at," +
        " delivery_deadline, yard_loading_date, approved_at," +
        " site_name_snapshot," +
        " sites(name)," +
        " stock_requests(count)",
    )
    .order("created_at", { ascending: false })
    .range(pagination.from, pagination.to);

  if (orderNumber) {
    // ilike のワイルドカード（% _）とエスケープ文字は、利用者の入力では
    // ただの文字として扱いたいのでエスケープする
    query = query.ilike("order_number", `%${orderNumber}%`);
  }
  if (filters?.siteId) {
    query = query.eq("site_id", filters.siteId);
  }

  const { data, error } = await query;

  if (error) {
    return { rows: [], totalCount: 0, page: pagination.currentPage, totalPages: pagination.totalPages, error: { message: error.message } };
  }

  const rows: OrderListRow[] = ((data ?? []) as unknown as RawOrderRow[]).map(
    (raw) => {
      const site = firstOrNull(raw.sites);
      return {
        id: raw.id,
        site_id: raw.site_id,
        // 詳細・印刷と同じく登録時点の名称を優先する。
        // migration 066より前のオーダーだけ現在の現場マスタへフォールバックする。
        site_name: raw.site_name_snapshot ?? site?.name ?? "(現場不明)",
        order_number: raw.order_number,
        requested_by: raw.requested_by,
        created_at: raw.created_at,
        delivery_deadline: raw.delivery_deadline,
        yard_loading_date: raw.yard_loading_date,
        approved_at: raw.approved_at,
        item_count: raw.stock_requests?.[0]?.count ?? 0,
      };
    },
  );

  return { rows, totalCount: count ?? 0, page: pagination.currentPage, totalPages: pagination.totalPages, error: null };
}

/** オーダー詳細（明細つき）。admin/center 限定（RLS）。P1-E Phase E-2 */
export async function fetchOrderDetail(
  id: string,
): Promise<{ order: OrderDetail | null; error: { message: string } | null }> {
  const supabase = await createClient();

  const { data: orderRowRaw, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, site_id, order_number, requested_by, created_at," +
        " delivery_deadline, yard_loading_date, approved_at, approved_by," +
        " site_name_snapshot, requester_label_snapshot," +
        " prime_contractor_name_snapshot, prime_contractor_slip_number_snapshot, slip_site_number_snapshot," +
        " sites(name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (orderError) {
    return { order: null, error: { message: orderError.message } };
  }
  if (!orderRowRaw) {
    return { order: null, error: null };
  }

  const orderRow = orderRowRaw as unknown as RawOrderRow;

  const { data: itemRows, error: itemError } = await supabase
    .from("stock_requests")
    .select(
      "id, product_id, quantity, original_quantity, status, ownership_override," +
        " product_code_snapshot, product_name_snapshot, product_unit_snapshot," +
        " product_weight_kg_snapshot, product_category_name_snapshot, ownership_auto_snapshot," +
        " products(code, name, unit, weight_kg, product_categories(name))",
    )
    .eq("order_id", id)
    .order("created_at", { ascending: true });

  if (itemError) {
    return { order: null, error: { message: itemError.message } };
  }

  type RawProduct = {
    code: string | null;
    name: string;
    unit: string | null;
    weight_kg: number | null;
    product_categories: { name: string } | { name: string }[] | null;
  };

  type RawItemRow = {
    id: string;
    product_id: string;
    quantity: number;
    original_quantity: number | null;
    status: OrderItemRow["status"];
    ownership_override: OwnershipKind | null;
    /** 依頼登録時点の商品情報。NULL は過去分（対象外）。D-20260805-10 */
    product_code_snapshot: string | null;
    product_name_snapshot: string | null;
    product_unit_snapshot: string | null;
    product_weight_kg_snapshot: number | null;
    product_category_name_snapshot: string | null;
    ownership_auto_snapshot: OwnershipKind | null;
    products:
      | RawProduct
      | RawProduct[]
      | null;
  };

  const rawItems = (itemRows ?? []) as unknown as RawItemRow[];

  // 自社／リースの自動判定。上書き（ownership_override）が無い明細だけが対象。
  const productIds = Array.from(new Set(rawItems.map((r) => r.product_id)));
  const ownershipByProductId = new Map<string, OwnershipKind>();

  if (productIds.length > 0) {
    const { data: ownershipRows, error: ownershipError } = await supabase
      .from("product_ownership_kind")
      .select("product_id, ownership_kind")
      .in("product_id", productIds);

    if (ownershipError) {
      return { order: null, error: { message: ownershipError.message } };
    }

    for (const row of (ownershipRows ?? []) as {
      product_id: string;
      ownership_kind: OwnershipKind;
    }[]) {
      ownershipByProductId.set(row.product_id, row.ownership_kind);
    }
  }

  const items: OrderItemRow[] = rawItems.map((raw) => {
    const product = firstOrNull(raw.products);
    // 依頼登録時点のスナップショットを優先する（D-20260805-10）。
    // 過去分（スナップショット未保存）は従来どおり現在のマスタにフォールバックする。
    // 判定できなかった商品は自社に寄せる（確証なくリース表記にしない）
    const ownershipAuto =
      raw.ownership_auto_snapshot ??
      ownershipByProductId.get(raw.product_id) ??
      "owned";
    return {
      id: raw.id,
      product_id: raw.product_id,
      product_code: raw.product_code_snapshot ?? product?.code ?? null,
      product_name: raw.product_name_snapshot ?? product?.name ?? "(商品不明)",
      product_unit: raw.product_unit_snapshot ?? product?.unit ?? null,
      product_weight_kg:
        raw.product_weight_kg_snapshot ??
        (product?.weight_kg == null ? null : Number(product.weight_kg)),
      product_category_name:
        raw.product_category_name_snapshot ??
        firstOrNull(product?.product_categories ?? null)?.name ??
        null,
      quantity: Number(raw.quantity),
      original_quantity:
        raw.original_quantity === null ? null : Number(raw.original_quantity),
      status: raw.status,
      ownership_auto: ownershipAuto,
      ownership_override: raw.ownership_override,
      ownership: raw.ownership_override ?? ownershipAuto,
    };
  });

  const site = firstOrNull(orderRow.sites);

  return {
    order: {
      id: orderRow.id,
      site_id: orderRow.site_id,
      site_name: orderRow.site_name_snapshot ?? site?.name ?? "(現場不明)",
      order_number: orderRow.order_number,
      requested_by: orderRow.requested_by,
      created_at: orderRow.created_at,
      delivery_deadline: orderRow.delivery_deadline,
      yard_loading_date: orderRow.yard_loading_date,
      approved_at: orderRow.approved_at,
      approved_by: orderRow.approved_by,
      requester_label_snapshot: orderRow.requester_label_snapshot ?? null,
      prime_contractor_name_snapshot: orderRow.prime_contractor_name_snapshot ?? null,
      prime_contractor_slip_number_snapshot: orderRow.prime_contractor_slip_number_snapshot ?? null,
      slip_site_number_snapshot: orderRow.slip_site_number_snapshot ?? null,
      items,
    },
    error: null,
  };
}

/**
 * 資材発注書のプレビュー用データ。
 * 納期・運送情報など未確定の項目はここで補完せず、既存DBにある情報だけを返す。
 */
export async function fetchOrderPrintData(
  id: string,
): Promise<{ data: OrderPrintData | null; error: { message: string } | null }> {
  const { order, error: orderError } = await fetchOrderDetail(id);

  if (orderError) return { data: null, error: orderError };
  if (!order) return { data: null, error: null };

  const supabase = await createClient();
  const requestIds = order.items.map((item) => item.id);

  // 発注者名は依頼登録時点のスナップショットを優先する（D-20260805-10）。
  // 過去分（NULL）のみ、従来どおりライブ解決の RPC を呼ぶ。
  const needsLiveRequesterLabel = order.requester_label_snapshot == null;

  // 自社／リース区分は fetchOrderDetail が解決済み（上書き優先）。ここでは再取得しない。
  const [requesterResult, lotResult, planResult] = await Promise.all([
    needsLiveRequesterLabel
      ? supabase.rpc("get_order_requester_label", { p_order_id: id })
      : Promise.resolve({ data: order.requester_label_snapshot, error: null }),
    requestIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("stock_request_lot_size_status")
          .select("request_id, is_lot_size_violation")
          .in("request_id", requestIds),
    supabase.rpc("get_order_plan_status", { p_order_id: id }),
  ]);

  if (requesterResult.error) {
    return { data: null, error: { message: requesterResult.error.message } };
  }
  // 半端もん判定は帳票の補助情報。取得できなくても発注書自体は印刷できるべきなので、
  // ここでは失敗させず「半端の印なし」として続行する（ログには残す）。
  if (lotResult.error) {
    console.error(
      "fetchOrderPrintData (stock_request_lot_size_status):",
      lotResult.error.message,
    );
  }
  // 予定数量判定は帳票上の重要な注意情報。ただし障害時に「未登録」と誤表示して
  // 発注書そのものを出せなくするのも避けるため、各行を「判定不可」として続行する。
  if (planResult.error) {
    console.error(
      "fetchOrderPrintData (get_order_plan_status):",
      planResult.error.message,
    );
  }

  const lotViolationByRequestId = new Map(
    ((lotResult.data ?? []) as {
      request_id: string;
      is_lot_size_violation: boolean;
    }[]).map((row) => [row.request_id, Boolean(row.is_lot_size_violation)]),
  );

  type RawPlanStatus = {
    request_id: string;
    planned_quantity: number | null;
    expected_quantity: number;
    over_quantity: number | null;
    is_over: boolean;
    plan_missing: boolean;
  };
  const planStatusByRequestId = new Map(
    ((planResult.data ?? []) as RawPlanStatus[]).map((row) => [
      row.request_id,
      {
        plannedQuantity:
          row.planned_quantity == null ? null : Number(row.planned_quantity),
        expectedQuantity: Number(row.expected_quantity),
        overQuantity:
          row.over_quantity == null ? null : Number(row.over_quantity),
        planStatus: row.plan_missing
          ? ("missing" as const)
          : row.is_over
            ? ("over" as const)
            : ("within" as const),
      },
    ]),
  );

  const items: OrderPrintData["items"] = order.items.map((item) => {
    const plan = planStatusByRequestId.get(item.id);
    return {
      ...item,
      isLotSizeViolation: lotViolationByRequestId.get(item.id) ?? false,
      planStatus: plan?.planStatus ?? "unknown",
      plannedQuantity: plan?.plannedQuantity ?? null,
      expectedQuantity: plan?.expectedQuantity ?? null,
      overQuantity: plan?.overQuantity ?? null,
      lineWeightKg:
        item.product_weight_kg == null
          ? null
          : item.product_weight_kg * item.quantity,
    };
  });

  // 資材種別はオーダーの商品カテゴリから判別する（D-20260801-10）。
  // 混在する場合は全て並べる（1つに絞ると誤解を生むため）。
  const materialCategories = Array.from(
    new Set(
      items
        .map((item) => item.product_category_name)
        .filter((name): name is string => !!name),
    ),
  ).sort((a, b) => a.localeCompare(b, "ja"));

  // 重量が登録された商品が1つも無ければ合計は出さない（0kg と紛らわしいため）
  const weighedLines = items.filter((item) => item.lineWeightKg != null);
  const totalWeightKg =
    weighedLines.length === 0
      ? null
      : weighedLines.reduce((sum, item) => sum + (item.lineWeightKg ?? 0), 0);

  return {
    data: {
      ...order,
      requesterLabel: requesterResult.data ?? null,
      items,
      totalWeightKg,
      materialCategories,
      overPlanItemCount: items.filter((item) => item.planStatus === "over").length,
    },
    error: null,
  };
}
