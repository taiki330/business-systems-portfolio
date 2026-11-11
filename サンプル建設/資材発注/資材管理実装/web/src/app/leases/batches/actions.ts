"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { mapLeaseError } from "@/lib/leases/lease-errors";
import { createClient } from "@/lib/supabase/server";
import type { LeaseDeliveryKind } from "@/types/lease";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * リース借用の登録・承認・受入・移動・返却。
 *
 * 重要ルール:
 * - 在庫更新（受入 / 出庫 / 返却）および借用ヘッダー・明細の作成の経路は
 *   すべて 032 の SECURITY DEFINER RPC のみ。lease_batches への直接 INSERT policy は
 *   存在せず、lease_batch_items / lease_stock_items / lease_stock_ledger も
 *   承認後は直接 UPDATE できない（RLS）。Server Action は RPC を呼ぶだけで、
 *   複数テーブルへの分割書込・補償処理（後始末の削除等）は一切行わない。
 * - 借用ヘッダー・明細の作成は admin のみ。承認前（draft）は受入できない。
 * - 受入・出庫・返却は center のみ。
 * - 二重送信対策（コードレビュー指摘 Critical #8）: 各フォームは非表示フィールド
 *   operation_id（サーバーコンポーネントの描画時に生成した UUID）を持ち、
 *   ここでそれを RPC の p_operation_id に渡す。RPC 側は p_operation_id を必須引数として
 *   要求するため、本ファイルでも欠落時は RPC を呼ばずに早期エラーとする。
 *   同一 operation_id・同一操作者・同一対象での再送は RPC 側で二重処理されず、
 *   最初の結果に対して冪等に振る舞う。operation_id が別操作・別ユーザー・別対象で
 *   使い回された場合は RPC が operation_id_conflict を返す。
 * - ここでのバリデーションは UX 用の早期ガード。最終判定は RPC 内の FOR UPDATE に委ねる。
 */

type ParsedItem = {
  product_id: string;
  quantity: number;
  return_due_date: string | null;
};

function parseItems(formData: FormData): ParsedItem[] {
  const productIds = formData.getAll("item_product_id").map(String);
  const quantities = formData.getAll("item_quantity").map(String);
  const dueDates = formData.getAll("item_return_due_date").map(String);

  const items: ParsedItem[] = [];

  for (let i = 0; i < productIds.length; i += 1) {
    const productId = productIds[i]?.trim() ?? "";
    const quantityRaw = quantities[i]?.trim() ?? "";

    // 空行はスキップ（フォームは固定行数を送るため）
    if (!productId && !quantityRaw) continue;

    items.push({
      product_id: productId,
      quantity: Number(quantityRaw),
      return_due_date: dueDates[i]?.trim() || null,
    });
  }

  return items;
}

function newBatchError(message: string): never {
  redirect(`/leases/batches/new?error=${encodeURIComponent(message)}`);
}

function batchError(batchId: string, message: string): never {
  redirect(`/leases/batches/${batchId}?error=${encodeURIComponent(message)}`);
}

const OPERATION_ID_MISSING_MESSAGE =
  "画面の再読み込み後にもう一度お試しください。";

/** RPC が p_operation_id を必須とするため、欠落時は RPC を呼ばずに早期エラーとする。 */
function requireOperationIdForNewBatch(formData: FormData): string {
  const value = String(formData.get("operation_id") ?? "").trim();
  if (!value) newBatchError(OPERATION_ID_MISSING_MESSAGE);
  return value;
}

function requireOperationId(formData: FormData, batchId: string): string {
  const value = String(formData.get("operation_id") ?? "").trim();
  if (!value) batchError(batchId, OPERATION_ID_MISSING_MESSAGE);
  return value;
}

