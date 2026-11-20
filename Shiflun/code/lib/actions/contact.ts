"use server";

import { getAuth } from "@/lib/auth/session";
import { CONTACT_CATEGORIES } from "@/lib/constants/safety";

export type ContactState = { error?: string; success?: boolean };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * お問い合わせを保存する（migration 023 の submit_contact_inquiry）。ログインしていなくても送れる。
 * 運営の審査担当が /admin/inquiries で読み、返信はメールで行う。
 */
export async function submitContactInquiry(_prev: ContactState, form: FormData): Promise<ContactState> {
  // 人には見えない入力欄。自動投稿のプログラムが埋めた場合は、保存せずに受け付けたように見せる。
  if (String(form.get("website") ?? "")) return { success: true };

  const category = String(form.get("category") ?? "");
  const body = String(form.get("body") ?? "").trim();
  if (!CONTACT_CATEGORIES.some((c) => c.value === category)) return { error: "お問い合わせの種類を選んでください。" };
  if (!body || body.length > 2000) return { error: "お問い合わせの内容は1〜2000文字で入力してください。" };

  const { supabase, user } = await getAuth();
  if (!supabase) return { error: "デモ表示ではお問い合わせを送れません。" };
  // ログイン中は、ログインに使っているメールアドレスへ返信する。
  const email = (user?.email ?? String(form.get("email") ?? "")).trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { error: "返信先のメールアドレスを確認してください。" };

  const { error } = await supabase.rpc("submit_contact_inquiry", { p_email: email, p_category: category, p_body: body });
  if (error) return { error: /時間をおいて|メールアドレス/.test(error.message) ? error.message : "送信できませんでした。時間をおいてもう一度お試しください。" };
  return { success: true };
}
