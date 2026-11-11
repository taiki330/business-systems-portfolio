"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const LIST_PATH = "/purchases";
const NEW_PATH = "/purchases/new";

function backToNew(message: string): never {
  redirect(`${NEW_PATH}?error=${encodeURIComponent(message)}`);
}

/** RPC のエラーコードを画面向けの日本語に変換する。 */
function mapPurchaseError(message: string): string {
  if (message.includes("quantity_must_be_integer")) {
    return "数量は整数で入力してください。";
  }
  if (message.includes("quantity_must_be_positive")) {
    return "数量は 0 より大きい数値を入力してください。";
  }
  if (message.includes("purchase_date_required")) {
    return "購入日を入力してください。";
  }
  if (message.includes("future_date_not_allowed")) {
    return "未来の日付は登録できません。";
  }
  if (message.includes("supplier_not_found")) {
    return "対象の仕入先が見つかりません。";
  }
  if (message.includes("permission_denied")) {
    return "仕入れを登録する権限がありません（事務のみ）。";
  }
  return `登録に失敗しました: ${message}`;
}

/**
 * 仕入れ（購入）を登録する（事務のみ）。
 *
 * 重要ルール:
 * - 在庫更新経路は public.register_stock_purchase RPC のみ。
 *   Server Action から stock_items / stock_ledger / stock_purchases を直接更新してはならない。
 * - RPC 側で 1 トランザクション内にセンター在庫の加算・台帳記録（reason='purchase'）・
 *   購入記録・操作履歴を実行する。
 */
export async function registerPurchase(formData: FormData) {
  await requireAdmin();

  const productId = String(formData.get("product_id") ?? "").trim();
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  const quantity = Number(formData.get("quantity"));
  const purchaseDate = String(formData.get("purchase_date") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!productId) backToNew("資材を選択してください。");
  if (!supplierId) backToNew("仕入先を選択してください。");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    backToNew("数量は 0 より大きい数値を入力してください。");
  }
  if (!purchaseDate) backToNew("購入日を入力してください。");

  const supabase = await createClient();
  const { error } = await supabase.rpc("register_stock_purchase", {
    p_product_id: productId,
    p_supplier_id: supplierId,
    p_quantity: quantity,
    p_purchase_date: purchaseDate,
    p_note: note || null,
  });

  if (error) backToNew(mapPurchaseError(error.message));

  revalidatePath(LIST_PATH);
  revalidatePath("/stock");
  redirect(`${LIST_PATH}?ok=registered`);
}
