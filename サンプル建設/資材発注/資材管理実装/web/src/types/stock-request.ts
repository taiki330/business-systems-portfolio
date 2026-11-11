export const STOCK_REQUEST_STATUSES = [
  "requested",
  "accepted",
  "shipped",
  "cancelled",
] as const;

export type StockRequestStatus = (typeof STOCK_REQUEST_STATUSES)[number];

export const STOCK_REQUEST_STATUS_LABEL: Record<StockRequestStatus, string> = {
  requested: "依頼中",
  accepted: "受付済み",
  shipped: "出庫済み",
  cancelled: "キャンセル",
};

export type StockRequestRow = {
  id: string;
  site_id: string;
  product_id: string;
  quantity: number;
  status: StockRequestStatus;
  requested_at: string;
  accepted_at: string | null;
  shipped_at: string | null;
  cancelled_at: string | null;
  note: string | null;
  sites: { name: string; code: string | null } | null;
  products: { name: string; code: string | null; unit: string | null } | null;
};

export function isStockRequestStatus(value: string): value is StockRequestStatus {
  return (STOCK_REQUEST_STATUSES as readonly string[]).includes(value);
}
