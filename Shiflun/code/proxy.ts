import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// ログインなしで開けるページ。これ以外はログインが必要。
const PUBLIC_PATHS = ["/", "/terms", "/privacy", "/agreement", "/login", "/managers/login", "/admin/login", "/contact", "/account/delete"];

/** ログインしていないときの案内先。店舗の画面は店長用、審査の画面は審査担当用のログインへ。 */
function loginPathFor(pathname: string) {
  if (pathname.startsWith("/admin")) return "/admin/login";
  if (pathname.startsWith("/managers") || pathname.startsWith("/companies")) return "/managers/login";
  return "/login";
}

/**
 * ログイン情報（Cookie）の更新と、ログインが必要なページの入口チェック。
 * ここでのチェックは画面遷移の案内のためで、データの保護はデータベース側の RLS（migration 022）が行う。
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // DB未接続のモック表示では、ログインなしで画面を確認できるようにしておく。
  if (!url || !anonKey || process.env.DEMO_MOCK === "true") return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // getUser はログイン情報を Supabase Auth に確かめ、期限が近ければ更新する。この間に他の処理を挟まないこと。
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  if (!user && !PUBLIC_PATHS.includes(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = loginPathFor(pathname);
    login.search = `?next=${encodeURIComponent(pathname + search)}`;
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }
  return response;
}

export const config = {
  // 画像・ビルド成果物などの静的ファイルは対象外。
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
