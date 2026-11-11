/**
 * Phase 5 分析機能の型。
 *
 * すべて DB 側（migration 040 の SECURITY DEFINER RPC）で集計した結果を受け取る。
 * 数量は numeric(12,2) が文字列で返ることがあるため、fetch 層で Number 化する。
 */

export type AnalyticsPeriodKind = "month" | "year";

export const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriodKind, string> = {
  month: "月別",
  year: "年別",
};

/** analytics_dashboard の1行 */
export type DashboardKpi = {
  thisMonth: string;
  thisShipped: number;
  prevShipped: number;
  thisReturned: number;
  prevReturned: number;
  siteStockOwned: number;
  leaseOutstanding: number;
  overdueLeaseCount: number;
  overPlanCount: number;
};

/** analytics_period_summary の1行 */
export type PeriodSummaryRow = {
  period: string;
  shippedQuantity: number;
  returnedQuantity: number;
  netQuantity: number;
  leaseReceivedQuantity: number;
  leaseReturnedToCompany: number;
  siteCount: number;
  requestCount: number;
};

/** analytics_site_summary の1行 */
export type SiteSummaryRow = {
  siteId: string;
  siteName: string;
  shippedQuantity: number;
  returnedQuantity: number;
  currentStock: number;
  pendingRequests: number;
  plannedTotal: number;
  overQuantity: number;
};

/** analytics_product_summary の1行 */
export type ProductSummaryRow = {
  productId: string;
  productCode: string | null;
  productName: string;
  productUnit: string | null;
  shippedQuantity: number;
  shippedOwned: number;
  shippedLeased: number;
  returnedQuantity: number;
  currentStock: number;
  currentOwned: number;
  currentLeased: number;
  usingSiteCount: number;
  plannedTotal: number;
  overQuantity: number;
};

/** 在庫台帳から逆算した日次残高を基準にした商品別稼働率（Phase 5-2）。 */
export type ProductUtilizationSort =
  | "owned_utilization"
  | "lease_dependency"
  | "turnover"
  | "product";

export type ProductUtilizationRow = {
  period: string;
  productId: string;
  productCode: string | null;
  productName: string;
  productUnit: string | null;
  /** 対象期間の全日について確定スナップショットが存在するか。 */
  isAvailable: boolean;
  snapshotDays: number;
  expectedDays: number;
  avgOwnedHolding: number | null;
  avgOwnedSiteQuantity: number | null;
  ownedUtilizationRate: number | null;
  avgLeasedSiteQuantity: number | null;
  avgTotalSiteQuantity: number | null;
  leaseDependencyRate: number | null;
  shippedQuantity: number;
  returnedQuantity: number;
  turnoverQuantity: number;
  operatingSiteCount: number | null;
};

/** analytics_lease_company_summary の1行 */
export type LeaseCompanySummaryRow = {
  leaseCompanyId: string;
  leaseCompanyName: string;
  receivedQuantity: number;
  shippedQuantity: number;
  returnedQuantity: number;
  siteStock: number;
  overdueCount: number;
};

/** analytics_lease_period の1行 */
export type LeasePeriodRow = {
  period: string;
  leaseCompanyId: string;
  leaseCompanyName: string;
  receivedQuantity: number;
  shippedQuantity: number;
  returnedToCompany: number;
};

export type AnalyticsResult<T> = {
  rows: T;
  error: { message: string } | null;
};
