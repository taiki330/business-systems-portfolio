/**
 * リース借用・リース在庫の型。Phase 3-2〜3-5。
 *
 * 単位は「ヘッダー（lease_batches）＋明細（lease_batch_items）」の2階層。
 * 明細1行 = 借用単位であり、同一リース会社・同一商品でも借用日／返却期限が異なれば別行になる。
 */

/** 納品先種別。現場直送でも admin の登録・承認が必須（確定事項）。 */
export type LeaseDeliveryKind = "center" | "site";

/**
 * 借用ヘッダーの状態。
 * - draft:     登録済み（未承認）。この状態では受入できない
 * - approved:  承認済み（受入待ち）
 * - receiving: 一部受入
 * - received:  受入済み
 * - closed:    全量返却済み
 * - cancelled: キャンセル
 * 期限超過は保存せず、返却期限と未返却数量から都度判定する。
 */
export type LeaseBatchStatus =
  | "draft"
  | "approved"
  | "receiving"
  | "received"
  | "closed"
  | "cancelled";

export const LEASE_BATCH_STATUS_LABELS: Record<LeaseBatchStatus, string> = {
  draft: "登録済み（未承認）",
  approved: "承認済み（受入待ち）",
  receiving: "一部受入",
  received: "受入済み",
  closed: "全量返却済み",
  cancelled: "キャンセル",
};

export const LEASE_DELIVERY_KIND_LABELS: Record<LeaseDeliveryKind, string> = {
  center: "センター納品",
  site: "現場直送",
};

export type LeaseBatch = {
  id: string;
  lease_company_id: string;
  slip_number: string | null;
  borrowed_at: string;
  delivery_kind: LeaseDeliveryKind;
  delivery_site_id: string | null;
  note: string | null;
  status: LeaseBatchStatus;
  registered_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

/** 一覧表示用（リース会社名・納品先現場名を解決済み） */
export type LeaseBatchRow = LeaseBatch & {
  lease_company_name: string | null;
  delivery_site_name: string | null;
  item_summaries: {
    product_id: string;
    product_code: string | null;
    product_name: string;
    product_unit: string | null;
    quantity: number;
  }[];
  item_count: number;
  total_quantity: number;
  total_received: number;
  total_returned: number;
};

export type LeaseBatchItem = {
  id: string;
  lease_batch_id: string;
  product_id: string;
  quantity: number;
  return_due_date: string | null;
  received_quantity: number;
  returned_quantity: number;
  /** 未受入のまま受入を終了したか（欠品等）。理由・操作者・日時とセット */
  receiving_closed: boolean;
  receiving_closed_at: string | null;
  receiving_closed_by: string | null;
  receiving_closed_reason: string | null;
  /** 生成列: quantity - returned_quantity（借用総数基準・参考値） */
  unreturned_quantity: number;
  /** 生成列: received_quantity - returned_quantity（返却義務残。未受入分は含まない） */
  return_obligation_quantity: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/** 明細の表示用（商品名・現在地内訳つき） */
export type LeaseBatchItemRow = LeaseBatchItem & {
  product_code: string | null;
  product_name: string;
  product_unit: string | null;
  /** 受入済みのうち、まだ受け入れていない残数 */
  remaining_to_receive: number;
  /** センター保管中の数量 */
  center_quantity: number;
  /** 現場ごとの保管数量 */
  site_quantities: { site_id: string; site_name: string; quantity: number }[];
};

/** 借用登録フォーム（ヘッダー1件 + 明細1件以上） */
export type LeaseBatchFormData = {
  lease_company_id: string;
  slip_number: string;
  borrowed_at: string;
  delivery_kind: LeaseDeliveryKind;
  delivery_site_id: string;
  note: string;
  items: LeaseBatchItemFormData[];
};

export type LeaseBatchItemFormData = {
  product_id: string;
  quantity: number;
  return_due_date: string;
};

/** リース在庫の移動理由。lease_stock_ledger.reason と一致させる。 */
export type LeaseMovementReason =
  | "receive"
  | "ship"
  | "return_from_site"
  | "return_to_company";

export const LEASE_MOVEMENT_REASON_LABELS: Record<LeaseMovementReason, string> =
  {
    receive: "リース会社から受入",
    ship: "センター → 現場 出庫",
    return_from_site: "現場 → センター 返却",
    return_to_company: "リース会社へ返却",
  };

/**
 * 在庫内訳ビュー material_stock_breakdown の1行。
 * ownership='owned' のときリース関連列はすべて null。
 */
export type MaterialStockBreakdownRow = {
  row_id: string;
  ownership: "owned" | "leased";
  product_id: string;
  lease_company_id: string | null;
  lease_company_name: string | null;
  lease_batch_item_id: string | null;
  slip_number: string | null;
  borrowed_at: string | null;
  return_due_date: string | null;
  /** 返却義務残 = 受入済み数量 - 返却済み数量。owned 行は常に null */
  return_obligation_quantity: number | null;
  storage_kind: "center" | "site";
  site_id: string | null;
  location: string;
  quantity: number;
};

/** 返却期限の状態。返却義務残（受入済み-返却済み）がある借用分のみ警告対象（要件定義書 §9）。 */
export type LeaseDueState = "none" | "before" | "today" | "overdue";

export function resolveLeaseDueState(
  returnDueDate: string | null,
  returnObligationQuantity: number,
  today: Date = new Date(),
): LeaseDueState {
  if (!returnDueDate || returnObligationQuantity <= 0) return "none";

  const due = new Date(`${returnDueDate}T00:00:00`);
  const base = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  if (due.getTime() < base.getTime()) return "overdue";
  if (due.getTime() === base.getTime()) return "today";
  return "before";
}

export const LEASE_DUE_STATE_LABELS: Record<LeaseDueState, string> = {
  none: "—",
  before: "期限前",
  today: "本日期限",
  overdue: "期限超過",
};
