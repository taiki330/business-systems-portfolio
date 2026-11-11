"use server";

import { getActorId } from "@/lib/auth/get-actor-id";
import {
  requireAdmin,
  requireAdminOrCenter,
  requireCenter,
} from "@/lib/auth/require-role";
import { mapMovementError } from "@/lib/stock/apply-movement";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const QUANTITY_ERROR_MESSAGES: Record<string, string> = {
  quantity_must_be_integer: "数量は整数で入力してください。",
  invalid_quantity: "数量は0より大きい数値を入力してください。",
  stock_request_not_found: "対象の依頼が見つかりません。",
  quantity_edit_not_allowed:
    "出庫済み・キャンセル済みの依頼は数量を修正できません。",
  permission_denied: "権限がありません。",
};

function mapQuantityError(message: string): string {
  for (const [code, text] of Object.entries(QUANTITY_ERROR_MESSAGES)) {
    if (message.includes(code)) return text;
  }
  return message;
}

function mapOrderShipmentError(message: string): string {
  if (message.includes("order_already_shipped")) {
    return "このオーダーは既に出庫済みです。";
  }
  if (message.includes("order_contains_unshippable_items")) {
    return "出庫済みまたはキャンセル済みの明細が含まれるため、出庫できません。";
  }
  if (message.includes("order_has_no_items")) {
    return "出庫する明細がありません。";
  }
  return mapMovementError(message);
}

/** センターがオーダーの全明細を一括で出庫確定する。 */
export async function completeOrderShipment(orderId: string) {
  await requireCenter();

  const supabase = await createClient();
  const actorId = await getActorId();
  const { error } = await supabase.rpc("ship_order_to_site", {
    p_order_id: orderId,
    p_shipped_by: actorId,
  });

  if (error) {
    redirect(
      `/orders/${orderId}?error=${encodeURIComponent(mapOrderShipmentError(error.message))}`,
    );
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/stock");
  revalidatePath("/stock/sites");
  revalidatePath("/stock/ledger");
  redirect(`/orders/${orderId}?ok=shipped`);
}

/**
 * 確定数量の修正（E-REQ-02）。requested/accepted の間だけ事務が修正できる。
 * DB 側の RPC（update_stock_request_quantity）が status を再チェックする。
 */
export async function updateRequestQuantity(
  orderId: string,
  requestId: string,
  formData: FormData,
) {
  await requireAdmin();

  const quantity = Number(formData.get("quantity"));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    redirect(
      `/orders/${orderId}?error=${encodeURIComponent(
        "数量は0より大きい数値を入力してください。",
      )}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_stock_request_quantity", {
    p_request_id: requestId,
    p_quantity: quantity,
  });

  if (error) {
    redirect(
      `/orders/${orderId}?error=${encodeURIComponent(mapQuantityError(error.message))}`,
    );
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/requests");
  redirect(`/orders/${orderId}?ok=quantity_updated`);
}

/**
 * 現場がオーダー時に入力したヤード積込日を、事務・センターが訂正する。
 * D-20260806-08で入力主体は現場へ変更済み。
 * 空文字を送ると未設定に戻せる。
 */
export async function updateYardLoadingDate(
  orderId: string,
  formData: FormData,
) {
  await requireAdminOrCenter();

  const raw = String(formData.get("yard_loading_date") ?? "").trim();
  const value = raw === "" ? null : raw;

  if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    redirect(
      `/orders/${orderId}?error=${encodeURIComponent("日付の形式が正しくありません。")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_order_yard_loading_date", {
    p_order_id: orderId,
    p_yard_loading_date: value,
  });

  if (error) {
    redirect(
      `/orders/${orderId}?error=${encodeURIComponent(
        error.message.includes("order_not_found")
          ? "対象のオーダーが見つかりません。"
          : error.message.includes("permission_denied")
            ? "権限がありません。"
            : error.message,
      )}`,
    );
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  redirect(`/orders/${orderId}?ok=yard_date_updated`);
}

const ADD_ITEM_ERROR_MESSAGES: Record<string, string> = {
  quantity_must_be_integer: "数量は整数で入力してください。",
  invalid_quantity: "数量は0より大きい数値を入力してください。",
  invalid_product_id: "資材が正しく選択されていません。",
  order_not_found: "対象のオーダーが見つかりません。",
  operation_id_required: "画面を再読み込みして、もう一度お試しください。",
  operation_id_conflict: "操作情報が一致しません。画面を再読み込みしてください。",
  permission_denied: "権限がありません。",
};

function mapAddItemError(message: string): string {
  for (const [code, text] of Object.entries(ADD_ITEM_ERROR_MESSAGES)) {
    if (message.includes(code)) return text;
  }
  return message;
}

/**
 * 既存オーダーに明細を追加する（D-20260805-03 ⑤(b)）。
 *
 * センターが印刷済みの資材発注書に手書きで追加した分を、事務があとから
 * システムに反映するための機能。追加分も通常の依頼と同じ requested から始まる。
 */
export async function addOrderItem(orderId: string, formData: FormData) {
  await requireAdmin();

  const productId = String(formData.get("product_id") ?? "").trim();
  const quantity = Number(formData.get("quantity"));
  const operationId = String(formData.get("operation_id") ?? "").trim();

  if (!productId) {
    redirect(
      `/orders/${orderId}?error=${encodeURIComponent("資材を選択してください。")}`,
    );
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    redirect(
      `/orders/${orderId}?error=${encodeURIComponent(
        "数量は0より大きい数値を入力してください。",
      )}`,
    );
  }
  if (!operationId) {
    redirect(
      `/orders/${orderId}?error=${encodeURIComponent(
        "画面を再読み込みして、もう一度お試しください。",
      )}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_order_item", {
    p_order_id: orderId,
    p_product_id: productId,
    p_quantity: quantity,
    p_operation_id: operationId,
  });

  if (error) {
    redirect(
      `/orders/${orderId}?error=${encodeURIComponent(mapAddItemError(error.message))}`,
    );
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/requests");
  redirect(`/orders/${orderId}?ok=item_added`);
}

/**
 * 明細ごとの自社／リース区分を事務が上書きする（D-20260805-05）。
 *
 * 自動判定は「自社在庫に無くリース在庫にある商品」しか leased にできず、
 * 枠のように両方で持っている資材は判別できない。紙を見て判断した結果を
 * 事務がここで反映する。空文字を送ると自動判定に戻す。
 */
export async function setOrderItemOwnership(
  orderId: string,
  requestId: string,
  formData: FormData,
) {
  await requireAdmin();

  const raw = String(formData.get("ownership") ?? "").trim();
  if (raw !== "" && raw !== "owned" && raw !== "leased") {
    redirect(
      `/orders/${orderId}?error=${encodeURIComponent("区分の指定が不正です。")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_order_item_ownership", {
    p_request_id: requestId,
    p_ownership: raw === "" ? null : raw,
  });

  if (error) {
    redirect(
      `/orders/${orderId}?error=${encodeURIComponent(
        error.message.includes("stock_request_not_found")
          ? "対象の明細が見つかりません。"
          : error.message.includes("permission_denied")
            ? "区分を変更できるのは事務のみです。"
            : error.message,
      )}`,
    );
  }

  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}?ok=ownership_updated`);
}
