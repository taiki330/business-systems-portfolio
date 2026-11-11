import { createClient } from "@/lib/supabase/server";

/**
 * ログイン中なら user.id（uuid 文字列）を、未ログインなら null を返す。
 *
 * A-3 では監査・追跡用の「誰が操作したか」を埋めるだけが目的。
 * - role 判定はしない（app_users 未登録ユーザーも追跡対象に含める）
 * - 認可（vendor 自身チェック等）はここに混ぜず、A-7 で別ヘルパとして導入する
 *
 * `auth.getUser()` 失敗時は null を返し、業務処理を止めない。
 */
export async function getActorId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}
