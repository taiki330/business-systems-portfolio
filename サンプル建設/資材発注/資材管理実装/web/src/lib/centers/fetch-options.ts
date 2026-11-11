import { createClient } from "@/lib/supabase/server";

export type CenterOption = {
  id: string;
  code: string;
  name: string;
};

/**
 * 地域センターの一覧を取得する。
 * 事務がセンターマスタで追加した拠点もこの一覧へ自動的に含まれる。
 */
export async function fetchCenterOptions(): Promise<CenterOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("centers")
    .select("id, code, name")
    .order("code", { ascending: true });

  if (error) {
    console.error("fetchCenterOptions:", error.message);
    return [];
  }

  return (data ?? []) as CenterOption[];
}
