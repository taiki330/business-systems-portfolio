"use server";

import { requireAdmin, requireAuthenticatedUser } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const LIST_PATH = "/stock/adjustments";
const NEW_PATH = "/stock/adjustments/new";

function withParam(base: string, key: string, value: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${key}=${encodeURIComponent(value)}`;
}

/** RPC のエラーコードを画面向けの日本語に変換する。 */
function mapAdjustmentError(message: string): string {
  if (message.includes("quantity_must_be_integer")) {
    return "数量は整数で入力してください。";
  }
  if (message.includes("no_adjustment_needed")) {
    return "システム上の数量と一致しているため、調整の必要がありません。";
  }
  if (message.includes("pending_request_exists")) {
    return "この在庫にはすでに未処理の申請があります。先にそちらを処理してください。";
  }
  if (message.includes("adjustment_request_not_found")) {
    return "対象の申請が見つかりません。";
  }
  if (message.includes("adjustment_request_already_decided")) {
    return "この申請はすでに処理済みです。";
  }
  if (message.includes("self_approval_not_allowed")) {
    return "自分が出した申請は承認できません。他の担当者が承認してください。";
  }
  if (message.includes("resulting_quantity_negative")) {
    return "承認すると在庫がマイナスになるため実行できません。申請し直してください。";
  }
  if (message.includes("quantity_must_be_non_negative")) {
    return "数量は0以上で入力してください。";
  }
  if (message.includes("permission_denied")) {
    return "この操作を行う権限がありません。";
  }
  return `処理に失敗しました: ${message}`;
}

/**
 * 在庫調整を申請する（center / vendor）。
 *
 * 重要ルール:
 * - この時点では在庫を変更しない。実際の増減は承認時のみ。
 * - 権限判定は RPC 側（center は全在庫 / vendor は担当現場のみ）でも二重に行う。
 */
export async function requestStockAdjustment(formData: FormData) {
  await requireAuthenticatedUser();

  const productId = String(formData.get("product_id") ?? "").trim();
  // "center" または site の UUID
  const locationValue = String(formData.get("location_value") ?? "").trim();
  const counted = Number(formData.get("counted_quantity"));
  const note = String(formData.get("note") ?? "").trim();

  if (!productId || !locationValue) {
    redirect(withParam(NEW_PATH, "error", "商品と保管場所を選択してください。"));
  }
  if (!Number.isFinite(counted) || counted < 0) {
    redirect(withParam(NEW_PATH, "error", "数量は0以上の数値を入力してください。"));
  }

  const isCenter = locationValue === "center";
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_stock_adjustment", {
    p_product_id: productId,
    p_storage_kind: isCenter ? "center" : "site",
    p_site_id: isCenter ? null : locationValue,
    p_counted_quantity: counted,
    p_note: note || null,
  });

  if (error) {
    redirect(withParam(NEW_PATH, "error", mapAdjustmentError(error.message)));
  }

  revalidatePath(LIST_PATH);
  redirect(withParam(LIST_PATH, "ok", "requested"));
}

/** 申請を承認し、差分を在庫へ適用する（事務のみ）。 */
export async function approveStockAdjustment(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  const note = String(formData.get("decided_note") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const backTo = status ? withParam(LIST_PATH, "status", status) : LIST_PATH;

  if (!id) redirect(withParam(backTo, "error", "対象が指定されていません。"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_stock_adjustment", {
    p_id: id,
    p_note: note || null,
  });

  if (error) {
    redirect(withParam(backTo, "error", mapAdjustmentError(error.message)));
  }

  revalidatePath(LIST_PATH);
  revalidatePath("/stock");
  revalidatePath("/stock/sites");
  redirect(withParam(backTo, "ok", "approved"));
}

/** 申請を却下する（事務のみ・在庫は変更しない）。 */
export async function rejectStockAdjustment(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  const note = String(formData.get("decided_note") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const backTo = status ? withParam(LIST_PATH, "status", status) : LIST_PATH;

  if (!id) redirect(withParam(backTo, "error", "対象が指定されていません。"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_stock_adjustment", {
    p_id: id,
    p_note: note || null,
  });

  if (error) {
    redirect(withParam(backTo, "error", mapAdjustmentError(error.message)));
  }

  revalidatePath(LIST_PATH);
  redirect(withParam(backTo, "ok", "rejected"));
}
