"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { toUserFacingMessage } from "@/lib/errors/postgres-error-message";
import { createClient } from "@/lib/supabase/server";
import type { LeaseCompanyFormData } from "@/types/lease-company";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function parseFormData(formData: FormData): LeaseCompanyFormData {
  return {
    name: String(formData.get("name") ?? "").trim(),
    note: String(formData.get("note") ?? "").trim(),
    // チェックボックス未チェック時は値が送られないため、明示的に false とする
    is_active: formData.get("is_active") !== null,
  };
}

function validate(data: LeaseCompanyFormData): string | null {
  if (!data.name) return "リース会社名は必須です。";
  return null;
}

export async function createLeaseCompany(formData: FormData) {
  await requireAdmin();

  const data = parseFormData(formData);
  const errorMessage = validate(data);
  if (errorMessage) {
    redirect(`/leases/companies/new?error=${encodeURIComponent(errorMessage)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("lease_companies").insert({
    name: data.name,
    note: data.note || null,
    is_active: data.is_active,
  });

  if (error) {
    redirect(
      `/leases/companies/new?error=${encodeURIComponent(toUserFacingMessage(error))}`,
    );
  }

  revalidatePath("/leases/companies");
  redirect("/leases/companies");
}

export async function updateLeaseCompany(id: string, formData: FormData) {
  await requireAdmin();

  const data = parseFormData(formData);
  const errorMessage = validate(data);
  if (errorMessage) {
    redirect(
      `/leases/companies/${id}/edit?error=${encodeURIComponent(errorMessage)}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("lease_companies")
    .update({
      name: data.name,
      note: data.note || null,
      is_active: data.is_active,
    })
    .eq("id", id);

  if (error) {
    redirect(
      `/leases/companies/${id}/edit?error=${encodeURIComponent(toUserFacingMessage(error))}`,
    );
  }

  revalidatePath("/leases/companies");
  redirect("/leases/companies");
}

export async function deleteLeaseCompany(id: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase.from("lease_companies").delete().eq("id", id);

  if (error) {
    redirect(
      `/leases/companies?error=${encodeURIComponent(toUserFacingMessage(error))}`,
    );
  }

  revalidatePath("/leases/companies");
  redirect("/leases/companies");
}
