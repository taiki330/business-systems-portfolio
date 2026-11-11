import { createClient } from "@/lib/supabase/server";
import type {
  AnalyticsPeriodKind,
  AnalyticsResult,
  DashboardKpi,
  LeaseCompanySummaryRow,
  LeasePeriodRow,
  PeriodSummaryRow,
  ProductSummaryRow,
  ProductUtilizationRow,
  ProductUtilizationSort,
  SiteSummaryRow,
} from "@/types/analytics-phase5";

const num = (v: unknown): number => Number(v ?? 0);

/** ダッシュボード KPI（analytics_dashboard） */
export async function fetchDashboard(
  monthStartISO: string,
): Promise<AnalyticsResult<DashboardKpi | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("analytics_dashboard", {
    p_month: monthStartISO,
  });
  if (error) return { rows: null, error: { message: error.message } };
  const r = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | undefined;
  if (!r) return { rows: null, error: null };
  return {
    rows: {
      thisMonth: String(r.this_month ?? monthStartISO),
      thisShipped: num(r.this_shipped),
      prevShipped: num(r.prev_shipped),
      thisReturned: num(r.this_returned),
      prevReturned: num(r.prev_returned),
      siteStockOwned: num(r.site_stock_owned),
      leaseOutstanding: num(r.lease_outstanding),
      overdueLeaseCount: num(r.overdue_lease_count),
      overPlanCount: num(r.over_plan_count),
    },
    error: null,
  };
}

/** 月別・年別集計（analytics_period_summary） */
export async function fetchPeriodSummary(
  kind: AnalyticsPeriodKind,
  from: string,
  to: string,
): Promise<AnalyticsResult<PeriodSummaryRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("analytics_period_summary", {
    p_kind: kind,
    p_from: from,
    p_to: to,
  });
  if (error) return { rows: [], error: { message: error.message } };
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    period: String(r.period),
    shippedQuantity: num(r.shipped_quantity),
    returnedQuantity: num(r.returned_quantity),
    netQuantity: num(r.net_quantity),
    leaseReceivedQuantity: num(r.lease_received_quantity),
    leaseReturnedToCompany: num(r.lease_returned_to_company),
    siteCount: num(r.site_count),
    requestCount: num(r.request_count),
  }));
  return { rows, error: null };
}

/** 現場別分析（analytics_site_summary） */
export async function fetchSiteSummary(
  from: string,
  to: string,
): Promise<AnalyticsResult<SiteSummaryRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("analytics_site_summary", {
    p_from: from,
    p_to: to,
  });
  if (error) return { rows: [], error: { message: error.message } };
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    siteId: String(r.site_id),
    siteName: String(r.site_name ?? "(現場不明)"),
    shippedQuantity: num(r.shipped_quantity),
    returnedQuantity: num(r.returned_quantity),
    currentStock: num(r.current_stock),
    pendingRequests: num(r.pending_requests),
    plannedTotal: num(r.planned_total),
    overQuantity: num(r.over_quantity),
  }));
  return { rows, error: null };
}

/** 商品別分析（analytics_product_summary） */
export async function fetchProductSummary(
  from: string,
  to: string,
): Promise<AnalyticsResult<ProductSummaryRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("analytics_product_summary", {
    p_from: from,
    p_to: to,
  });
  if (error) return { rows: [], error: { message: error.message } };
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    productId: String(r.product_id),
    productCode: (r.product_code as string | null) ?? null,
    productName: String(r.product_name ?? "(商品不明)"),
    productUnit: (r.product_unit as string | null) ?? null,
    shippedQuantity: num(r.shipped_quantity),
    shippedOwned: num(r.shipped_owned),
    shippedLeased: num(r.shipped_leased),
    returnedQuantity: num(r.returned_quantity),
    currentStock: num(r.current_stock),
    currentOwned: num(r.current_owned),
    currentLeased: num(r.current_leased),
    usingSiteCount: num(r.using_site_count),
    plannedTotal: num(r.planned_total),
    overQuantity: num(r.over_quantity),
  }));
  return { rows, error: null };
}

/** 商品別の平均稼働・リース依存分析（041の日次確定在庫のみを使用）。 */
export async function fetchProductUtilization(
  kind: AnalyticsPeriodKind,
  from: string,
  to: string,
  options?: {
    productId?: string;
    sort?: ProductUtilizationSort;
    direction?: "asc" | "desc";
  },
): Promise<AnalyticsResult<ProductUtilizationRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("analytics_product_utilization", {
    p_kind: kind,
    p_from: from,
    p_to: to,
    p_product_id: options?.productId || null,
    p_sort: options?.sort ?? "owned_utilization",
    p_sort_direction: options?.direction ?? "desc",
  });
  if (error) return { rows: [], error: { message: error.message } };

  const nullableNum = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    period: String(r.period),
    productId: String(r.product_id),
    productCode: (r.product_code as string | null) ?? null,
    productName: String(r.product_name ?? "(商品不明)"),
    productUnit: (r.product_unit as string | null) ?? null,
    isAvailable: Boolean(r.is_available),
    snapshotDays: num(r.snapshot_days),
    expectedDays: num(r.expected_days),
    avgOwnedHolding: nullableNum(r.avg_owned_holding),
    avgOwnedSiteQuantity: nullableNum(r.avg_owned_site_quantity),
    ownedUtilizationRate: nullableNum(r.owned_utilization_rate),
    avgLeasedSiteQuantity: nullableNum(r.avg_leased_site_quantity),
    avgTotalSiteQuantity: nullableNum(r.avg_total_site_quantity),
    leaseDependencyRate: nullableNum(r.lease_dependency_rate),
    shippedQuantity: num(r.shipped_quantity),
    returnedQuantity: num(r.returned_quantity),
    turnoverQuantity: num(r.turnover_quantity),
    operatingSiteCount: nullableNum(r.operating_site_count),
  }));
  return { rows, error: null };
}

/** リース会社別 現況+期間フロー（analytics_lease_company_summary） */
export async function fetchLeaseCompanySummary(
  from: string,
  to: string,
  productId?: string,
): Promise<AnalyticsResult<LeaseCompanySummaryRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "analytics_lease_company_summary",
    { p_from: from, p_to: to, p_product_id: productId || null },
  );
  if (error) return { rows: [], error: { message: error.message } };
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    leaseCompanyId: String(r.lease_company_id),
    leaseCompanyName: String(r.lease_company_name ?? "(会社不明)"),
    receivedQuantity: num(r.received_quantity),
    shippedQuantity: num(r.shipped_quantity),
    returnedQuantity: num(r.returned_quantity),
    siteStock: num(r.site_stock),
    overdueCount: num(r.overdue_count),
  }));
  return { rows, error: null };
}

/** リース会社別 月別・年別フロー（analytics_lease_period） */
export async function fetchLeasePeriod(
  kind: AnalyticsPeriodKind,
  from: string,
  to: string,
  productId?: string,
): Promise<AnalyticsResult<LeasePeriodRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("analytics_lease_period", {
    p_kind: kind,
    p_from: from,
    p_to: to,
    p_product_id: productId || null,
  });
  if (error) return { rows: [], error: { message: error.message } };
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    period: String(r.period),
    leaseCompanyId: String(r.lease_company_id),
    leaseCompanyName: String(r.lease_company_name ?? "(会社不明)"),
    receivedQuantity: num(r.received_quantity),
    shippedQuantity: num(r.shipped_quantity),
    returnedToCompany: num(r.returned_to_company),
  }));
  return { rows, error: null };
}
