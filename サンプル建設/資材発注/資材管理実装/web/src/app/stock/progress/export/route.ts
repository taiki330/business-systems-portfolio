import { csvResponse, toCsv } from "@/lib/analytics/csv";
import { requireAdmin } from "@/lib/auth/require-role";
import { fetchSiteProgressEvents } from "@/lib/sites/fetch-site-progress";
import { SITE_PROGRESS_LABELS } from "@/types/site-progress";

const EXPORT_LIMIT = 5000;

/** 現場進捗一覧を、Excelで文字化けせず開けるCSVとして出力する。 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const siteId = new URL(request.url).searchParams.get("site_id")?.trim() || undefined;
  const { rows, error } = await fetchSiteProgressEvents(siteId, EXPORT_LIMIT);
  if (error) return new Response(error.message, { status: 500 });

  const csv = toCsv(
    [
      "現場",
      "区分",
      "発生日",
      "出庫総数",
      "返却数",
      "未返却数",
      "過入庫数",
      "現場残数",
      "記録日時",
      "記録者",
      "備考",
    ],
    rows.map((row) => [
      row.siteName,
      SITE_PROGRESS_LABELS[row.kind],
      row.occurredOn,
      row.totals.shipped,
      row.totals.returned,
      row.totals.outstanding,
      row.totals.overReturn,
      row.totals.siteQuantity,
      new Date(row.recordedAt).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
      }),
      row.recordedByName ?? "",
      row.note ?? "",
    ]),
  );

  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
  }).format(new Date());
  return csvResponse(csv, `site_progress_${today}.csv`);
}
