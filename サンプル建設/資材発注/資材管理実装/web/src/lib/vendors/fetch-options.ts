import { createClient } from "@/lib/supabase/server";
import type { SiteOptionForVendor, VendorSiteRow } from "@/types/vendor";
import type { VendorOption } from "@/types/user-management";

export async function fetchVendorSitesByVendor(
  vendorId: string,
): Promise<VendorSiteRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_sites")
    .select("vendor_id, site_id, created_at, sites(code, name)")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("fetchVendorSitesByVendor:", error.message);
    return [];
  }

  return ((data ?? []) as (VendorSiteRow & {
    sites: { code: string | null; name: string } | { code: string | null; name: string }[] | null;
  })[]).map((raw) => {
    const s = raw.sites;
    const site = s == null ? null : Array.isArray(s) ? (s[0] ?? null) : s;
    return {
      vendor_id: raw.vendor_id,
      site_id: raw.site_id,
      created_at: raw.created_at,
      sites: site,
    };
  });
}

export async function fetchVendorOptions(): Promise<VendorOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    console.error("fetchVendorOptions:", error.message);
    return [];
  }

  return (data ?? []) as VendorOption[];
}

export async function fetchSiteOptionsForVendor(): Promise<SiteOptionForVendor[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, code, name")
    .order("code", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (error) {
    console.error("fetchSiteOptionsForVendor:", error.message);
    return [];
  }

  return (data ?? []) as SiteOptionForVendor[];
}
