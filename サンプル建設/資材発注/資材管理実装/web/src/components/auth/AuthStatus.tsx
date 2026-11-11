import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import type { AppUserRole } from "@/types/app-user";

function roleLabel(role: AppUserRole | null): string {
  if (role === "admin" || role === "internal") return "事務";
  if (role === "center") return "センター";
  if (role === "vendor") return "業者";
  return "未登録";
}

/**
 * ヘッダ右に表示する認証状態。
 * - 未認証: 「ログイン」リンク
 * - 認証済み: 表示名（or メール）＋ロール＋ログアウトボタン
 *
 * Server Component。anon 経路でも壊れないように getCurrentUser() は null を許容する。
 */
export default async function AuthStatus() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <Link
        href="/login"
        className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
      >
        ログイン
      </Link>
    );
  }

  const label = user.display_name ?? user.email ?? "ユーザー";

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-zinc-700">
        {label}
        <span className="ml-1 text-zinc-500">（{roleLabel(user.role)}）</span>
      </span>
      <form action="/auth/signout" method="POST">
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
        >
          ログアウト
        </button>
      </form>
    </div>
  );
}