// ===========================================================================
// 借用登録（admin）: ヘッダー＋明細を単一 RPC（create_lease_batch）で作成
// ===========================================================================
export async function createLeaseBatch(formData: FormData) {
  await requireAdmin();

  const leaseCompanyId = String(formData.get("lease_company_id") ?? "").trim();
  const slipNumber = String(formData.get("slip_number") ?? "").trim();
  const borrowedAt = String(formData.get("borrowed_at") ?? "").trim();
  const deliveryKind = String(
    formData.get("delivery_kind") ?? "center",
  ).trim() as LeaseDeliveryKind;
  const deliverySiteId = String(formData.get("delivery_site_id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const operationId = requireOperationIdForNewBatch(formData);

  if (!leaseCompanyId) newBatchError("リース会社を選択してください。");
  if (!borrowedAt) newBatchError("借用日を入力してください。");
  if (deliveryKind !== "center" && deliveryKind !== "site") {
    newBatchError("納品先の指定が不正です。");
  }
  if (deliveryKind === "site" && !deliverySiteId) {
    newBatchError("現場直送の場合は納品先の現場を選択してください。");
  }

  const items = parseItems(formData);
  if (items.length === 0) {
    newBatchError("明細を1件以上入力してください。");
  }
  for (const item of items) {
    if (!item.product_id) newBatchError("明細の商品を選択してください。");
    if (Number.isNaN(item.quantity) || item.quantity <= 0) {
      newBatchError("明細の借用数量は 0 より大きい数値を入力してください。");
    }
  }

  const supabase = await createClient();
  const { data: batchId, error } = await supabase.rpc("create_lease_batch", {
    p_lease_company_id: leaseCompanyId,
    p_slip_number: slipNumber || null,
    p_borrowed_at: borrowedAt,
    p_delivery_kind: deliveryKind,
    p_delivery_site_id: deliveryKind === "site" ? deliverySiteId : null,
    p_note: note || null,
    p_items: items,
    p_operation_id: operationId,
  });

  if (error || !batchId) {
    newBatchError(
      error ? mapLeaseError(error.message) : "借用の登録に失敗しました。",
    );
  }

  revalidatePath("/leases/batches");
  redirect(`/leases/batches/${batchId}?ok=created`);
}

// ===========================================================================
// 承認 / キャンセル（admin）
// ===========================================================================
export async function approveLeaseBatch(batchId: string, formData: FormData) {
  await requireAdmin();

  const operationId = requireOperationId(formData, batchId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_lease_batch", {
    p_batch_id: batchId,
    p_operation_id: operationId,
  });

  if (error) {
    batchError(batchId, mapLeaseError(error.message));
  }

  revalidatePath("/leases/batches");
  revalidatePath(`/leases/batches/${batchId}`);
  redirect(`/leases/batches/${batchId}?ok=approved`);
}

export async function cancelLeaseBatch(batchId: string, formData: FormData) {
  await requireAdmin();

  const operationId = requireOperationId(formData, batchId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_lease_batch", {
    p_batch_id: batchId,
    p_operation_id: operationId,
  });

  if (error) {
    batchError(batchId, mapLeaseError(error.message));
  }

  revalidatePath("/leases/batches");
  revalidatePath(`/leases/batches/${batchId}`);
  redirect(`/leases/batches/${batchId}?ok=cancelled`);
}

// ===========================================================================
// 受入確定（center）
// ===========================================================================
export async function receiveLeaseBatchItem(
  batchId: string,
  formData: FormData,
) {
  await requireAdmin();

  const itemId = String(formData.get("item_id") ?? "").trim();
  const quantity = Number(formData.get("quantity"));

  if (!itemId) batchError(batchId, "明細の指定が不正です。");
  if (Number.isNaN(quantity) || quantity <= 0) {
    batchError(batchId, "受入数量は 0 より大きい数値を入力してください。");
  }

  const operationId = requireOperationId(formData, batchId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_lease_batch_item", {
    p_item_id: itemId,
    p_quantity: quantity,
    p_operation_id: operationId,
  });

  if (error) {
    batchError(batchId, mapLeaseError(error.message));
  }

  revalidatePath("/leases/batches");
  revalidatePath(`/leases/batches/${batchId}`);
  revalidatePath("/leases/stock");
  redirect(`/leases/batches/${batchId}?ok=received`);
}

