import { createClient } from "@/lib/supabase/server";
import type { AppUserListRow, ResolvedAuthUser } from "@/types/user-management";

/**
 * app_users 一覧を取得する（internal 限定）。
 * app_users_self_select を広げず、SECURITY DEFINER 関数 list_app_users() 経由で取得する。
 */
export async function fetchAppUsers(): Promise<{
  rows: AppUserListRow[];
  error: { message: string } | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_app_users");

  if (error) {
    return { rows: [], error: { message: error.message } };
  }

  const rows = ((data ?? []) as AppUserListRow[]).slice().sort((a, b) => {
    const emailA = a.email ?? "";
    const emailB = b.email ?? "";
    return emailA.localeCompare(emailB, "ja");
  });

  return { rows, error: null };
}

export async function fetchAppUserById(
  id: string,
): Promise<AppUserListRow | null> {
  const { rows, error } = await fetchAppUsers();
  if (error) return null;
  return rows.find((r) => r.id === id) ?? null;
}

/**
 * メールアドレスから既存 auth.users を検索する（internal 限定）。
 * 新規 Auth アカウントの発行は行わない。
 */
export async function resolveAuthUserByEmail(
  email: string,
): Promise<{ user: ResolvedAuthUser | null; error: { message: string } | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_auth_user_by_email", {
    p_email: email,
  });

  if (error) {
    return { user: null, error: { message: error.message } };
  }

  const rows = (data ?? []) as ResolvedAuthUser[];
  return { user: rows[0] ?? null, error: null };
}
