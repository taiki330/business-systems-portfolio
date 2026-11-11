"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { toUserFacingMessage } from "@/lib/errors/postgres-error-message";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function revalidateVendorSitePaths(vendorId: string) {
  revalidatePath(`/vendors/${vendorId}/sites`);
}

export async function addVendorSite(vendorId: string, formData: FormData) {
  await requireAdmin();

  if (!vendorId) {
    redirect(`/vendors?error=${encodeURIComponent("業者 ID が不正です。")}`);
  }

  const siteId = String(formData.get("site_id") ?? "").trim();
  if (!siteId) {
    redirect(
      `/vendors/${vendorId}/sites?error=${encodeURIComponent("現場を選択してください。")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("vendor_sites").insert({
    vendor_id: vendorId,
    site_id: siteId,
  });

  if (error) {
    redirect(
      `/vendors/${vendorId}/sites?error=${encodeURIComponent(toUserFacingMessage(error))}`,
    );
  }

  revalidateVendorSitePaths(vendorId);
  redirect(`/vendors/${vendorId}/sites?ok=created`);
}

export async function removeVendorSite(vendorId: string, siteId: string) {
  await requireAdmin();

  if (!vendorId || !siteId) {
    redirect(`/vendors?error=${encodeURIComponent("ID が不正です。")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vendor_sites")
    .delete()
    .eq("vendor_id", vendorId)
    .eq("site_id", siteId);

  if (error) {
    redirect(
      `/vendors/${vendorId}/sites?error=${encodeURIComponent(toUserFacingMessage(error))}`,
    );
  }

  revalidateVendorSitePaths(vendorId);
  redirect(`/vendors/${vendorId}/sites?ok=deleted`);
}
