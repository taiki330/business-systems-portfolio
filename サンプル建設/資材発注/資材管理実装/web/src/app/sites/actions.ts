"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { toUserFacingMessage } from "@/lib/errors/postgres-error-message";
import { createClient } from "@/lib/supabase/server";
import type { SiteFormData } from "@/types/site";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function parseFormData(formData: FormData): SiteFormData {
  return {
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    prime_contractor_id: String(formData.get("prime_contractor_id") ?? "").trim(),
    center_id: String(formData.get("center_id") ?? "").trim(),
    allow_partial_lot_default: formData.get("allow_partial_lot_default") != null,
  };
}

function validate(data: SiteFormData): string | null {
  if (!data.name) return "現場名は必須です。";
  return null;
}

function toRow(data: SiteFormData) {
  return {
    code: data.code || null,
    name: data.name,
    address: data.address || null,
    prime_contractor_id: data.prime_contractor_id || null,
    // center_id は事務(admin)のみ変更可（sites_admin_update RLS が admin の全カラム
    // 更新を許可済み）。未選択時は列デフォルト（関西）に委ねるため送らない。P4
    ...(data.center_id ? { center_id: data.center_id } : {}),
    allow_partial_lot_default: data.allow_partial_lot_default,
  };
}

export async function createSite(formData: FormData) {
  await requireAdmin();

  const data = parseFormData(formData);
  const errorMessage = validate(data);
  if (errorMessage) {
    redirect(`/sites/new?error=${encodeURIComponent(errorMessage)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("sites").insert(toRow(data));

  if (error) {
    redirect(`/sites/new?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/sites");
  redirect("/sites");
}

export async function updateSite(id: string, formData: FormData) {
  await requireAdmin();

  const data = parseFormData(formData);
  const errorMessage = validate(data);
  if (errorMessage) {
    redirect(`/sites/${id}/edit?error=${encodeURIComponent(errorMessage)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("sites").update(toRow(data)).eq("id", id);

  if (error) {
    redirect(`/sites/${id}/edit?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/sites");
  redirect("/sites");
}

export async function deleteSite(id: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase.from("sites").delete().eq("id", id);

  if (error) {
    redirect(`/sites?error=${encodeURIComponent(toUserFacingMessage(error))}`);
  }

  revalidatePath("/sites");
  redirect("/sites");
}
