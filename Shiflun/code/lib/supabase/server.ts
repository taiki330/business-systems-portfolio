import { createServerClient as createSsrClient } from "@supabase/ssr";
import { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

/**
 * ログイン中の利用者として Supabase に接続するクライアント（ログイン情報は Cookie に保存）。
 * データベース側のアクセス制限（RLS、migration 022）が、この利用者の範囲だけを読み書きできるようにする。
 * リクエストごとに作り直すこと（利用者をまたいで使い回さない）。
 */
export async function createServerClient(): Promise<SupabaseClient | null> {
  if (process.env.DEMO_MOCK === "true") return null;

  const env = getSupabaseEnv();
  if (!env) return null;

  const cookieStore = await cookies();
  return createSsrClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        // Server Component の描画中は Cookie を書けない。ログイン情報の更新は proxy.ts が行う。
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {}
      },
    },
  });
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}
