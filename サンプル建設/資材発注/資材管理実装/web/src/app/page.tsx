import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  homeMenuCategories,
  homeNavLinks,
  resolveUiRole,
} from "@/lib/auth/ui-capabilities";
import { checkSupabaseConnection } from "@/lib/supabase/health";
import Link from "next/link";

/**
 * 管理トップ。
 *
 * admin は機能が多いため、4分類の大きなカードにまとめ、カードを押すと
 * 分類ページ（/menu/[key]）で一覧を表示する。
 *
 * center / vendor は使う画面を限定し、分類を挟まず直接リンクを並べる。
 */
export default async function Home() {
  const [health, user] = await Promise.all([
    checkSupabaseConnection(),
    getCurrentUser(),
  ]);
  const role = resolveUiRole(user);
  const usesDirectMenu = role === "vendor" || role === "center";
  const categories = usesDirectMenu ? [] : homeMenuCategories(role);
  const directLinks = usesDirectMenu ? homeNavLinks(role) : [];
  const title =
    role === "center"
      ? "サンプル市Aセンター"
      : role === "vendor"
        ? "現場メニュー"
        : "資材管理システム（開発中）";
  const description =
    role === "center"
      ? "オーダーの印刷と、センター・現場の在庫確認を行います。"
      : role === "vendor"
        ? "必要な操作を選んでください。"
        : "Next.js + Supabase（PostgreSQL）";

  return (
    <div className="min-h-full bg-zinc-50 px-4 py-10 font-sans sm:px-6 sm:py-16">
      <main className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-900">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          {description}
        </p>

        {role === "admin" && (
          <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-medium text-zinc-700">接続状態</h2>
            <p
              className={`mt-2 text-sm ${health.ok ? "text-green-700" : "text-red-700"}`}
            >
              {health.ok ? "● " : "× "}
              {health.message}
            </p>
          </section>
        )}

        {usesDirectMenu ? (
          <nav className="mt-8 grid gap-4">
            {directLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  link.variant === "primary"
                    ? "flex items-center justify-between rounded-xl bg-zinc-900 px-6 py-6 text-lg font-semibold text-white hover:bg-zinc-800"
                    : "flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-6 py-6 text-lg font-semibold text-zinc-900 shadow-sm hover:border-zinc-400 hover:shadow-md"
                }
              >
                <span>{link.label}</span>
                <span aria-hidden>→</span>
              </Link>
            ))}
          </nav>
        ) : categories.length === 0 ? (
          <p className="mt-8 rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            利用できるメニューがありません。管理者にお問い合わせください。
          </p>
        ) : (
          <nav className="mt-8 grid gap-4 sm:grid-cols-2">
            {categories.map((c) => (
              <Link
                key={c.key}
                href={`/menu/${c.key}`}
                className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-zinc-400 hover:shadow-md"
              >
                <span className="text-lg font-semibold text-zinc-900">
                  {c.title}
                </span>
                <span className="mt-1 text-sm text-zinc-600">
                  {c.description}
                </span>
                <span className="mt-4 text-sm font-medium text-zinc-500 group-hover:text-zinc-800">
                  {c.links.length} 件のメニュー →
                </span>
              </Link>
            ))}
          </nav>
        )}
      </main>
    </div>
  );
}
