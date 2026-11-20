"use server";

import { redirect } from "next/navigation";
import { getAuth, getCurrentStore, getCurrentWorker } from "@/lib/auth/session";
import { PHOTO_BUCKET } from "@/lib/photos";

export type DeleteAccountState = { error?: string };

/**
 * 退会（アカウント削除）。ログイン中の本人のアカウントだけを対象にする（migration 023 の delete_my_account）。
 * ログイン情報とプロフィールを消し、勤怠・支払いの記録とチャットの履歴は「退会済みユーザー」として相手側に残す。
 * 身分証の画像は削除待ちとして記録され、審査担当が /admin/identity-verifications で削除する。
 */
export async function deleteAccount(_prev: DeleteAccountState, form: FormData): Promise<DeleteAccountState> {
  if (form.get("confirm") !== "on") return { error: "内容を確認して、チェックを入れてください。" };
  const { supabase, user } = await getAuth();
  if (!supabase) return { error: "デモ表示では退会できません。" };
  if (!user) return { error: "ログインの有効期限が切れました。もう一度ログインしてからお試しください。" };

  // プロフィール写真・店舗写真のファイルを先に消す（本人は自分のフォルダを消せる。migration 024）。
  // 失敗しても退会は進める（写真の列は退会時に空になり、画面には出なくなる）。
  const [worker, store] = await Promise.all([getCurrentWorker(), getCurrentStore()]);
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  for (const folder of [worker && `workers/${worker.id}`, store && `stores/${store.id}`]) {
    if (!folder) continue;
    try {
      const { data: files } = await bucket.list(folder, { limit: 100 });
      if (files?.length) await bucket.remove(files.map((file) => `${folder}/${file.name}`));
    } catch {}
  }

  const { error } = await supabase.rpc("delete_my_account");
  if (error) return { error: "退会の処理ができませんでした。時間をおいてもう一度お試しください。解決しない場合はお問い合わせください。" };

  // ログイン情報はもう無いので、端末に残った Cookie を消す（サーバー側の失敗は無視してよい）。
  await supabase.auth.signOut().catch(() => undefined);
  redirect("/account/delete?done=1");
}
