import { createClient } from "@/lib/supabase/server";
import type { LeaseCompanyOption } from "@/types/lease-company";

/**
 * 借用登録の選択肢用。無効化（is_active=false）されたリース会社は除外する。
 * 既存借用が参照している無効会社は一覧・詳細では引き続き表示される（除外は新規登録時のみ）。
 */
export async function fetchLeaseCompanyOptions(): Promise<LeaseCompanyOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lease_companies")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("fetchLeaseCompanyOptions:", error.message);
    return [];
  }

  return (data ?? []) as LeaseCompanyOption[];
}
