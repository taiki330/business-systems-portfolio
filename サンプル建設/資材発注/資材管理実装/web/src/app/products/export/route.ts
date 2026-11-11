import { csvResponse, toCsv } from "@/lib/analytics/csv";
import { requireAdmin } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

type ProductExportRow = {
  code: string | null;
  name: string;
  unit: string | null;
  lot_size: number | null;
  weight_kg: number | null;
  product_categories: { name: string } | { name: string }[] | null;
};

function categoryName(value: ProductExportRow["product_categories"]): string {
  if (!value) return "";
  return Array.isArray(value) ? (value[0]?.name ?? "") : value.name;
}

/** 資材予測システムへ渡す商品マスタ。商品コードを両システムの照合キーとして使う。 */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("code, name, unit, lot_size, weight_kg, product_categories(name)")
    .order("code", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (error) return new Response("商品マスタの取得に失敗しました。", { status: 500 });

  const rows = (data ?? []) as ProductExportRow[];
  const csv = toCsv(
    ["商品コード", "商品名", "規格", "単位", "分類", "セット数", "重量kg"],
    rows.map((product) => [
      product.code ?? "",
      product.name,
      "",
      product.unit ?? "",
      categoryName(product.product_categories),
      product.lot_size ?? "",
      product.weight_kg ?? "",
    ]),
  );

  return csvResponse(csv, "product_master.csv");
}
