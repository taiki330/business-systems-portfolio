"use server";

import { revalidatePath } from "next/cache";
import { REVIEWER_SIGN_IN, requireReviewer } from "@/lib/auth/reviewer";
import { AccountSuspension, ChatReport, ContactInquiry } from "@/lib/types/database";

// 運営（審査担当）用。通報・お問い合わせの確認と、退会者の身分証画像の削除。
// データベース側でも、2段階認証済みの審査担当だけが読める（migration 023）。

export type ChatReportRow = ChatReport & { workers: { name: string } | null; stores: { name: string } | null };

export async function getOpenChatReports(): Promise<{ reports: ChatReportRow[]; error: string | null }> {
  const reviewer = await requireReviewer();
  if (!reviewer) return { reports: [], error: REVIEWER_SIGN_IN };
  const { data, error } = await reviewer.supabase.from("chat_reports").select("*, workers(name), stores(name)").eq("status", "open").order("created_at", { ascending: true }).limit(200);
  return { reports: (data ?? []) as ChatReportRow[], error: error?.message ?? null };
}

export async function getOpenInquiries(): Promise<{ inquiries: ContactInquiry[]; error: string | null }> {
  const reviewer = await requireReviewer();
  if (!reviewer) return { inquiries: [], error: REVIEWER_SIGN_IN };
  const { data, error } = await reviewer.supabase.from("contact_inquiries").select("*").eq("status", "open").order("created_at", { ascending: true }).limit(200);
  return { inquiries: (data ?? []) as ContactInquiry[], error: error?.message ?? null };
}

export type ResolveState = { error?: string };

const TABLES = { report: { table: "chat_reports", path: "/admin/reports" }, inquiry: { table: "contact_inquiries", path: "/admin/inquiries" } } as const;

/** 通報・お問い合わせを「対応済み」にする。対応した人は、ログイン中のアカウントのメールアドレスで記録する。 */
export async function resolveModerationItem(_prev: ResolveState, form: FormData): Promise<ResolveState> {
  const kind = String(form.get("kind") ?? "") as keyof typeof TABLES;
  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!(kind in TABLES) || !/^[0-9a-f-]{36}$/i.test(id)) return { error: "不正なリクエストです。" };
  if (!note || note.length > 1000) return { error: "対応内容のメモを1〜1000文字で入力してください。" };
  const reviewer = await requireReviewer();
  if (!reviewer) return { error: REVIEWER_SIGN_IN };
  const { table, path } = TABLES[kind];
  const { data, error } = await reviewer.supabase.from(table)
    .update({ status: "resolved", resolution_note: note, resolved_at: new Date().toISOString(), resolved_by: reviewer.user.email ?? reviewer.user.id })
    .eq("id", id).eq("status", "open").select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "すでに対応済みです。画面を更新してください。" };
  revalidatePath(path);
  return {};
}

/** 退会したワーカーの身分証画像のうち、まだ削除していない件数。 */
export async function getPendingIdentityPurgeCount(): Promise<number> {
  const reviewer = await requireReviewer();
  if (!reviewer) return 0;
  const { count } = await reviewer.supabase.from("identity_document_purges").select("id", { count: "exact", head: true }).is("purged_at", null);
  return count ?? 0;
}

export type PurgeState = { error?: string; purged?: number };

/** 退会したワーカーの身分証画像を Storage から削除する。 */
export async function purgeDeletedIdentityDocuments(): Promise<PurgeState> {
  const reviewer = await requireReviewer();
  if (!reviewer) return { error: REVIEWER_SIGN_IN };
  const { data: pending, error } = await reviewer.supabase.from("identity_document_purges").select("id, folder").is("purged_at", null).order("requested_at").limit(100);
  if (error) return { error: error.message };
  const bucket = reviewer.supabase.storage.from("identity-documents");
  let purged = 0;
  for (const row of pending ?? []) {
    // フォルダ名はワーカーID（UUID）。それ以外の値が入っていても、他の場所は消さない。
    if (!/^[0-9a-f-]{36}$/i.test(row.folder)) continue;
    const { data: files, error: listError } = await bucket.list(row.folder, { limit: 1000 });
    if (listError) return { error: `画像の一覧を取得できませんでした: ${listError.message}`, purged };
    if (files?.length) {
      const { error: removeError } = await bucket.remove(files.map((f) => `${row.folder}/${f.name}`));
      if (removeError) return { error: `画像を削除できませんでした: ${removeError.message}`, purged };
    }
    const { error: markError } = await reviewer.supabase.from("identity_document_purges")
      .update({ purged_at: new Date().toISOString(), purged_by: reviewer.user.email ?? reviewer.user.id }).eq("id", row.id);
    if (markError) return { error: markError.message, purged };
    purged += 1;
  }
  revalidatePath("/admin/identity-verifications");
  return { purged };
}

