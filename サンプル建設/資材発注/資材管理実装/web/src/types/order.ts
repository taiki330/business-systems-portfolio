import type { StockRequestStatus } from "@/types/stock-request";

/** 資材発注書の自社／リース区分。owned=自社 / leased=リース */
export type OwnershipKind = "owned" | "leased";

export const OWNERSHIP_LABELS: Record<OwnershipKind, string> = {
  owned: "自社",
  leased: "リース",
};

/** オーダー一覧の1行。P1-E Phase E-1/E-2 */
export type OrderListRow = {
  id: string;
  site_id: string;
  site_name: string;
  order_number: string | null;
  requested_by: string | null;
  created_at: string;
  delivery_deadline: string | null;
  yard_loading_date: string | null;
  /** 事務の承認日時。NULL は未承認。承認は記録のみで出庫はブロックしない（D-20260805-04） */
  approved_at: string | null;
  item_count: number;
};

/** オーダー詳細に含まれる明細（stock_requests の1行）。E-REQ-05: 伝票明細との相互追跡用 */
export type OrderItemRow = {
  id: string;
  product_id: string;
  product_code: string | null;
  product_name: string;
  product_unit: string | null;
  /** 1単位あたりの重量(kg)。未登録は null（合計重量に含めない）。D-20260805-01 #5 */
  product_weight_kg: number | null;
  /** 資材種別（product_categories.name）。未分類は null */
  product_category_name: string | null;
  quantity: number;
  original_quantity: number | null;
  status: StockRequestStatus;
  /**
   * 在庫状況からの自動判定（自社在庫に無くリース在庫にある商品のみ leased）。
   * 両方で持っている資材（枠等）は判別できないため owned に寄る。
   */
  ownership_auto: OwnershipKind;
  /** 事務が手で上書きした区分。NULL は自動判定に従う（D-20260805-05） */
  ownership_override: OwnershipKind | null;
  /** 帳票に出す実効値。ownership_override ?? ownership_auto */
  ownership: OwnershipKind;
};

export type OrderDetail = {
  id: string;
  site_id: string;
  site_name: string;
  order_number: string | null;
  requested_by: string | null;
  created_at: string;
  /** 納期（日付＋時刻）。職人がオーダー時に入力。D-20260805-01 #1 */
  delivery_deadline: string | null;
  /** ヤード積込日。現場が注文時に入力し、事務・センターが必要時に訂正。D-20260806-08 */
  yard_loading_date: string | null;
  /** 事務の承認日時。NULL は未承認。承認は記録のみで出庫はブロックしない（D-20260805-04） */
  approved_at: string | null;
  approved_by: string | null;
  /**
   * 依頼登録時点の発注者表示名。NULL は過去分（対象外）で、帳票側が
   * get_order_requester_label() にフォールバックする。D-20260805-10
   */
  requester_label_snapshot: string | null;
  /** 伝票印刷用に発注時点で保存した元請情報。 */
  prime_contractor_name_snapshot: string | null;
  prime_contractor_slip_number_snapshot: string | null;
  slip_site_number_snapshot: number | null;
  items: OrderItemRow[];
};

/**
 * 資材発注書プレビュー用。
 * 運転手・リフトマンは印刷後に手書きするため、入力値は持たず帳票に枠だけ出す
 * （D-20260805-01 #4）。
 */
export type OrderPrintItem = OrderItemRow & {
  isLotSizeViolation: boolean;
  /**
   * 予定数量に対する判定。見込数量は「既出庫＋全未処理オーダー」で算出する。
   * unknown は判定データの取得失敗時で、予定未登録とは区別して帳票に出す。
   */
  planStatus: "over" | "within" | "missing" | "unknown";
  /** 予定数量。未登録・取得失敗時は null */
  plannedQuantity: number | null;
  /** この明細を含む見込数量。取得失敗時は null */
  expectedQuantity: number | null;
  /** 超過数量。超過でない・予定未登録・取得失敗時は null */
  overQuantity: number | null;
  /** 明細の重量小計(kg)。商品重量が未登録なら null */
  lineWeightKg: number | null;
};

export type OrderPrintData = Omit<OrderDetail, "items"> & {
  requesterLabel: string | null;
  items: OrderPrintItem[];
  /** 合計重量(kg)。重量未登録の商品は含めない。D-20260805-01 #5 */
  totalWeightKg: number | null;
  /**
   * 資材種別。オーダーに含まれる商品のカテゴリから自動判別する（D-20260801-10）。
   * 複数の種別が混ざる場合は全て並べる。未分類のみなら空配列。
   */
  materialCategories: string[];
  /** 帳票内で予定数量を超えている明細数 */
  overPlanItemCount: number;
};
