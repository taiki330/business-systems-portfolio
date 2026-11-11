"use server";

import { getActorId } from "@/lib/auth/get-actor-id";
import { jstDateTimeLocalToIso } from "@/lib/datetime/jst";
import {
  requireAuthenticatedUser,
  requireAdmin,
  requireRequestCreator,
  requireVendorOwnedRequest,
} from "@/lib/auth/require-role";
import { mapMovementError } from "@/lib/stock/apply-movement";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function revalidateRequestPaths(id: string) {
  revalidatePath("/requests");
  revalidatePath(`/requests/${id}`);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapOrderCreateError(message: string): string {
  if (message.includes("quantity_must_be_integer")) {
    return "数量は整数で入力してください。";
  }
  if (message.includes("invalid_order_items")) {
    return "依頼する資材と数量を1件以上入力してください。";
  }
  if (message.includes("invalid_quantity")) {
    return "数量は0より大きい数値を入力してください。";
  }
  if (message.includes("invalid_product_id")) {
    return "選択した資材が見つかりません。画面を再読み込みしてもう一度入力してください。";
  }
  if (message.includes("operation_id_required")) {
    return "画面を再読み込みして、もう一度お試しください。";
  }
  if (message.includes("operation_id_conflict")) {
    return "別の発注と送信情報が重複しました。画面を再読み込みして内容を確認してください。";
  }
  if (message.includes("permission_denied")) {
    return "この現場への依頼権限がありません。アカウント設定を確認してください。";
  }
  return mapMovementError(message);
}

/**
 * 出庫依頼を複数商品まとめて登録する（P1-E Phase E-1。オーダー＝出庫依頼）。
 *
 * - vendor はアカウントに紐づく現場から対象を選ぶ。Server Action とDBの両方で
 *   app_user_sites の割り当てを検証する。
 * - フォームの入力は2系統:
 *     ① 予定数量ベースの一覧（name="plan_quantity_<productId>"）
 *     ② その他検索で追加した行（name="extra_product_id" / "extra_quantity" の対）
 *   数量が入っている行だけを stock_requests として作成し、まとめて1つの
 *   orders 行（グルーピングヘッダ）に紐付ける。
 * - stock_requests 自体のライフサイクル（requested→accepted→shipped/cancelled）は
 *   1行ずつ既存どおり（docs/09 を壊さない）。
 */
export async function createOrder(formData: FormData) {
  const creator = await requireRequestCreator();
  const operationId = String(formData.get("operation_id") ?? "").trim();
  if (!UUID_PATTERN.test(operationId)) {
    redirect(
      `/requests/new?error=${encodeURIComponent(
        "画面を再読み込みして、もう一度お試しください。",
      )}`,
    );
  }

  let siteId: string;
  if (creator.role === "vendor") {
    const assignedSiteIds = creator.site_ids?.length
      ? creator.site_ids
      : (creator.site_id ? [creator.site_id] : []);
    siteId = String(formData.get("site_id") ?? creator.site_id ?? "").trim();
    if (!siteId || !assignedSiteIds.includes(siteId)) {
      redirect(
        `/requests/new?error=${encodeURIComponent(
          "選択した現場は、このアカウントに紐付いていません。",
        )}`,
      );
    }
  } else {
    // internal はレガシー経路。現場選択の UI は出さないため formData から受け取る想定はないが、
    // 直接呼び出された場合に備えて明示エラーにする。
    siteId = String(formData.get("site_id") ?? "").trim();
    if (!siteId) {
      redirect(`/requests/new?error=${encodeURIComponent("現場を選択してください。")}`);
    }
  }

  const items = new Map<string, number>();

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("plan_quantity_")) continue;
    const productId = key.slice("plan_quantity_".length);
    const qty = Number(value);
    if (UUID_PATTERN.test(productId) && Number.isFinite(qty) && qty > 0) {
      items.set(productId, qty);
    }
  }

  const extraIds = formData.getAll("extra_product_id").map(String);
  const extraQtys = formData.getAll("extra_quantity").map(String);
  extraIds.forEach((productId, i) => {
    if (!UUID_PATTERN.test(productId)) return;
    const qty = Number(extraQtys[i]);
    if (Number.isFinite(qty) && qty > 0) {
      items.set(productId, (items.get(productId) ?? 0) + qty);
    }
  });

  if (items.size === 0) {
    redirect(
      `/requests/new?error=${encodeURIComponent("数量を1件以上入力してください。")}`,
    );
  }

  // 納期（D-20260805-01 #1）は必須。datetime-local は "YYYY-MM-DDTHH:mm" 形式で届く。
  const deadlineRaw = String(formData.get("delivery_deadline") ?? "").trim();
  let deliveryDeadline: string | null = null;
  if (!deadlineRaw) {
    redirect(
      `/requests/new?error=${encodeURIComponent("納期を入力してください。")}`,
    );
  }
  const parsed = jstDateTimeLocalToIso(deadlineRaw);
  if (!parsed) {
    redirect(
      `/requests/new?error=${encodeURIComponent("納期の形式が正しくありません。")}`,
    );
  }
  deliveryDeadline = parsed;

  // ヤード積み込み日（D-20260806-08）は職人が必須で入力する。<input type="date"> は
  // "YYYY-MM-DD" 形式で届く。
  const yardLoadingDate = String(formData.get("yard_loading_date") ?? "").trim();
  if (!yardLoadingDate) {
    redirect(
      `/requests/new?error=${encodeURIComponent("ヤード積み込み日を入力してください。")}`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yardLoadingDate)) {
    redirect(
      `/requests/new?error=${encodeURIComponent("ヤード積み込み日の形式が正しくありません。")}`,
    );
  }

  const supabase = await createClient();
  // orders と stock_requests を別々に INSERT すると、明細の登録失敗時に
  // 空のオーダーだけが残る。RPC 内で一括登録し、失敗時は全てロールバックする。
  const { error } = await supabase.rpc(
    "create_order_with_requests",
    {
      p_site_id: siteId,
      p_items: Array.from(items.entries()).map(([product_id, quantity]) => ({
        product_id,
        quantity,
      })),
      p_delivery_deadline: deliveryDeadline,
      p_yard_loading_date: yardLoadingDate,
      p_operation_id: operationId,
    },
  );

  if (error) {
    redirect(
      `/requests/new?error=${encodeURIComponent(mapOrderCreateError(error.message))}`,
    );
  }

  revalidatePath("/requests");
  redirect("/requests");
}

