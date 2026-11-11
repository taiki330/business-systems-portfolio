import type { SiteRef, StockProductRef } from "@/types/stock";

/** 過入庫の確認状態。confirmed にしても在庫数は変更されない。 */
export type OverReturnStatus = "unconfirmed" | "confirmed";

export const OVER_RETURN_STATUS_LABELS: Record<OverReturnStatus, string> = {
  unconfirmed: "未確認",
  confirmed: "確認済み",
};

export function isOverReturnStatus(value: string): value is OverReturnStatus {
  return value === "unconfirmed" || value === "confirmed";
}

/** 過入庫一覧の1行（Phase 6-2）。 */
export type OverReturnListRow = {
  id: string;
  /** 過入庫数（在庫へ加算されなかった超過分） */
  quantity: number;
  /** 返却時に入力された数量 */
  inputQuantity: number;
  /** 同じ返却操作で在庫へ加算された通常返却数 */
  normalQuantity: number;
  status: OverReturnStatus;
  memo: string | null;
  createdAt: string;
  confirmedAt: string | null;
  createdByName: string | null;
  confirmedByName: string | null;
  products: StockProductRef | null;
  sites: SiteRef | null;
};
