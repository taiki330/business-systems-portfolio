import { requireAdmin } from "@/lib/auth/require-role";
import { csvResponse, toCsv } from "@/lib/analytics/csv";
import { fetchLeaseCompanySummary } from "@/lib/analytics/fetch-phase5";
import { defaultRange, parseDate, parsePeriodKind } from "@/lib/analytics/period-range";

/** リース会社別分析 CSV（Phase 5 要件6）。表示中の条件（会社/商品/状態/期間）を反映。 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const kind = parsePeriodKind(sp.get("period") ?? undefined);
  const def = defaultRange(kind);
  const from = parseDate(sp.get("from") ?? undefined) ?? def.from;
  const to = parseDate(sp.get("to") ?? undefined) ?? def.to;
  const companyId = sp.get("company_id")?.trim() || "";
  const productId = sp.get("product_id")?.trim() || "";
  const state = sp.get("state") || "all";

  const { rows: all, error } = await fetchLeaseCompanySummary(
    from,
    to,
    productId || undefined,
  );
  if (error) return new Response(error.message, { status: 500 });

  let rows = companyId ? all.filter((r) => r.leaseCompanyId === companyId) : all;
  if (state === "overdue") rows = rows.filter((r) => r.overdueCount > 0);
  else if (state === "in_field") rows = rows.filter((r) => r.siteStock > 0);

  const csv = toCsv(
    ["リース会社", "受入", "出庫", "会社返却", "現場在庫", "返却期限超過件数"],
    rows.map((r) => [
      r.leaseCompanyName,
      r.receivedQuantity,
      r.shippedQuantity,
      r.returnedQuantity,
      r.siteStock,
      r.overdueCount,
    ]),
  );
  return csvResponse(csv, `lease_analysis_${from}_${to}.csv`);
}
