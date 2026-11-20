"use server";

import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/utils/safe-next";

export type AuthFormState = { error?: string; message?: string; step?: "code" | "done"; email?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^\d{6,10}$/;
const MIN_PASSWORD_LENGTH = 8;

function readEmail(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  return EMAIL.test(email) && email.length <= 254 ? email : null;
}

function readCode(form: FormData) {
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  return CODE.test(code) ? code : null;
}

/** Supabase のエラーを、利用者向けの文に置き換える（アカウントの有無などを推測されない書き方にする）。 */
function friendly(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  if (/rate limit|too many|security purposes/i.test(message)) return "短い時間に何度も送信されました。少し時間をおいてからお試しください。";
  if (/banned/i.test(message)) return "このアカウントは現在ご利用いただけません。心当たりがない場合は、お問い合わせからご連絡ください。";
  if (/expired|invalid.*(otp|token)|token.*(invalid|expired)/i.test(message)) return "確認コードが正しくないか、有効期限が切れています。もう一度コードを送ってください。";
  if (/invalid login credentials/i.test(message)) return "メールアドレスかパスワードが正しくありません。";
  if (/email not confirmed/i.test(message)) return "メールアドレスの確認が済んでいません。新規登録の画面から確認コードを入力してください。";
  if (/password/i.test(message) && /(weak|short|least)/i.test(message)) return `パスワードは${MIN_PASSWORD_LENGTH}文字以上で、推測されにくいものにしてください。`;
  return fallback;
}

async function client() {
  const supabase = await createServerClient();
  if (!supabase) throw new Error("ログイン機能を使うにはデータベースの設定が必要です。");
  return supabase;
}

// ---------------------------------------------------------------------------
// ワーカー：メールに届く確認コードでログイン（アカウントが無ければ作る）
// ---------------------------------------------------------------------------
export async function sendLoginCode(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = readEmail(form);
  if (!email) return { error: "メールアドレスを確認してください。" };
  const supabase = await client();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) return { error: friendly(error.message, "確認コードを送れませんでした。時間をおいてお試しください。"), email };
  return { step: "code", email, message: `${email} に確認コードを送りました。メールに書かれた数字を入力してください。` };
}

export async function verifyLoginCode(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = readEmail(form);
  const code = readCode(form);
  if (!email) return { error: "メールアドレスを確認してください。" };
  if (!code) return { step: "code", email, error: "メールに届いた数字のコードを入力してください。" };
  const supabase = await client();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error) return { step: "code", email, error: friendly(error.message, "ログインできませんでした。もう一度お試しください。") };
  redirect(safeNext(form.get("next"), "/workers/mypage"));
}

// ---------------------------------------------------------------------------
// 店長：メールアドレスとパスワード。新規登録とパスワード再設定は、メールの確認コードで本人確認する
// ---------------------------------------------------------------------------
export async function signInWithPassword(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = readEmail(form);
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "メールアドレスとパスワードを入力してください。" };
  const supabase = await client();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: friendly(error.message, "ログインできませんでした。もう一度お試しください。"), email };
  redirect(safeNext(form.get("next"), "/managers/settings"));
}

export async function signUpWithPassword(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = readEmail(form);
  const password = String(form.get("password") ?? "");
  if (!email) return { error: "メールアドレスを確認してください。" };
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 72) return { error: `パスワードは${MIN_PASSWORD_LENGTH}〜72文字で入力してください。`, email };
  const supabase = await client();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: friendly(error.message, "登録できませんでした。時間をおいてお試しください。"), email };
  // メール確認を必須にしていない設定では、そのままログイン済みになる。
  if (data.session) redirect(safeNext(form.get("next"), "/managers/settings"));
  return { step: "code", email, message: `${email} に確認コードを送りました。メールに書かれた数字を入力すると登録が完了します。` };
}

export async function verifySignUpCode(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = readEmail(form);
  const code = readCode(form);
  if (!email) return { error: "メールアドレスを確認してください。" };
  if (!code) return { step: "code", email, error: "メールに届いた数字のコードを入力してください。" };
  const supabase = await client();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });
  if (error) return { step: "code", email, error: friendly(error.message, "確認できませんでした。もう一度お試しください。") };
  redirect(safeNext(form.get("next"), "/managers/settings"));
}

