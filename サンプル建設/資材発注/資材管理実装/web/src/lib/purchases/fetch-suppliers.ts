import { createClient } from "@/lib/supabase/server";
import type { Supplier, SupplierOption } from "@/types/purchase";

/** 仕入先の一覧（マスタ画面用。無効なものも含む）。 */
export async function fetchSuppliers(
  searchTerm?: string,
): Promise<{ rows: Supplier[]; error: { message: string } | null }> {
  const supabase = await createClient();

  let query = supabase
    .from("suppliers")
    .select("id, name, note, is_active, created_at, updated_at")
    .order("name", { ascending: true });

  if (searchTerm) query = query.ilike("name", `%${searchTerm}%`);

  const { data, error } = await query;
  if (error) return { rows: [], error: { message: error.message } };
  return { rows: (data ?? []) as Supplier[], error: null };
}

/**
 * 仕入れ登録の選択肢（有効な仕入先のみ）。
 * 無効化済みの仕入先が既に選ばれている場合は、黙って別の値に変わらないよう選択肢へ含める。
 */
export async function fetchSupplierOptions(
  includeId?: string | null,
): Promise<SupplierOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, is_active")
    .order("name", { ascending: true });

  if (error) {
    console.error("fetchSupplierOptions:", error.message);
    return [];
  }

  return ((data ?? []) as (SupplierOption & { is_active: boolean })[])
    .filter((s) => s.is_active || s.id === includeId)
    .map((s) => ({ id: s.id, name: s.name }));
}
