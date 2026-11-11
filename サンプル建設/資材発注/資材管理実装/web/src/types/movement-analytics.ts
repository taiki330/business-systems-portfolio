/**
 * 資材移動の月別・年別集計。Phase 3-6。
 *
 * 集計そのものは DB ビュー（material_movement_monthly / material_movement_yearly）が行う。
 * 本ファイルはその行と、画面で使う軸の定義のみを持つ。
 */

export type MovementPeriodKind = "month" | "year";

export type MovementOwnership = "owned" | "leased";

/** 集計の切り口。要件定義書 §4 の集計項目に対応する。 */
export type MovementAxis = "product" | "site" | "lease_company";

export const MOVEMENT_AXIS_LABELS: Record<MovementAxis, string> = {
  product: "商品別",
  site: "現場別",
  lease_company: "リース会社別",
};

export const MOVEMENT_PERIOD_LABELS: Record<MovementPeriodKind, string> = {
  month: "月別",
  year: "年別",
};

export const MOVEMENT_OWNERSHIP_LABELS: Record<MovementOwnership, string> = {
  owned: "自社所有",
  leased: "リース",
};

/** material_movement_monthly / _yearly ビューの1行 */
export type MovementSummaryRow = {
  period: string;
  ownership: MovementOwnership;
  product_id: string;
  lease_company_id: string | null;
  site_id: string | null;
  reason: string;
  movement_type: "in" | "out";
  total_quantity: number;
  movement_count: number;
};

/** 画面表示用に軸ごとへ畳み込んだ行 */
export type MovementAggregateRow = {
  period: string;
  /** 軸のキー（product_id / site_id / lease_company_id） */
  key: string;
  label: string;
  ownership: MovementOwnership | "all";
  /** 出庫（センター → 現場 / リース会社 → 受入 の反対方向を含まない実出庫） */
  shipped_quantity: number;
  /** 返却（現場 → センター） */
  returned_quantity: number;
  /** リース会社からの借用（受入） */
  borrowed_quantity: number;
  /** リース会社への返却 */
  returned_to_company_quantity: number;
};

export type MovementFilters = {
  period: MovementPeriodKind;
  axis: MovementAxis;
  from?: string;
  to?: string;
  ownership?: MovementOwnership | "all";
};
