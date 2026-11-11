import { requireAdmin } from "@/lib/auth/require-role";
import { csvResponse, toCsv } from "@/lib/analytics/csv";
import { fetchSiteSummary } from "@/lib/analytics/fetch-phase5";
import { defaultDateRange, parseDate } from "@/lib/analytics/period-range";

/** 現場別分析 CSV（Phase 5 要件6）。表示中の条件を反映。 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const def = defaultDateRange();
  const from = parseDate(sp.get("from") ?? undefined) ?? def.from;
  const to = parseDate(sp.get("to") ?? undefined) ?? def.to;
  const siteId = sp.get("site_id")?.trim() || "";

  const { rows: all, error } = await fetchSiteSummary(from, to);
  if (error) return new Response(error.message, { status: 500 });
  const rows = siteId ? all.filter((r) => r.siteId === siteId) : all;

  const csv = toCsv(
    ["現場", "出庫", "返却", "現在庫", "未処理依頼", "予定数量", "超過数量"],
    rows.map((r) => [
      r.siteName,
      r.shippedQuantity,
      r.returnedQuantity,
      r.currentStock,
      r.pendingRequests,
      r.plannedTotal,
      r.overQuantity,
    ]),
  );
  return csvResponse(csv, `site_analysis_${from}_${to}.csv`);
}
