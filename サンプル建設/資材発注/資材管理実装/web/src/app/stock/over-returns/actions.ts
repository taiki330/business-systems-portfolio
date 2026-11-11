"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/** RPC のエラーコードを画面向けの日本語に変換する。 */
function mapConfirmError(message: string): string {
  if (message.includes("over_return_not_found")) {
    return "対象の過入庫が見つかりません。";
  }
  if (message.includes("over_return_already_confirmed")) {
    return "この過入庫はすでに確認済みです。";
  }
  if (message.includes("permission_denied")) {
    return "確認する権限がありません（事務のみ）。";
  }
  return `確認に失敗しました: ${message}`;
}

/**
 * 過入庫を確認済みにする（事務のみ）。
 *
 * 重要ルール:
 * - 在庫数は一切変更しない。確認は「数え間違いを追跡し終えた」という記録のみ。
 * - 状態更新は public.confirm_over_return RPC のみを経由する。
 *   over_returns への直接 UPDATE は権限ごと剥奪されている。
 * - 二重確認は RPC 内の FOR UPDATE + 状態チェックで拒否される。
 */
export async function confirmOverReturn(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  const backTo = status
    ? `/stock/over-returns?status=${encodeURIComponent(status)}`
    : "/stock/over-returns";

  if (!id) {
    redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}error=${encodeURIComponent("対象が指定されていません。")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_over_return", {
    p_id: id,
    p_memo: memo || null,
  });

  if (error) {
    const sep = backTo.includes("?") ? "&" : "?";
    redirect(`${backTo}${sep}error=${encodeURIComponent(mapConfirmError(error.message))}`);
  }

  revalidatePath("/stock/over-returns");
  redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}ok=confirmed`);
}
