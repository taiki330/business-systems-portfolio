import { requireAdmin } from "@/lib/auth/require-role";
import { csvResponse, toCsv } from "@/lib/analytics/csv";
import { fetchPeriodSummary } from "@/lib/analytics/fetch-phase5";
import {
  defaultRange,
  formatPeriod,
  parseDate,
  parsePeriodKind,
} from "@/lib/analytics/period-range";

/** 月別・年別集計 CSV（Phase 5 要件6）。表示中の条件を反映。 */
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

  const { rows, error } = await fetchPeriodSummary(kind, from, to);
  if (error) return new Response(error.message, { status: 500 });

  const csv = toCsv(
    ["期間", "出庫", "返却", "純増減", "リース受入", "リース会社返却", "現場数", "依頼件数"],
    rows.map((r) => [
      formatPeriod(r.period, kind),
      r.shippedQuantity,
      r.returnedQuantity,
      r.netQuantity,
      r.leaseReceivedQuantity,
      r.leaseReturnedToCompany,
      r.siteCount,
      r.requestCount,
    ]),
  );
  return csvResponse(csv, `period_summary_${kind}_${from}_${to}.csv`);
}
