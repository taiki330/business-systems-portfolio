import { requireAdmin } from "@/lib/auth/require-role";
import { csvResponse, toCsv } from "@/lib/analytics/csv";
import { createClient } from "@/lib/supabase/server";

const EXPORT_LIMIT = 10000;

export async function GET(request: Request) {
  await requireAdmin();
  const searchParams = new URL(request.url).searchParams;
  const runId = searchParams.get("run_id");
  const requestedPage = Number(searchParams.get("page") ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  if (!runId) return new Response("アーカイブ出力の準備から開始してください。", { status: 400 });
  const supabase = await createClient();
  const { data: cutoffData, error: runError } = await supabase.rpc("get_stock_history_archive_cutoff", { p_run_id: runId });
  const cutoff = cutoffData as string | null;
  if (runError || !cutoff) return new Response(runError?.message ?? "アーカイブ出力を確認できません。", { status: 400 });
  const { data, error, count } = await supabase
    .from("stock_ledger")
    .select("id, location, movement_type, quantity, created_at, products(code, name, unit)", { count: "exact" })
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .range((page - 1) * EXPORT_LIMIT, page * EXPORT_LIMIT - 1);
  if (error) return new Response(error.message, { status: 500 });
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / EXPORT_LIMIT));
  const { error: markError } = await supabase.rpc("mark_stock_history_archive_export", { p_run_id: runId, p_part: "ledger", p_page: page, p_total_pages: totalPages });
  if (markError) return new Response(markError.message, { status: 500 });

  const rows = (data ?? []).map((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return [
      row.id,
      row.created_at,
      row.movement_type === "in" ? "入庫" : "出庫",
      product?.code ?? "",
      product?.name ?? "",
      product?.unit ?? "",
      row.location,
      String(row.quantity),
    ];
  });
  return csvResponse(toCsv(["ID", "日時", "区分", "商品コード", "商品名", "単位", "保管場所", "数量"], rows), "stock_ledger_archive.csv");
}
