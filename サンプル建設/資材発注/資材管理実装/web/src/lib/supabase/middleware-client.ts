import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export type UpdateSessionResult = {
  response: NextResponse;
  /**
   * A-6-1: Supabase `auth.getUser()` の結果（middleware 側でログイン判定に再利用する）。
   * - 環境変数未設定や getUser 例外時は null
   * - ここでは「認証されているか」のみ判定する。app_users / role の認可は別レイヤ（docs/13 §13-12）。
   */
  user: { id: string } | null;
};

/**
 * Next.js middleware から呼び出す Supabase セッション同期ヘルパ。
 *
 * - cookie 同期と `supabase.auth.getUser()` による refresh を行う。
 * - 強制リダイレクトは middleware.ts 側で `REQUIRE_AUTH` を見て判断する。
 * - 環境変数が未設定でもアプリを止めない（開発時の起動順序を壊さない）。
 */
export async function updateSession(
  request: NextRequest,
): Promise<UpdateSessionResult> {
  // A-7-app-3: root layout からリクエストパスを参照できるよう x-pathname を request header に注入する。
  // Next.js の Server Component からは headers() 経由で取得可能になる。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return { response: supabaseResponse, user: null };
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({
          request: { headers: requestHeaders },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user ? { id: data.user.id } : null;
  } catch {
    user = null;
  }

  return { response: supabaseResponse, user };
}
