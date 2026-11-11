"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { redirect } from "next/navigation";

export async function registerStockMovement(formData: FormData) {
  await requireAdmin();
  void formData;
  redirect(`/stock?error=${encodeURIComponent("理由なしの直接入出庫は廃止しました。出庫完了・返却登録・仕入れ・センター間移動・棚卸・在庫調整申請を利用してください。")}`);
}