/**
 * 受付（requested -> accepted）
 * docs/09 §2 / §6 に基づく。requested 以外からの遷移は受け付けない。
 */
export async function acceptRequest(id: string) {
  await requireAdmin();

  if (!id) {
    redirect(`/requests?error=${encodeURIComponent("依頼 ID が不正です。")}`);
  }

  const supabase = await createClient();
  const actorId = await getActorId();
  const { data, error } = await supabase
    .from("stock_requests")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_by: actorId,
    })
    .eq("id", id)
    .eq("status", "requested")
    .select("id");

  if (error) {
    redirect(
      `/requests/${id}?error=${encodeURIComponent(error.message)}`,
    );
  }

  if (!data || data.length === 0) {
    redirect(
      `/requests/${id}?error=${encodeURIComponent(
        "受付できませんでした。既に受付済み・出庫済み・キャンセル済みの可能性があります。",
      )}`,
    );
  }

  revalidateRequestPaths(id);
  redirect(`/requests/${id}?ok=accepted`);
}

/**
 * キャンセル（requested or accepted -> cancelled）
 * docs/09 §2: shipped 後のキャンセル不可。
 */
export async function cancelRequest(id: string) {
  if (!id) {
    redirect(`/requests?error=${encodeURIComponent("依頼 ID が不正です。")}`);
  }

  const user = await requireAuthenticatedUser();

  if (user.role === "vendor") {
    await requireVendorOwnedRequest(id, { allowedStatuses: ["requested"] });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("stock_requests")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "requested")
      .select("id");

    if (error) {
      redirect(
        `/requests/${id}?error=${encodeURIComponent(error.message)}`,
      );
    }

    if (!data || data.length === 0) {
      redirect(
        `/requests/${id}?error=${encodeURIComponent(
          "キャンセルできませんでした。既に出庫済み・キャンセル済みの可能性があります。",
        )}`,
      );
    }

    revalidateRequestPaths(id);
    redirect(`/requests/${id}?ok=cancelled`);
  }

  // 現場以外のキャンセル操作は事務のみ。
  await requireAdmin();

  const supabase = await createClient();

  const { data: before, error: selErr } = await supabase
    .from("stock_requests")
    .select("status")
    .eq("id", id)
    .in("status", ["requested", "accepted"])
    .maybeSingle();

  if (selErr) {
    redirect(
      `/requests/${id}?error=${encodeURIComponent(selErr.message)}`,
    );
  }

  if (!before) {
    redirect(
      `/requests/${id}?error=${encodeURIComponent(
        "キャンセルできませんでした。既に出庫済み・キャンセル済みの可能性があります。",
      )}`,
    );
  }

  // 注意: A-3 では cancelled_by を更新しない（現行 DB 未実装。docs/13 §8-1 注記参照）。
  const { data, error } = await supabase
    .from("stock_requests")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["requested", "accepted"])
    .select("id");

  if (error) {
    redirect(
      `/requests/${id}?error=${encodeURIComponent(error.message)}`,
    );
  }

  if (!data || data.length === 0) {
    redirect(
      `/requests/${id}?error=${encodeURIComponent(
        "キャンセルできませんでした。既に出庫済み・キャンセル済みの可能性があります。",
      )}`,
    );
  }

  revalidateRequestPaths(id);
  redirect(`/requests/${id}?ok=cancelled`);
}

