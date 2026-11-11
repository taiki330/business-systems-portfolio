import { NextResponse, type NextRequest } from "next/server";
import { isAuthzEnabled } from "@/lib/auth/authz-flag";
import { updateSession } from "@/lib/supabase/middleware-client";

/**
 * A-6-1: ログイン必須化（既定 ON。`REQUIRE_AUTH=0` のときのみ OFF）
 *
 * - REQUIRE_AUTH='0'（ローカル開発限定）→ A-1〜A-5 と同じく cookie 同期のみ
 * - それ以外（未設定含む）:
 *     未ログインで保護パスへのアクセス → /login?next=<元のパス+クエリ> へ 302
 *     /login や /auth/signout、静的ファイル類は除外
 *
 * 設計指針（docs/13 §13-12）:
 *   - ここで判定するのは「認証されているか（authenticated）」のみ。
 *   - 「app_users に登録されているか」「role が internal/vendor のどちらか」「どの画面を許可するか」
 *     等の認可判定は A-7 以降で別レイヤとして導入する（middleware に混ぜない）。
 */

const EXCLUDED_EXACT = new Set<string>([
  "/login",
  "/auth/signout",
  "/auth/callback",
]);

function isStaticAssetPath(pathname: string): boolean {
  return /\.(svg|png|jpe?g|gif|webp|ico|css|js|map|txt|xml|json)$/i.test(
    pathname,
  );
}

function isExcludedPath(pathname: string): boolean {
  if (EXCLUDED_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (isStaticAssetPath(pathname)) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  if (!isAuthzEnabled()) return response;

  const { pathname, search } = request.nextUrl;
  if (isExcludedPath(pathname)) return response;

  if (user) return response;

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
