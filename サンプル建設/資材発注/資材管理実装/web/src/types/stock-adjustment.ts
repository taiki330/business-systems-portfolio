import type { SiteRef, StockProductRef } from "@/types/stock";

/** 在庫調整申請の状態。承認されたときにのみ在庫が動く。 */
export type StockAdjustmentStatus = "pending" | "approved" | "rejected";

export const STOCK_ADJUSTMENT_STATUS_LABELS: Record<
  StockAdjustmentStatus,
  string
> = {
  pending: "未処理",
  approved: "承認済み",
  rejected: "却下",
};

export function isStockAdjustmentStatus(
  value: string,
): value is StockAdjustmentStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}

/** 在庫調整申請の1行（Phase 6-3）。 */
export type StockAdjustmentRequestRow = {
  id: string;
  storageKind: "center" | "site";
  location: string;
  /** 申請者が実際に数えた数量 */
  countedQuantity: number;
  /** 申請時点のシステム数量 */
  systemQuantity: number;
  /** 承認時に在庫へ加算される差分 */
  delta: number;
  status: StockAdjustmentStatus;
  note: string | null;
  decidedNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
  requestedByName: string | null;
  decidedByName: string | null;
  products: StockProductRef | null;
  sites: SiteRef | null;
};

/** 申請フォームで使う保管場所の選択肢。 */
export type AdjustmentLocationOption = {
  /** "center" または site の UUID */
  value: string;
  label: string;
};
