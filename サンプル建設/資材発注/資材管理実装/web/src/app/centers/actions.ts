"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function messageFor(error: string) {
  if (error.includes("invalid_center_code")) return "センターコードは英小文字で始め、英小文字・数字・ハイフン・アンダースコアを2〜30文字で入力してください。";
  if (error.includes("center_code_already_exists")) return "そのセンターコードは既に使われています。";
  if (error.includes("center_name_required")) return "センター名を入力してください。";
  if (error.includes("center_not_found")) return "対象のセンターが見つかりません。";
  return error;
}

export async function createCenter(formData: FormData) {
  await requireAdmin();
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_center", { p_code: code, p_name: name });
  if (error) redirect(`/centers?error=${encodeURIComponent(messageFor(error.message))}`);

  revalidatePath("/centers");
  revalidatePath("/sites");
  revalidatePath("/users");
  revalidatePath("/stock");
  revalidatePath("/stock/summary");
  revalidatePath("/stock/transfers");
  redirect("/centers?ok=created");
}

export async function updateCenterName(centerId: string, formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_center_name", {
    p_center_id: centerId,
    p_name: name,
  });
  if (error) redirect(`/centers?error=${encodeURIComponent(messageFor(error.message))}`);

  revalidatePath("/centers");
  revalidatePath("/sites");
  revalidatePath("/users");
  revalidatePath("/stock");
  revalidatePath("/stock/summary");
  revalidatePath("/stock/transfers");
  redirect("/centers?ok=updated");
}
