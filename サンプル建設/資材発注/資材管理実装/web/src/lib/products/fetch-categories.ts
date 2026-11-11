import { createClient } from "@/lib/supabase/server";
import type {
  ProductCategory,
  ProductCategoryOption,
} from "@/types/product-category";

/** 資材種別の一覧（マスタ画面用。無効なものも含む）。 */
export async function fetchProductCategories(): Promise<{
  rows: ProductCategory[];
  error: { message: string } | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, code, name, sort_order, is_active, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) return { rows: [], error: { message: error.message } };
  return { rows: (data ?? []) as ProductCategory[], error: null };
}

/**
 * 資材フォームの選択肢（有効なもののみ）。
 * 編集時に「すでに無効化された種別が設定されている」場合は、その種別も選択肢へ含める
 * （黙って別の種別に変わってしまうのを防ぐため）。
 */
export async function fetchProductCategoryOptions(
  includeId?: string | null,
): Promise<ProductCategoryOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, name, is_active")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("fetchProductCategoryOptions:", error.message);
    return [];
  }

  return ((data ?? []) as (ProductCategoryOption & { is_active: boolean })[])
    .filter((category) => category.is_active || category.id === includeId)
    .map((category) => ({ id: category.id, name: category.name }));
}
