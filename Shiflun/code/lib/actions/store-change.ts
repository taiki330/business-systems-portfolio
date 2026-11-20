"use server";

import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth/session";

export type ChangeStoreState = { error?: string; success?: boolean; storeName?: string };

const UUID = /^[0-9a-f-]{36}$/i;
/** DBが日本語で返す案内（「7日に1回までです」など）は、そのまま画面に出す。 */
const JAPANESE = /[ぁ-んァ-ヶ一-龥]/;

/**
 * 所属店舗を変える（migration 026 の change_my_store）。
 * 変えられるのはログイン中の本人だけ。7日に1回まで。変えると店長認証は外れ、旧店舗向けの勤務希望は取り消される。
 * 今の所属先で確定しているこれからの勤務があるときは変えられない。
 */
export async function changeMyStore(storeId: string): Promise<ChangeStoreState> {
  if (typeof storeId !== "string" || !UUID.test(storeId)) return { error: "店舗を選んでください。" };
  const { supabase, worker, error } = await requireWorker();
  if (!supabase) return { error };
  if (worker.current_store_id === storeId) return { error: "すでにこの店舗に所属しています。" };

  const { error: rpcError } = await supabase.rpc("change_my_store", { p_store_id: storeId });
  if (rpcError) return { error: JAPANESE.test(rpcError.message) ? rpcError.message : "所属店舗を変更できませんでした。時間をおいてお試しください。" };

  for (const path of ["/workers/mypage", "/workers/shifts", "/workers/chat", "/managers/staff", "/managers/shifts", "/companies"]) revalidatePath(path);
  return { success: true };
}
