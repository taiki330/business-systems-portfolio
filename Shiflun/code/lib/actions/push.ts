"use server";

import { getAuth } from "@/lib/auth/session";

const TOKEN = /^[A-Za-z0-9_:\-.]{20,4096}$/;

/** この端末を、ログイン中の本人のプッシュ通知の宛先にする（migration 025）。 */
export async function registerPushToken(token: string, platform: "ios" | "android"): Promise<{ error: string | null }> {
  if (typeof token !== "string" || !TOKEN.test(token) || (platform !== "ios" && platform !== "android")) return { error: "通知の登録情報が不正です。" };
  const { supabase, user } = await getAuth();
  if (!supabase || !user) return { error: null };
  const { error } = await supabase.rpc("register_push_token", { p_token: token, p_platform: platform });
  return { error: error ? "通知の登録に失敗しました。" : null };
}

/** この端末を、ログイン中の本人の通知先から外す（ログアウトの直前に呼ぶ）。 */
export async function unregisterPushToken(token: string): Promise<void> {
  if (typeof token !== "string" || !TOKEN.test(token)) return;
  const { supabase, user } = await getAuth();
  if (!supabase || !user) return;
  await supabase.rpc("unregister_push_token", { p_token: token });
}
