import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * service_role キーを使う管理者クライアント。RLS を無視するため、
 * Server Action / Route Handler など admin 限定のサーバー専用コードからのみ呼び出すこと。
 * クライアントコンポーネントや anon 経路には絶対に持ち出さない。
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env.local に設定してください。",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
