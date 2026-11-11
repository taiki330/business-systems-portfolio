"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { toUserFacingMessage } from "@/lib/errors/postgres-error-message";
import { createClient } from "@/lib/supabase/server";
import type { VendorFormData } from "@/types/vendor";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function parseFormData(formData: FormData): VendorFormData {
  return {
    name: String(formData.get("name") ?? "").trim(),
    note: String(formData.get("note") ?? "").trim(),
  };
}

function validate(data: VendorFormData): string | null {
  if (!data.name) return "業者名は必須です。";
  return null;
}

export async function createVendor(formData: FormData) {
  await requireAdmin();

  const data = parseFormData(formData);
  const errorMessage = validate(data);
  if (errorMessage) {
    redirect(`/vendors/new?error=${encodeURIComponent(errorMessage)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("vendors").insert({
    name: data.name,
    note: data.note || null,
  });

  if (error) {
    redirect(`/vendors/new?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/vendors");
  redirect("/vendors");
}

export async function updateVendor(id: string, formData: FormData) {
  await requireAdmin();

  const data = parseFormData(formData);
  const errorMessage = validate(data);
  if (errorMessage) {
    redirect(`/vendors/${id}/edit?error=${encodeURIComponent(errorMessage)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vendors")
    .update({
      name: data.name,
      note: data.note || null,
    })
    .eq("id", id);

  if (error) {
    redirect(`/vendors/${id}/edit?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/vendors");
  redirect("/vendors");
}

export async function deleteVendor(id: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase.from("vendors").delete().eq("id", id);

  if (error) {
    redirect(`/vendors?error=${encodeURIComponent(toUserFacingMessage(error))}`);
  }

  revalidatePath("/vendors");
  redirect("/vendors");
}
