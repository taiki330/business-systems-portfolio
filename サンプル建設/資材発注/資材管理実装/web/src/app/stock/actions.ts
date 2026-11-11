"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { redirect } from "next/navigation";

const DIRECT_STOCK_CHANGE_DISABLED =
  "直接の在庫変更は廃止しました。仕入れ、出庫完了、返却登録、センター間移動、棚卸、または在庫調整申請を利用してください。";

/**
 * 旧URL・古い画面からの送信を安全に拒否するために残している。
 * 在庫数量は必ず業務記録に紐づく処理からだけ変更する。
 */
export async function createStockItem(_formData: FormData) {
  await requireAdmin();
  void _formData;
  redirect(`/stock?error=${encodeURIComponent(DIRECT_STOCK_CHANGE_DISABLED)}`);
}

/** @see createStockItem */
export async function updateStockItem(_id: string, _formData: FormData) {
  await requireAdmin();
  void _id;
  void _formData;
  redirect(`/stock?error=${encodeURIComponent(DIRECT_STOCK_CHANGE_DISABLED)}`);
}