// --- 利用停止（migration 026） ---------------------------------------------------------------

const UUID = /^[0-9a-f-]{36}$/i;
/** DBが日本語で返す案内は、そのまま画面に出す。 */
const JAPANESE = /[ぁ-んァ-ヶ一-龥]/;

export type SuspensionRow = AccountSuspension;

/** 利用停止中のアカウント（解除していないもの）。 */
export async function getActiveSuspensions(): Promise<{ suspensions: SuspensionRow[]; error: string | null }> {
  const reviewer = await requireReviewer();
  if (!reviewer) return { suspensions: [], error: REVIEWER_SIGN_IN };
  const { data, error } = await reviewer.supabase.from("account_suspensions").select("*, workers(name), stores(name)").is("lifted_at", null).order("suspended_at", { ascending: false }).limit(200);
  return { suspensions: (data ?? []) as SuspensionRow[], error: error?.message ?? null };
}

export type SuspensionState = { error?: string; success?: boolean };

/**
 * 通報されたアカウントを利用停止にする。ワーカー・店舗のどちらか一方を指定する（同じログインの両方が止まる）。
 * ログイン自体が止まり、今のログイン状態も消える。通報から押したときは、その通報も対応済みになる。
 * 停止にした人が使えるのは、ログイン画面の案内と、お問い合わせだけ。
 */
export async function suspendAccount(_prev: SuspensionState, form: FormData): Promise<SuspensionState> {
  const workerId = String(form.get("worker_id") ?? "") || null;
  const storeId = String(form.get("store_id") ?? "") || null;
  const reportId = String(form.get("report_id") ?? "") || null;
  const reason = String(form.get("reason") ?? "").trim();
  if ((workerId && !UUID.test(workerId)) || (storeId && !UUID.test(storeId)) || (reportId && !UUID.test(reportId)) || Boolean(workerId) === Boolean(storeId)) return { error: "不正なリクエストです。" };
  if (!reason || reason.length > 1000) return { error: "停止の理由を1〜1000文字で入力してください。" };
  if (form.get("confirm") !== "on") return { error: "内容を確認して、チェックを入れてください。" };
  const reviewer = await requireReviewer();
  if (!reviewer) return { error: REVIEWER_SIGN_IN };
  const { error } = await reviewer.supabase.rpc("suspend_account", { p_worker_id: workerId, p_store_id: storeId, p_reason: reason, p_report_id: reportId });
  if (error) return { error: JAPANESE.test(error.message) ? error.message : "利用停止にできませんでした。時間をおいてお試しください。" };
  for (const path of ["/admin/reports", "/admin/suspensions"]) revalidatePath(path);
  return { success: true };
}

/** 利用停止を解除する。ログインできるようになる。 */
export async function liftSuspension(_prev: SuspensionState, form: FormData): Promise<SuspensionState> {
  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!UUID.test(id)) return { error: "不正なリクエストです。" };
  if (!note || note.length > 1000) return { error: "解除の理由を1〜1000文字で入力してください。" };
  const reviewer = await requireReviewer();
  if (!reviewer) return { error: REVIEWER_SIGN_IN };
  const { error } = await reviewer.supabase.rpc("lift_suspension", { p_suspension_id: id, p_note: note });
  if (error) return { error: JAPANESE.test(error.message) ? error.message : "解除できませんでした。時間をおいてお試しください。" };
  revalidatePath("/admin/suspensions");
  return { success: true };
}
