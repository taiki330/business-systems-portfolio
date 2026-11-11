"use server";

import { getActorId } from "@/lib/auth/get-actor-id";
import { requireAdmin } from "@/lib/auth/require-role";
import { mapMovementError } from "@/lib/stock/apply-movement";
import { createClient } from "@/lib/supabase/server";
import type { StockReturnFormData } from "@/types/stock-return";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function parseFormData(formData: FormData): StockReturnFormData {
  return {
    product_id: String(formData.get("product_id") ?? "").trim(),
    site_id: String(formData.get("site_id") ?? "").trim(),
    quantity: Number(formData.get("quantity")),
    memo: String(formData.get("memo") ?? "").trim(),
  };
}

function newFormPath(data: Pick<StockReturnFormData, "product_id" | "site_id">): string {
  const params = new URLSearchParams();
  if (data.product_id) params.set("product_id", data.product_id);
  if (data.site_id) params.set("site_id", data.site_id);
  const qs = params.toString();
  return qs ? `/stock/returns/new?${qs}` : "/stock/returns/new";
}

function redirectWithError(
  data: Pick<StockReturnFormData, "product_id" | "site_id">,
  message: string,
): never {
  const base = newFormPath(data);
  const sep = base.includes("?") ? "&" : "?";
  redirect(`${base}${sep}error=${encodeURIComponent(message)}`);
}

/**
 * 返却（現場 → センター）。
 *
 * 重要ルール:
 * - 在庫更新経路は public.return_from_site RPC のみ。
 *   Server Action から stock_items / stock_ledger / stock_returns を
 *   直接 UPDATE/INSERT してはならない（shipRequest と同じ設計原則）。
 * - RPC 側で 1 トランザクション内に
 *     site 減算 → center 加算 → 両側のledger追記 → stock_returnsへledger ID保存
 *   を実行し、いずれか失敗時は全てロールバックされる。
 * - ここでのバリデーションは UX 用の早期ガード。
 *   最終的な数量チェック（現場在庫不足等）は RPC 内の FOR UPDATE に委ねる。
 */
export async function returnStockFromSite(formData: FormData) {
  await requireAdmin();

  const data = parseFormData(formData);

  if (!data.product_id || !data.site_id) {
    redirect(
      `/stock/sites?error=${encodeURIComponent("現場・商品の指定が不正です。")}`,
    );
  }

  if (Number.isNaN(data.quantity) || data.quantity <= 0) {
    redirectWithError(data, "数量は 0 より大きい数値を入力してください。");
  }

  const supabase = await createClient();
  const actorId = await getActorId();

  const { error } = await supabase.rpc("return_from_site", {
    p_product_id: data.product_id,
    p_site_id: data.site_id,
    p_quantity: data.quantity,
    p_memo: data.memo || null,
    p_returned_by: actorId,
  });

  if (error) {
    redirectWithError(data, mapMovementError(error.message));
  }

  revalidatePath("/stock/sites");
  revalidatePath("/stock");

  redirect("/stock/sites?ok=returned");
}

export async function returnMaterialsFromSite(formData: FormData) {
  await requireAdmin();
  const siteId = String(formData.get("site_id") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();
  let items: unknown;
  try { items = JSON.parse(String(formData.get("items") ?? "[]")); } catch { items = []; }
  if (!siteId || !Array.isArray(items) || items.length === 0) {
    redirect(`/stock/returns/new?site_id=${encodeURIComponent(siteId)}&error=${encodeURIComponent("返却する資材と数量を入力してください。")}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_materials_from_site", {
    p_site_id: siteId, p_items: items, p_memo: memo || null,
  });
  if (error) {
    redirect(`/stock/returns/new?site_id=${encodeURIComponent(siteId)}&error=${encodeURIComponent(mapMovementError(error.message))}`);
  }
  revalidatePath("/stock/returns");
  revalidatePath("/stock/sites");
  revalidatePath("/stock");
  redirect("/stock/returns?ok=returned");
}

export async function correctStockReturn(id: string, formData: FormData) {
  await requireAdmin();
  const quantity = Number(formData.get("quantity"));
  const memo = String(formData.get("memo") ?? "").trim();
  if (!id || !Number.isFinite(quantity) || quantity <= 0) {
    redirect(`/stock/returns/${id}/edit?error=${encodeURIComponent("数量は0より大きい数値を入力してください。")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_stock_return", {
    p_return_id: id,
    p_input_quantity: quantity,
    p_memo: memo || null,
  });
  if (error) {
    let message = mapMovementError(error.message);
    if (error.message.includes("stock_return_not_found")) message = "対象の返却履歴が見つかりません。";
    if (error.message.includes("return_ledger_not_found") || error.message.includes("return_ledger_not_linked")) message = "元の在庫履歴を安全に特定できないため修正できません。管理者に確認してください。";
    if (error.message.includes("insufficient_center_stock")) message = "返却を減らすためのセンター在庫が不足しています。後続の在庫移動を確認してください。";
    redirect(`/stock/returns/${id}/edit?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/stock/returns");
  revalidatePath("/stock/sites");
  revalidatePath("/stock");
  redirect("/stock/returns?ok=corrected");
}
