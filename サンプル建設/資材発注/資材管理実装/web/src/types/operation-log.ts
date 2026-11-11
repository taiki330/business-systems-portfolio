/** operation_logs.entity_type（043 の CHECK 制約と対応）。 */
export type OperationEntityType =
  | "stock"
  | "stock_adjustment"
  | "stock_request"
  | "stock_return"
  | "lease_return"
  | "over_return"
  | "product"
  | "site"
  | "app_user"
  | "site_progress"
  | "order"
  | "slip"
  | "supplier"
  | "stock_purchase";

export const OPERATION_ENTITY_LABELS: Record<OperationEntityType, string> = {
  stock: "在庫増減",
  stock_adjustment: "在庫調整",
  stock_request: "出庫依頼",
  stock_return: "返却",
  lease_return: "リース返却",
  over_return: "過入庫",
  product: "資材マスタ",
  site: "現場情報",
  app_user: "権限",
  site_progress: "現場進捗",
  order: "オーダー",
  slip: "伝票",
  supplier: "仕入先",
  stock_purchase: "仕入れ",
};

/** 画面の絞り込みに出す順序。Phase 7/8 の種別は実装後に表示されるようになる。 */
export const OPERATION_ENTITY_ORDER: OperationEntityType[] = [
  "stock",
  "stock_adjustment",
  "stock_request",
  "stock_return",
  "lease_return",
  "over_return",
  "product",
  "site",
  "app_user",
  "site_progress",
  "order",
  "slip",
  "supplier",
  "stock_purchase",
];

export function isOperationEntityType(
  value: string,
): value is OperationEntityType {
  return (OPERATION_ENTITY_ORDER as string[]).includes(value);
}

/** operation 値の日本語表示。043 の CHECK 制約に列挙された値と 1:1 で対応する。 */
export const OPERATION_LABELS: Record<string, string> = {
  "stock.moved": "入出庫登録",
  "stock.adjusted": "在庫直接補正",
  "stock_adjustment.requested": "調整を申請",
  "stock_adjustment.approved": "調整を承認",
  "stock_adjustment.rejected": "調整を却下",
  "stock_request.created": "出庫依頼を作成",
  "stock_request.accepted": "出庫依頼を受付",
  "stock_request.shipped": "出庫を確定",
  "stock_request.cancelled": "出庫依頼を取消",
  "stock_return.created": "返却を登録",
  "lease_return.created": "リース返却を登録",
  "over_return.created": "過入庫を登録",
  "over_return.confirmed": "過入庫を確認",
  "product.created": "資材を登録",
  "product.updated": "資材を変更",
  "product.deleted": "資材を削除",
  "site.created": "現場を登録",
  "site.updated": "現場情報を変更",
  "site.deleted": "現場を削除",
  "user_role.changed": "権限を変更",
  "site_progress.assembly_completed": "組立完了を記録",
  "site_progress.dismantle_started": "解体開始を記録",
  "site_progress.dismantle_completed": "解体完了を記録",
  "order.created": "オーダーを作成",
  "order.updated": "オーダーを変更",
  "order.deleted": "オーダーを削除",
  "slip.created": "伝票を作成",
  "slip.updated": "伝票を変更",
  "slip.deleted": "伝票を削除",
  "supplier.created": "仕入先を登録",
  "supplier.updated": "仕入先を変更",
  "supplier.deleted": "仕入先を削除",
  "stock_purchase.created": "仕入れを登録",
};

/** ロールの日本語表示（操作時点のスナップショット値）。 */
export const ACTOR_ROLE_LABELS: Record<string, string> = {
  admin: "事務",
  center: "センター",
  vendor: "現場・業者",
  internal: "社内（旧）",
};

/** 操作履歴一覧の1行。 */
export type OperationLogRow = {
  id: string;
  operation: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  actorRole: string | null;
  quantity: number | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
  productName: string | null;
  siteName: string | null;
};