export async function sendPasswordResetCode(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = readEmail(form);
  if (!email) return { error: "メールアドレスを確認してください。" };
  const supabase = await client();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  // アカウントの有無を推測されないよう、送信の失敗理由が回数制限のとき以外は同じ案内にする。
  if (error && /rate limit|too many|security purposes/i.test(error.message)) return { error: friendly(error.message, ""), email };
  return { step: "code", email, message: `${email} が登録済みなら、確認コードを送りました。コードと新しいパスワードを入力してください。` };
}

export async function resetPassword(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = readEmail(form);
  const code = readCode(form);
  const password = String(form.get("password") ?? "");
  if (!email) return { error: "メールアドレスを確認してください。" };
  if (!code) return { step: "code", email, error: "メールに届いた数字のコードを入力してください。" };
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 72) return { step: "code", email, error: `パスワードは${MIN_PASSWORD_LENGTH}〜72文字で入力してください。` };
  const supabase = await client();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "recovery" });
  if (error) return { step: "code", email, error: friendly(error.message, "確認できませんでした。もう一度お試しください。") };
  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) return { step: "code", email, error: friendly(updateError.message, "パスワードを変更できませんでした。") };
  redirect(safeNext(form.get("next"), "/managers/settings"));
}

// ---------------------------------------------------------------------------
// 共通：ログアウト
// ---------------------------------------------------------------------------
export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/");
}

// ---------------------------------------------------------------------------
// 審査担当：パスワードでログインした後、認証アプリのコード（TOTP）で2段階認証する
// ---------------------------------------------------------------------------
export type MfaState = { error?: string; enroll?: { factorId: string; qrCode: string; secret: string } };

/** 審査担当のログイン状況。reviewer は app_metadata の役割、aal2 は2段階認証済み。 */
export async function getReviewerStatus(): Promise<{ signedIn: boolean; reviewer: boolean; aal2: boolean; hasFactor: boolean }> {
  const { supabase, user } = await getAuth();
  if (!supabase || !user) return { signedIn: false, reviewer: false, aal2: false, hasFactor: false };
  const reviewer = user.app_metadata?.role === "identity_reviewer";
  const [{ data: aal }, { data: factors }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  return { signedIn: true, reviewer, aal2: aal?.currentLevel === "aal2", hasFactor: (factors?.totp.length ?? 0) > 0 };
}

export async function signInReviewer(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = readEmail(form);
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "メールアドレスとパスワードを入力してください。" };
  const supabase = await client();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: friendly(error?.message, "ログインできませんでした。"), email };
  if (data.user.app_metadata?.role !== "identity_reviewer") {
    await supabase.auth.signOut();
    return { error: "このアカウントには審査の権限がありません。", email };
  }
  return { step: "done" };
}

/** 認証アプリの登録を始める（QRコードを返す）。登録途中で止まった古い設定は消してからやり直す。 */
export async function startReviewerMfaEnrollment(): Promise<MfaState> {
  const status = await getReviewerStatus();
  if (!status.reviewer) return { error: "審査の権限があるアカウントでログインしてください。" };
  if (status.hasFactor) return { error: "認証アプリはすでに登録されています。コードを入力してください。" };
  const supabase = await client();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Shiflun 審査" });
  if (error || !data) return { error: "認証アプリの登録を始められませんでした。時間をおいてお試しください。" };
  return { enroll: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
}

export async function verifyReviewerMfa(_prev: MfaState, form: FormData): Promise<MfaState> {
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "認証アプリに表示された6桁の数字を入力してください。" };
  const status = await getReviewerStatus();
  if (!status.reviewer) return { error: "審査の権限があるアカウントでログインしてください。" };
  const supabase = await client();
  let factorId = String(form.get("factor_id") ?? "");
  if (!factorId) {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    factorId = factors?.totp[0]?.id ?? "";
  }
  if (!factorId) return { error: "認証アプリが登録されていません。" };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "コードが正しくないか、時間切れです。認証アプリの最新のコードを入力してください。" };
  redirect("/admin/identity-verifications");
}
