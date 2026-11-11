import { requireAdmin } from "@/lib/auth/require-role";
import { csvResponse, toCsv } from "@/lib/analytics/csv";
import { fetchPurchases } from "@/lib/purchases/fetch-purchases";

/**
 * 仕入れ履歴の CSV 出力（事務のみ）。
 * ヒアリングで「一覧で見れてエクセルに落とせたら嬉しい」との要望があったため用意する。
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const productId = sp.get("product_id")?.trim() || undefined;
  const supplierId = sp.get("supplier_id")?.trim() || undefined;

  const { rows, error } = await fetchPurchases({ productId, supplierId });
  if (error) return new Response(error.message, { status: 500 });

  const csv = toCsv(
    [
      "購入日",
      "仕入先",
      "資材コード",
      "資材名",
      "単位",
      "資材種別",
      "数量",
      "備考",
      "登録日時",
      "登録者",
    ],
    rows.map((r) => [
      r.purchaseDate,
      r.supplierName,
      r.productCode ?? "",
      r.productName,
      r.productUnit ?? "",
      r.categoryName ?? "未分類",
      r.quantity,
      r.note ?? "",
      new Date(r.createdAt).toLocaleString("ja-JP"),
      r.createdByName ?? "",
    ]),
  );

  const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return csvResponse(csv, `purchases_${today}.csv`);
}
