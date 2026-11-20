"use server";

import { revalidatePath } from "next/cache";
import { getAuth, requireWorker } from "@/lib/auth/session";
import { IdentityDocumentType, IdentityVerification } from "@/lib/types/database";

const DOCUMENT_TYPES: IdentityDocumentType[] = ["license", "my_number_card", "passport", "residence_card"];
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };

export type SubmitIdentityVerificationState = { error?: string; success?: boolean };

/**
 * 本番のeKYCベンダー（TRUSTDOCK等）導入までの暫定実装。
 * ワーカーが身分証画像を提出し、運営の審査担当が /admin/identity-verifications で目視審査する（provider='manual'）。
 * 画像は本人のフォルダ（{worker_id}/…）にだけ保存でき、閲覧できるのは2段階認証済みの審査担当だけ（migration 022）。
 * docs/legal/04_questions-lawyer.md「5. 個人情報」参照。
 */
export async function submitIdentityVerification(
  _prev: SubmitIdentityVerificationState,
  formData: FormData,
): Promise<SubmitIdentityVerificationState> {
  const fullNameKana = String(formData.get("full_name_kana") ?? "").trim();
  const birthDate = String(formData.get("birth_date") ?? "").trim();
  const documentType = String(formData.get("document_type") ?? "").trim();
  const file = formData.get("document") as File | null;

  if (!fullNameKana || !/^[ァ-ヶー\s]+$/.test(fullNameKana)) {
    return { error: "氏名（カナ）をカタカナで入力してください。" };
  }
  if (!birthDate || Number.isNaN(Date.parse(birthDate))) {
    return { error: "生年月日を正しく入力してください。" };
  }
  if (!DOCUMENT_TYPES.includes(documentType as IdentityDocumentType)) {
    return { error: "身分証の種類を選択してください。" };
  }
  if (!file || file.size === 0) return { error: "身分証の画像を選択してください。" };
  if (file.size > MAX_FILE_BYTES) return { error: "ファイルサイズは8MB以内にしてください。" };
  const ext = IMAGE_EXTENSIONS[file.type];
  if (!ext) return { error: "JPEG・PNG・WebP・HEIC の画像を選択してください。" };

  const { supabase, worker, error: authError } = await requireWorker();
  if (!supabase) return { error: authError };

  // ファイル名は利用者の入力を使わず、サーバー側で決める。
  const path = `${worker.id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("identity-documents")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { error: `画像のアップロードに失敗しました: ${uploadError.message}` };
  }

  const { error } = await supabase.from("identity_verifications").upsert(
    {
      worker_id: worker.id,
      status: "pending",
      full_name_kana: fullNameKana,
      birth_date: birthDate,
      document_type: documentType,
      document_storage_path: path,
      provider: "manual",
      submitted_at: new Date().toISOString(),
      reviewed_at: null,
      reviewer_name: null,
      reject_reason: null,
    },
    { onConflict: "worker_id" },
  );

  if (error) return { error: error.message };

  revalidatePath("/workers/verify-identity");
  revalidatePath("/admin/identity-verifications");
  return { success: true };
}

/** ログイン中のワーカー本人の提出状況（他人の分は RLS で読めない）。 */
export async function getIdentityVerification(): Promise<{ verification: IdentityVerification | null; error: string | null }> {
  const { supabase, user } = await getAuth();
  if (!supabase || !user) return { verification: null, error: null };
  const { supabase: workerClient, worker } = await requireWorker();
  if (!workerClient) return { verification: null, error: null };
  const { data, error } = await workerClient
    .from("identity_verifications")
    .select("*")
    .eq("worker_id", worker.id)
    .maybeSingle();
  return { verification: (data as IdentityVerification | null) ?? null, error: error?.message ?? null };
}
