"use server";

import { revalidatePath } from "next/cache";
import { requireStore, requireWorker } from "@/lib/auth/session";
import { PHOTO_BUCKET, signPhotoUrls } from "@/lib/photos";
import { ParticipantRole } from "@/lib/types/database";

export type PhotoState = { error?: string; url?: string | null };

// 画面側で 800px 以内の JPEG に縮めてから送るので、通常は数百KB。
const MAX_BYTES = 2 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** ログイン中の本人の、指定した立場（ワーカー / 店舗）の行。画面から送られたIDは使わない。 */
async function owner(role: ParticipantRole) {
  if (role === "worker") {
    const { supabase, worker, error } = await requireWorker();
    return supabase ? { supabase, table: "workers" as const, id: worker.id, current: worker.photo_path ?? null, error: null } : { supabase: null, error };
  }
  const { supabase, store, error } = await requireStore();
  return supabase ? { supabase, table: "stores" as const, id: store.id, current: store.photo_path ?? null, error: null } : { supabase: null, error };
}

function refresh(role: ParticipantRole) {
  revalidatePath(role === "worker" ? "/workers/mypage" : "/managers/settings");
}

/** プロフィール写真（ワーカー）・店舗写真を登録する。前の写真は消す。 */
export async function uploadProfilePhoto(role: ParticipantRole, form: FormData): Promise<PhotoState> {
  if (role !== "worker" && role !== "store") return { error: "不正なリクエストです。" };
  const file = form.get("photo");
  if (!(file instanceof Blob) || file.size === 0) return { error: "写真を選んでください。" };
  if (file.size > MAX_BYTES) return { error: "写真のサイズが大きすぎます。別の写真でお試しください。" };
  const ext = EXTENSIONS[file.type];
  if (!ext) return { error: "JPEG・PNG・WebP の画像を選んでください。" };

  const target = await owner(role);
  if (!target.supabase) return { error: target.error ?? "ログインし直してください。" };
  const { supabase, table, id, current } = target;

  // ファイル名は利用者の入力を使わず、サーバー側で決める。
  const path = `${table}/${id}/${Date.now()}.${ext}`;
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  const { error: uploadError } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: "写真を保存できませんでした。時間をおいてお試しください。" };

  const { error: saveError } = await supabase.from(table).update({ photo_path: path }).eq("id", id);
  if (saveError) {
    await bucket.remove([path]);
    return { error: "写真を保存できませんでした。時間をおいてお試しください。" };
  }
  if (current && current !== path) await bucket.remove([current]);

  refresh(role);
  const urls = await signPhotoUrls(supabase, [path]);
  return { url: urls[path] ?? null };
}

/** 登録した写真を消す。 */
export async function removeProfilePhoto(role: ParticipantRole): Promise<PhotoState> {
  if (role !== "worker" && role !== "store") return { error: "不正なリクエストです。" };
  const target = await owner(role);
  if (!target.supabase) return { error: target.error ?? "ログインし直してください。" };
  const { supabase, table, id, current } = target;
  const { error } = await supabase.from(table).update({ photo_path: null }).eq("id", id);
  if (error) return { error: "写真を削除できませんでした。時間をおいてお試しください。" };
  if (current) await supabase.storage.from(PHOTO_BUCKET).remove([current]);
  refresh(role);
  return { url: null };
}
