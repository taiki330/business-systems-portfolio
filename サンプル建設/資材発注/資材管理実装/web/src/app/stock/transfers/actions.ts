"use server";

import { requireCenter } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapTransferError(message: string): string {
  if (message.includes("quantity_must_be_integer")) {
    return "数量は整数で入力してください。";
  }
  if (message.includes("center_account_required")) {
    return "地域センターに割り当てられたアカウントのみ登録できます。";
  }
  if (message.includes("invalid_to_center")) {
    return "移動先センターを選択してください。";
  }
  if (message.includes("same_center_transfer_not_allowed")) {
    return "移動元と移動先に同じセンターは選べません。";
  }
  if (message.includes("invalid_transfer_items") || message.includes("invalid_quantity")) {
    return "移動する資材と数量を1件以上、正しく入力してください。";
  }
  if (message.includes("invalid_product_id")) {
    return "選択した資材が見つかりません。画面を再読み込みしてもう一度入力してください。";
  }
  if (message.includes("permission_denied")) {
    return "センター間移動の登録権限がありません。";
  }
  return message;
}

/**
 * センター間移動（例: サンプル市A→サンプル市B）を登録する。
 * DB 側（create_center_transfer RPC）が在庫の即時反映まで1トランザクションで行う。
 * 在庫不足はブロックしない（警告のみ。P4-2 / docs/22 §7）。
 */
export async function createCenterTransfer(formData: FormData) {
  await requireCenter();

  const toCenterId = String(formData.get("to_center_id") ?? "").trim();
  if (!UUID_PATTERN.test(toCenterId)) {
    redirect(`/stock/transfers?error=${encodeURIComponent("移動先センターを選択してください。")}`);
  }

  const note = String(formData.get("note") ?? "").trim();

  const productIds = formData.getAll("product_id").map(String);
  const quantities = formData.getAll("quantity").map(String);

  const items = new Map<string, number>();
  productIds.forEach((productId, i) => {
    if (!UUID_PATTERN.test(productId)) return;
    const qty = Number(quantities[i]);
    if (Number.isFinite(qty) && qty > 0) {
      items.set(productId, (items.get(productId) ?? 0) + qty);
    }
  });

  if (items.size === 0) {
    redirect(
      `/stock/transfers?error=${encodeURIComponent("移動する資材と数量を1件以上入力してください。")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_center_transfer", {
    p_to_center_id: toCenterId,
    p_items: Array.from(items.entries()).map(([product_id, quantity]) => ({
      product_id,
      quantity,
    })),
    p_note: note || null,
  });

  if (error) {
    redirect(`/stock/transfers?error=${encodeURIComponent(mapTransferError(error.message))}`);
  }

  revalidatePath("/stock/transfers");
  revalidatePath("/stock");
  redirect("/stock/transfers?ok=created");
}