// ===========================================================================
// 未受入のまま受入を終了する（center）。欠品・納品打ち切り等。理由必須。
// ===========================================================================
export async function closeLeaseBatchItemReceiving(
  batchId: string,
  formData: FormData,
) {
  await requireAdmin();

  const itemId = String(formData.get("item_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!itemId) batchError(batchId, "明細の指定が不正です。");
  if (!reason) batchError(batchId, "受入終了の理由を入力してください。");

  const operationId = requireOperationId(formData, batchId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_lease_batch_item_receiving", {
    p_item_id: itemId,
    p_reason: reason,
    p_operation_id: operationId,
  });

  if (error) {
    batchError(batchId, mapLeaseError(error.message));
  }

  revalidatePath("/leases/batches");
  revalidatePath(`/leases/batches/${batchId}`);
  redirect(`/leases/batches/${batchId}?ok=receiving_closed`);
}

// ===========================================================================
// センター → 現場 出庫（center）
// ===========================================================================
export async function shipLeaseStockToSite(
  batchId: string,
  formData: FormData,
) {
  await requireAdmin();

  const itemId = String(formData.get("item_id") ?? "").trim();
  const siteId = String(formData.get("site_id") ?? "").trim();
  const quantity = Number(formData.get("quantity"));

  if (!itemId) batchError(batchId, "明細の指定が不正です。");
  if (!siteId) batchError(batchId, "出庫先の現場を選択してください。");
  if (Number.isNaN(quantity) || quantity <= 0) {
    batchError(batchId, "出庫数量は 0 より大きい数値を入力してください。");
  }

  const operationId = requireOperationId(formData, batchId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("ship_lease_stock_to_site", {
    p_item_id: itemId,
    p_site_id: siteId,
    p_quantity: quantity,
    p_operation_id: operationId,
  });

  if (error) {
    batchError(batchId, mapLeaseError(error.message));
  }

  revalidatePath(`/leases/batches/${batchId}`);
  revalidatePath("/leases/stock");
  redirect(`/leases/batches/${batchId}?ok=shipped`);
}

// ===========================================================================
// 現場 → センター 返却（center）
// ===========================================================================
export async function returnLeaseStockFromSite(
  batchId: string,
  formData: FormData,
) {
  await requireAdmin();

  const itemId = String(formData.get("item_id") ?? "").trim();
  const siteId = String(formData.get("site_id") ?? "").trim();
  const quantity = Number(formData.get("quantity"));

  if (!itemId) batchError(batchId, "明細の指定が不正です。");
  if (!siteId) batchError(batchId, "返却元の現場を選択してください。");
  if (Number.isNaN(quantity) || quantity <= 0) {
    batchError(batchId, "返却数量は 0 より大きい数値を入力してください。");
  }

  const operationId = requireOperationId(formData, batchId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_lease_stock_from_site", {
    p_item_id: itemId,
    p_site_id: siteId,
    p_quantity: quantity,
    p_operation_id: operationId,
  });

  if (error) {
    batchError(batchId, mapLeaseError(error.message));
  }

  revalidatePath(`/leases/batches/${batchId}`);
  revalidatePath("/leases/stock");
  redirect(`/leases/batches/${batchId}?ok=returned_from_site`);
}

// ===========================================================================
// リース会社へ返却（center）。一部返却に対応。
// ===========================================================================
export async function returnLeaseToCompany(
  batchId: string,
  formData: FormData,
) {
  await requireAdmin();

  const itemId = String(formData.get("item_id") ?? "").trim();
  const quantity = Number(formData.get("quantity"));

  if (!itemId) batchError(batchId, "明細の指定が不正です。");
  if (Number.isNaN(quantity) || quantity <= 0) {
    batchError(batchId, "返却数量は 0 より大きい数値を入力してください。");
  }

  const operationId = requireOperationId(formData, batchId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_lease_to_company", {
    p_item_id: itemId,
    p_quantity: quantity,
    p_operation_id: operationId,
  });

  if (error) {
    batchError(batchId, mapLeaseError(error.message));
  }

  revalidatePath("/leases/batches");
  revalidatePath(`/leases/batches/${batchId}`);
  revalidatePath("/leases/stock");
  revalidatePath("/leases/due");
  redirect(`/leases/batches/${batchId}?ok=returned_to_company`);
}