/**
 * 出庫確定（accepted -> shipped）
 *
 * docs/09 §2 / §6 / §7 に基づく。
 *
 * 重要ルール:
 * - 在庫更新経路は public.ship_stock_request RPC のみ。
 *   Server Action から stock_items / stock_ledger / stock_requests を
 *   直接 UPDATE/INSERT してはならない（partial update 防止）。
 * - RPC 側で 1 トランザクション内に
 *     stock_requests を FOR UPDATE → status guard
 *     → apply_stock_movement('out') → stock_requests を shipped 更新
 *   を実行し、いずれか失敗時は全てロールバックされる。
 * - ここでの事前 SELECT は UX 用の早期ガード。
 *   最終的な競合制御は RPC 内の FOR UPDATE に委ねる。
 */
export async function shipRequest(id: string) {
  await requireAdmin();

  if (!id) {
    redirect(`/requests?error=${encodeURIComponent("依頼 ID が不正です。")}`);
  }

  const supabase = await createClient();

  // 早期ガード（UX 用）。最終判定は RPC の FOR UPDATE で行う。
  const { data: cur, error: selErr } = await supabase
    .from("stock_requests")
    .select("status, quantity")
    .eq("id", id)
    .maybeSingle();

  if (selErr) {
    redirect(
      `/requests/${id}?error=${encodeURIComponent(selErr.message)}`,
    );
  }

  if (!cur) {
    redirect(
      `/requests?error=${encodeURIComponent("依頼が見つかりません。")}`,
    );
  }

  if (cur.status !== "accepted") {
    redirect(
      `/requests/${id}?error=${encodeURIComponent(
        "受付済み（accepted）の依頼のみ出庫できます。",
      )}`,
    );
  }

  // 在庫減算 + ステータス更新を 1 トランザクションで実行。
  // 失敗時（insufficient_stock 等）は RPC 側で全てロールバックされる。
  // p_shipped_by は RPC 内で stock_requests.shipped_by に保存される（005 §④）。
  const actorId = await getActorId();
  const { error: rpcError } = await supabase.rpc(
    "ship_stock_request",
    {
      p_request_id: id,
      p_shipped_by: actorId,
    },
  );

  if (rpcError) {
    redirect(
      `/requests/${id}?error=${encodeURIComponent(
        mapMovementError(rpcError.message),
      )}`,
    );
  }

  // 在庫スナップショット・履歴・依頼ステータスの全てが変化するため
  // 関連パスを広めに revalidate。
  revalidateRequestPaths(id);
  revalidatePath("/stock");
  revalidatePath("/stock/ledger");

  redirect(`/requests/${id}?ok=shipped`);
}
