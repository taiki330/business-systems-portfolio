import { createClient } from "@/lib/supabase/server";
import type { ProductOption } from "@/types/stock";

export async function fetchProductOptions(): Promise<ProductOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, product_categories(name)")
    .order("code", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (error) {
    console.error("fetchProductOptions:", error.message);
    return [];
  }

  type Raw = {
    id: string;
    code: string | null;
    name: string;
    product_categories: { name: string } | { name: string }[] | null;
  };

  return ((data ?? []) as Raw[]).map((p) => {
    const cat = Array.isArray(p.product_categories)
      ? (p.product_categories[0]?.name ?? null)
      : (p.product_categories?.name ?? null);
    return { id: p.id, code: p.code, name: p.name, category_name: cat };
  });
}
