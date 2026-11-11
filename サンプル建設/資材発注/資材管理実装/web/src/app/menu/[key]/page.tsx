import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  homeMenuCategory,
  isMenuCategoryKey,
  resolveUiRole,
} from "@/lib/auth/ui-capabilities";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ key: string }>;
};

/**
 * 分類ページ。トップの4カードから遷移し、その分類に属する既存メニューを一覧表示する。
 * 表示するのは homeMenuCategory がロール別に返すリンクのみ（利用可能な項目だけ）。
 * URL・権限・機能は変更しない（既存メニューへのリンク集約のみ）。
 */
export default async function MenuCategoryPage({ params }: PageProps) {
  const { key } = await params;
  if (!isMenuCategoryKey(key)) notFound();

  const user = await getCurrentUser();
  const role = resolveUiRole(user);
  const category = homeMenuCategory(role, key);

  // そのロールでこの分類に使える項目が無い場合は 404（存在しない導線を見せない）
  if (!category) notFound();

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ← ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            {category.title}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{category.description}</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <nav className="grid gap-3 sm:grid-cols-2">
          {category.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex h-12 items-center justify-between rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              <span>{link.label}</span>
              <span className="text-zinc-400">→</span>
            </Link>
          ))}
        </nav>

        <div className="mt-8">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            ← ホームに戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
