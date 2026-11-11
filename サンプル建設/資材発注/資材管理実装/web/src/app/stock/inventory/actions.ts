"use server";

import { requireAdminOrCenter } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function inventoryErrorUrl(id: string, message: string): string {
  return `/stock/inventory/${id}?error=${encodeURIComponent(message)}`;
}

export async function startInventoryCount(formData: FormData) {
  await requireAdminOrCenter();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_inventory_count", {
    p_note: String(formData.get("note") ?? ""),
  });

  if (error || !data) {
    redirect(
      `/stock/inventory?error=${encodeURIComponent(error?.message ?? "棚卸を開始できませんでした。")}`,
    );
  }
  redirect(`/stock/inventory/${data}`);
}

export async function saveInventoryCount(id: string, formData: FormData) {
  await requireAdminOrCenter();
  const counts: Record<string, number> = {};

  for (const [key, value] of formData.entries()) {
    if (key.startsWith("count_")) counts[key.slice(6)] = Number(value);
  }

  if (
    Object.keys(counts).length === 0 ||
    Object.values(counts).some((value) => !Number.isFinite(value) || value < 0)
  ) {
    redirect(inventoryErrorUrl(id, "実数は0以上の数値で入力してください。"));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_inventory_count", {
    p_inventory_count_id: id,
    p_counts: counts,
  });

  if (error) redirect(inventoryErrorUrl(id, error.message));

  revalidatePath("/stock/inventory");
  revalidatePath(`/stock/inventory/${id}`);
  redirect(`/stock/inventory/${id}?ok=saved`);
}

export async function applyInventoryCount(id: string, formData: FormData) {
  await requireAdminOrCenter();
  const itemIds = formData
    .getAll("apply_item_ids")
    .map(String)
    .filter(Boolean);

  if (formData.get("has_differences") === "1" && itemIds.length === 0) {
    redirect(inventoryErrorUrl(id, "在庫へ反映する明細を選択してください。"));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_inventory_count", {
    p_inventory_count_id: id,
    p_item_ids: itemIds,
  });

  if (error) redirect(inventoryErrorUrl(id, error.message));

  revalidatePath("/stock");
  revalidatePath("/stock/inventory");
  revalidatePath(`/stock/inventory/${id}`);
  redirect(`/stock/inventory/${id}?ok=completed`);
}
