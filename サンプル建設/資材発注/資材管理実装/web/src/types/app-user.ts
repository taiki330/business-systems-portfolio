export type AppUserRole = "internal" | "admin" | "center" | "vendor";

/**
 * 認証済みユーザーの集約型。
 * - auth.users に存在しても app_users 未登録なら role / display_name は null
 * - vendor_id は旧仕様との互換用。新規の現場アカウントでは NULL
 */
export type AppUser = {
  id: string;
  email: string | null;
  role: AppUserRole | null;
  display_name: string | null;
  vendor_id: string | null;
  /** role='vendor'（画面上は「現場」）のとき、このアカウントが担当する現場 */
  site_id: string | null;
  /** 現場アカウントが操作できる全現場。site_id は既存データ互換用の代表現場。 */
  site_ids?: string[];
  /** role='center' のとき、このアカウントが参照できる地域センター。P4 */
  center_id: string | null;
};
