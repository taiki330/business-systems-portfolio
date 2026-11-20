import { getAuth } from "@/lib/auth/session";

/**
 * 審査担当（app_metadata.role = 'identity_reviewer'）が、2段階認証（aal2）でログインしているときだけ使える。
 * データベース側でも同じ条件でしか運営用のデータを読めない（migration 022 の is_identity_reviewer）。
 */
export async function requireReviewer() {
  const { supabase, user } = await getAuth();
  if (!supabase || !user || user.app_metadata?.role !== "identity_reviewer") return null;
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === "aal2" ? { supabase, user } : null;
}

export const REVIEWER_SIGN_IN = "審査担当として2段階認証でログインしてください。";
