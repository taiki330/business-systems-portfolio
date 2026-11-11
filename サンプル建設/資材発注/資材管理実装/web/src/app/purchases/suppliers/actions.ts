"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { toUserFacingMessage } from "@/lib/errors/postgres-error-message";
import { createClient } from "@/lib/supabase/server";
import type { SupplierFormData } from "@/types/purchase";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const LIST_PATH = "/purchases/suppliers";

function parseFormData(formData: FormData): SupplierFormData {
  return {
    name: String(formData.get("name") ?? "").trim(),
    note: String(formData.get("note") ?? "").trim(),
    // チェックボックス未チェック時は値が送られないため、明示的に false とする
    is_active: formData.get("is_active") !== null,
  };
}

function validate(data: SupplierFormData): string | null {
  if (!data.name) return "仕入先名は必須です。";
  return null;
}

export async function createSupplier(formData: FormData) {
  await requireAdmin();

  const data = parseFormData(formData);
  const errorMessage = validate(data);
  if (errorMessage) {
    redirect(`${LIST_PATH}/new?error=${encodeURIComponent(errorMessage)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert({
    name: data.name,
    note: data.note || null,
    is_active: data.is_active,
  });

  if (error) {
    redirect(
      `${LIST_PATH}/new?error=${encodeURIComponent(toUserFacingMessage(error))}`,
    );
  }

  revalidatePath(LIST_PATH);
  redirect(LIST_PATH);
}

export async function updateSupplier(id: string, formData: FormData) {
  await requireAdmin();

  const data = parseFormData(formData);
  const errorMessage = validate(data);
  if (errorMessage) {
    redirect(`${LIST_PATH}/${id}/edit?error=${encodeURIComponent(errorMessage)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({
      name: data.name,
      note: data.note || null,
      is_active: data.is_active,
    })
    .eq("id", id);

  if (error) {
    redirect(
      `${LIST_PATH}/${id}/edit?error=${encodeURIComponent(toUserFacingMessage(error))}`,
    );
  }

  revalidatePath(LIST_PATH);
  redirect(LIST_PATH);
}

/**
 * 仕入先を削除する。
 * 購入記録から参照されている仕入先は on delete restrict で拒否されるため、
 * その場合は「無効」にして選択肢から外す運用を案内する。
 */
export async function deleteSupplier(id: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").delete().eq("id", id);

  if (error) {
    redirect(
      `${LIST_PATH}?error=${encodeURIComponent(
        `${toUserFacingMessage(error)} この仕入先の購入記録がある場合は削除できません。「有効」のチェックを外して選択肢から除いてください。`,
      )}`,
    );
  }

  revalidatePath(LIST_PATH);
  redirect(LIST_PATH);
}
