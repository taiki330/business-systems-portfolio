import { createClient } from "@/lib/supabase/server";
import type { MovementType } from "@/types/stock-ledger";

const ERROR_MESSAGES: Record<string, string> = {
  insufficient_stock: "在庫が足りません。出庫数量を減らすか、入庫してください。",
  quantity_must_be_positive: "数量は 0 より大きい数値を入力してください。",
  quantity_must_be_integer: "数量は整数で入力してください。",
  invalid_movement_type: "入出庫種別が不正です。",
  location_required: "保管場所を入力してください。",
  stock_item_not_found: "在庫行の取得に失敗しました。",
  // ship_stock_request RPC 由来
  stock_request_not_found: "依頼が見つかりません。",
  invalid_status_transition:
    "受付済み（accepted）の依頼のみ出庫できます。",
  // return_from_site RPC 由来
  site_stock_item_not_found: "対象の現場在庫が見つかりません。",
  insufficient_site_stock: "現場在庫が不足しています。返却数量を減らしてください。",
};

export function mapMovementError(message: string): string {
  for (const [code, text] of Object.entries(ERROR_MESSAGES)) {
    if (message.includes(code)) return text;
  }
  return message;
}

/**
 * 手動の入出庫登録（/stock/move）。
 *
 * RPC は apply_stock_movement ではなく record_stock_movement を呼ぶ。
 * apply_stock_movement は出庫確定・返却など他の RPC からも内部的に使われる共有部品のため、
 * そこで操作履歴を記録すると業務ログと二重になる。手動登録専用のラッパーを経由することで、
 * 在庫増減の操作履歴が「利用者の1操作＝1行」で残る（Phase 6-4）。
 */
export async function applyStockMovement(params: {
  productId: string;
  location: string;
  movementType: MovementType;
  quantity: number;
}): Promise<{ ledgerId: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_stock_movement", {
    p_product_id: params.productId,
    p_location: params.location,
    p_movement_type: params.movementType,
    p_quantity: params.quantity,
  });

  if (error) {
    return { ledgerId: null, error: mapMovementError(error.message) };
  }

  return { ledgerId: data as string, error: null };
}
