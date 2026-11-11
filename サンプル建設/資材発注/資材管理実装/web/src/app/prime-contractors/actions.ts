"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function parse(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    slip_number: String(formData.get("slip_number") ?? "").trim(),
    is_active: formData.get("is_active") === "on",
  };
}

function validate(data: ReturnType<typeof parse>) {
  if (!data.name) return "元請名を入力してください。";
  if (!data.slip_number) return "元請番号を入力してください。";
  return null;
}

export async function createPrimeContractor(formData: FormData) {
  await requireAdmin();
  const data = parse(formData);
  const validationError = validate(data);
  if (validationError) redirect(`/prime-contractors?error=${encodeURIComponent(validationError)}`);

  const supabase = await createClient();
  const { error } = await supabase.from("prime_contractors").insert(data);
  if (error) redirect(`/prime-contractors?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/prime-contractors");
  revalidatePath("/sites");
  redirect("/prime-contractors?ok=created");
}

export async function updatePrimeContractor(id: string, formData: FormData) {
  await requireAdmin();
  const data = parse(formData);
  const validationError = validate(data);
  if (validationError) redirect(`/prime-contractors?error=${encodeURIComponent(validationError)}`);

  const supabase = await createClient();
  const { error } = await supabase.from("prime_contractors").update(data).eq("id", id);
  if (error) redirect(`/prime-contractors?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/prime-contractors");
  revalidatePath("/sites");
  redirect("/prime-contractors?ok=updated");
}
