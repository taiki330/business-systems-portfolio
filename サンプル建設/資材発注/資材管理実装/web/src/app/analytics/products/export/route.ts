import { requireAdmin } from "@/lib/auth/require-role";
import { csvResponse, toCsv } from "@/lib/analytics/csv";
import { fetchProductUtilization } from "@/lib/analytics/fetch-phase5";
import {
  defaultRange,
  formatPeriod,
  parseDate,
  parsePeriodKind,
} from "@/lib/analytics/period-range";
import type { ProductUtilizationSort } from "@/types/analytics-phase5";

const SORTS: ProductUtilizationSort[] = [
  "owned_utilization",
  "lease_dependency",
  "turnover",
  "product",
];

function rate(value: number | null): string | number {
  return value === null ? "算出不可" : value;
}

/** 商品別稼働率CSV。画面と同一のRPC・商品/期間/並び順条件を使う。 */
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
  const productId = sp.get("product_id")?.trim() || undefined;
  const rawSort = sp.get("sort") ?? "owned_utilization";
  const sort = SORTS.includes(rawSort as ProductUtilizationSort)
    ? (rawSort as ProductUtilizationSort)
    : "owned_utilization";
  const direction = sp.get("direction") === "asc" ? "asc" : "desc";

  const { rows, error } = await fetchProductUtilization(kind, from, to, {
    productId,
    sort,
    direction,
  });
  if (error) return new Response(error.message, { status: 500 });

  const csv = toCsv(
    [
      "期間", "商品コード", "商品名", "単位", "稼働率算出可否", "対象日数", "暦日数",
      "平均自社保有数量", "自社平均稼働数量", "自社稼働率(%)", "リース平均稼働数量",
      "総平均稼働数量", "リース依存率(%)", "出庫数量", "返却数量", "回転量", "稼働現場数",
    ],
    rows.map((r) => [
      formatPeriod(r.period, kind), r.productCode ?? "", r.productName, r.productUnit ?? "",
      r.isAvailable ? "算出可" : "算出不可", r.snapshotDays, r.expectedDays,
      r.avgOwnedHolding ?? "算出不可", r.avgOwnedSiteQuantity ?? "算出不可", rate(r.ownedUtilizationRate),
      r.avgLeasedSiteQuantity ?? "算出不可", r.avgTotalSiteQuantity ?? "算出不可", rate(r.leaseDependencyRate),
      r.shippedQuantity, r.returnedQuantity, r.turnoverQuantity, r.operatingSiteCount ?? "算出不可",
    ]),
  );
  return csvResponse(csv, `product_utilization_${kind}_${from}_${to}.csv`);
}
