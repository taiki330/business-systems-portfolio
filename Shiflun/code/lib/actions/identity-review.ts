"use server";

import { revalidatePath } from "next/cache";
import { requireReviewer } from "@/lib/auth/reviewer";
import { IdentityVerification } from "@/lib/types/database";

export type PendingIdentityVerification = IdentityVerification & {
  workers: { name: string; current_store: string } | null;
  imageUrl: string | null;
};

/** 審査待ちの提出と、画像を見るための短時間だけ有効なURL。 */
export async function getPendingIdentityVerifications(): Promise<{ verifications: PendingIdentityVerification[]; error: string | null }> {
  const reviewer = await requireReviewer();
  if (!reviewer) return { verifications: [], error: "審査担当として2段階認証でログインしてください。" };
  const { data, error } = await reviewer.supabase
    .from("identity_verifications")
    .select("*, workers(name, current_store)")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });
  if (error) return { verifications: [], error: error.message };
  const rows = (data ?? []) as (IdentityVerification & { workers: { name: string; current_store: string } | null })[];
  const verifications = await Promise.all(rows.map(async (row) => {
    if (!row.document_storage_path) return { ...row, imageUrl: null };
    // 画面を開いている間だけ見られれば十分なので、URLの有効期限は短くする。
    const { data: signed } = await reviewer.supabase.storage.from("identity-documents").createSignedUrl(row.document_storage_path, 120);
    return { ...row, imageUrl: signed?.signedUrl ?? null };
  }));
  return { verifications, error: null };
}

export type ReviewIdentityVerificationState = { error?: string };

export async function reviewIdentityVerification(
  _prev: ReviewIdentityVerificationState,
  formData: FormData,
): Promise<ReviewIdentityVerificationState> {
  const id = String(formData.get("verification_id") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const rejectReason = String(formData.get("reject_reason") ?? "").trim();

  if (!id || (decision !== "verified" && decision !== "rejected")) {
    return { error: "不正なリクエストです。" };
  }
  if (decision === "rejected" && !rejectReason) return { error: "却下理由を入力してください。" };

  const reviewer = await requireReviewer();
  if (!reviewer) return { error: "審査担当として2段階認証でログインしてください。" };

  // 審査担当者名は入力ではなく、ログイン中のアカウントのメールアドレスを記録する。
  const { data, error } = await reviewer.supabase
    .from("identity_verifications")
    .update({
      status: decision,
      reviewer_name: reviewer.user.email ?? reviewer.user.id,
      reviewed_at: new Date().toISOString(),
      reject_reason: decision === "rejected" ? rejectReason : null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "この提出は審査済みです。画面を更新してください。" };

  revalidatePath("/admin/identity-verifications");
  revalidatePath("/workers/verify-identity");
  return {};
}
