import { createClient } from "@/lib/supabase/server";
import type { AppUser, AppUserRole } from "@/types/app-user";

/** 認証済みユーザーの権限情報をDBから取得できなかったことを表す。 */
export class CurrentUserLoadError extends Error {
  constructor() {
    super("current_user_load_failed");
    this.name = "CurrentUserLoadError";
  }
}

/**
 * 現在のログインユーザーを返す。
 * - 未認証なら null
 * - 認証済みだが app_users 未登録なら role / display_name / vendor_id は null
 *   （管理者が SQL Editor で app_users に登録するまでロール未確定の状態）
 *
 * 既存 P0 経路（anon）には影響しない。
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error("getCurrentUser(auth):", {
      code: userError.code,
      message: userError.message,
    });
    throw new CurrentUserLoadError();
  }
  if (!user) {
    return null;
  }

  const { data: appUser, error: appUserError } = await supabase
    .from("app_users")
    .select("id, role, display_name, vendor_id, site_id, center_id")
    .eq("id", user.id)
    .maybeSingle();
  if (appUserError) {
    console.error("getCurrentUser(app_users):", {
      userId: user.id,
      code: appUserError.code,
      message: appUserError.message,
    });
    throw new CurrentUserLoadError();
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from("app_user_sites")
    .select("site_id")
    .eq("user_id", user.id);
  if (assignmentsError) {
    console.error("getCurrentUser(app_user_sites):", {
      userId: user.id,
      code: assignmentsError.code,
      message: assignmentsError.message,
    });
    throw new CurrentUserLoadError();
  }

  return {
    id: user.id,
    email: user.email ?? null,
    role: (appUser?.role as AppUserRole | undefined) ?? null,
    display_name: appUser?.display_name ?? null,
    vendor_id: appUser?.vendor_id ?? null,
    site_id: appUser?.site_id ?? null,
    site_ids: (assignments ?? []).map((row) => row.site_id as string),
    center_id: appUser?.center_id ?? null,
  };
}
