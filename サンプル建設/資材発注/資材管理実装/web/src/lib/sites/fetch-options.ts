import { createClient } from "@/lib/supabase/server";

export type SiteOption = {
  id: string;
  code: string | null;
  name: string;
};

export async function fetchSiteOptions(): Promise<SiteOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, code, name")
    .order("code", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (error) {
    console.error("fetchSiteOptions:", error.message);
    return [];
  }

  return (data ?? []) as SiteOption[];
}
