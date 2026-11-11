import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import AuthStatus from "@/components/auth/AuthStatus";
import { evaluatePathAccess } from "@/lib/auth/access-rules";
import { isAuthzEnabled } from "@/lib/auth/authz-flag";
import { CurrentUserLoadError, getCurrentUser } from "@/lib/auth/get-current-user";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "資材管理",
  description: "仮設資材 在庫・発注管理",
};

// A-7-app-1 / A-7-app-3: 認可レイヤをスキップする許可パス。
// - /login, /auth/signout, /no-access (A-7-app-3)
// - /forbidden                       (A-7-app-1)
// これらは role 判定の対象外。誤って巡回 redirect しないよう必ず exempt に含める。
const AUTHZ_EXEMPT_PATHS = new Set<string>([
  "/login",
  "/auth/signout",
  "/no-access",
  "/forbidden",
  "/system-error",
]);

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A-7-app-1 / A-7-app-3: 認可 ON（既定。`REQUIRE_AUTH=0` のときのみ OFF）で role ガードを有効化。
  //   1) 未認証は middleware が /login に飛ばす前提（layout に user=null で来ても素通り）
  //   2) (b) role=null は /no-access へ
  //   3) internal/vendor は pathname × role を評価し
  //        - 'allow'      通過
  //        - 'forbidden'  /forbidden へ redirect（vendor が internal 専用画面に来た場合）
  //        - 'not_found'  通過（該当 page.tsx で notFound()。root layout では不可）
  // docs/13 §2 / §5-1 / §13-12 / 会話履歴（A-7-app-1, D1）
  if (isAuthzEnabled()) {
    const h = await headers();
    const pathname = h.get("x-pathname") ?? "/";

    if (!AUTHZ_EXEMPT_PATHS.has(pathname)) {
      let user;
      try {
        user = await getCurrentUser();
      } catch (error) {
        if (error instanceof CurrentUserLoadError) {
          redirect("/system-error");
        }
        throw error;
      }
      if (user) {
        if (user.role === null) {
          redirect("/no-access");
        }
        const decision = evaluatePathAccess(pathname, user.role);
        if (decision === "forbidden") {
          redirect("/forbidden");
        }
        // 'not_found' は children（page）へ委譲。例: /vendor/stock/page.tsx
      }
    }
  }

  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 sm:px-6">
            <Link
              href="/"
              className="text-sm font-semibold text-zinc-900 hover:text-zinc-700"
            >
              資材管理
            </Link>
            <Suspense fallback={null}>
              <AuthStatus />
            </Suspense>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
