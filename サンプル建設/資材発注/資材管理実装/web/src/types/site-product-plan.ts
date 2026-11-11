/**
 * 現場×商品ごとの予定数量と超過判定。Phase 3-7。
 *
 * 超過は「警告・確認対象」であり、出庫を自動禁止しない（確定事項）。
 * 既出庫数量・見込数量・超過数量は DB ビュー側で計算され、本型はその結果を受け取るだけ。
 */

export type SiteProductPlan = {
  id: string;
  site_id: string;
  product_id: string;
  planned_quantity: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type SiteProductPlanFormData = {
  site_id: string;
  product_id: string;
  planned_quantity: number;
  note: string;
};

/**
 * 出庫依頼作成画面に表示する予定数量コンテキスト（Phase 4 要件2）。
 * get_site_product_plan_context RPC の戻り値に対応する。
 *
 * 「今回依頼数量」「依頼後見込数量」は入力中の数量から画面側で計算するため、
 * ここには含めない（サーバー往復なしで即時に警告を出すため）。
 */
export type SiteProductPlanContext = {
  /** 予定数量。現場×商品の予定が未登録なら null */
  plannedQuantity: number | null;
  /** その現場へ入った累計数量（自社所有 + リース） */
  shippedQuantity: number;
  /** 未処理（requested / accepted）の依頼数量合計。shipped/cancelled は含まない */
  pendingQuantity: number;
  /** 予定数量が登録されているか */
  planExists: boolean;
};

/**
 * 予定数量コンテキストの取得結果（Phase 4 要件3）。
 *
 * 「取得できなかった（error）」と「まだ現場・商品を選んでいない（呼び出し側で null）」を
 * 区別するための判別可能ユニオン。error のときもパネルを消さず、
 * 「超過確認はできないが依頼は送信できる」という非ブロッキング表示にするために使う。
 */
export type SiteProductPlanContextResult =
  | { status: "ok"; context: SiteProductPlanContext }
  | { status: "error" };

/** site_product_plan_status ビューの1行（現場×商品の粒度） */
export type SiteProductPlanStatusRow = {
  plan_id: string;
  site_id: string;
  product_id: string;
  planned_quantity: number;
  /** 現場へ入った累計数量（自社所有 + リース） */
  shipped_quantity: number;
  /** 現場の現在在庫（入 - 出） */
  current_site_quantity: number;
  /** 未出庫の依頼数量（requested / accepted） */
  pending_quantity: number;
  /** 既出庫 + 未処理依頼 */
  expected_quantity: number;
  over_quantity: number;
  is_over: boolean;
  note: string | null;
  updated_at: string;
  site_name: string;
  product_code: string | null;
  product_name: string;
  product_unit: string | null;
  /** 1束あたりの数量（products.lot_size）。未設定は null */
  product_lot_size: number | null;
};

/** stock_request_plan_status ビューの1行（依頼ごとの粒度・admin 超過確認用） */
export type StockRequestPlanStatusRow = {
  request_id: string;
  site_id: string;
  product_id: string;
  status: string;
  requested_by: string | null;
  requested_at: string;
  /** 当初依頼数量（vendor が作成した時点） */
  requested_quantity: number;
  /** center 調整後の現在数量 */
  adjusted_quantity: number;
  is_adjusted: boolean;
  planned_quantity: number | null;
  shipped_quantity: number;
  expected_quantity: number;
  over_quantity: number | null;
  is_over: boolean;
  /** 予定数量が未登録の現場×商品 */
  plan_missing: boolean;
  site_name: string;
  product_code: string | null;
  product_name: string;
  product_unit: string | null;
  requester_label: string | null;
};

export type OverPlanFilters = {
  site_id?: string;
  product_id?: string;
  from?: string;
  to?: string;
  status?: string;
  over_only?: boolean;
  pending_only?: boolean;
};
