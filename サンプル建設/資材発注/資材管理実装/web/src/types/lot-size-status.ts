/**
 * 半端もん（セット数の倍数以外）の確認。
 *
 * 半端もんは「警告・確認対象」であり、出庫依頼の作成・出庫を自動禁止しない
 * （予定数量超過と同方針。docs/site-product-plan.ts 参照）。
 * 判定は DB ビュー stock_request_lot_size_status が行い、本型はその結果を受け取るだけ。
 */

/** stock_request_lot_size_status ビューの1行（依頼ごとの粒度・admin確認用） */
export type StockRequestLotSizeStatusRow = {
  request_id: string;
  site_id: string;
  product_id: string;
  quantity: number;
  status: string;
  requested_by: string | null;
  requested_at: string;
  lot_size: number | null;
  /** 依頼できる最小単位（＝半束。lot_size/2）。lot_size 未設定なら null。D-20260805-09 */
  order_unit: number | null;
  allow_partial_lot: boolean;
  is_lot_size_violation: boolean;
  site_name: string;
  product_code: string | null;
  product_name: string;
  product_unit: string | null;
  requester_label: string | null;
};

export type LotSizeStatusFilters = {
  site_id?: string;
  product_id?: string;
  from?: string;
  to?: string;
  status?: string;
  violation_only?: boolean;
  pending_only?: boolean;
};
