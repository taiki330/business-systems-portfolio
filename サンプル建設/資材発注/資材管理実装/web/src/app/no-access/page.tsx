import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/get-current-user";

export const dynamic = "force-dynamic";

/**
 * A-7-app-3: app_users 未登録ユーザー(b) 用の停止画面。
 *
 * - 認証は通っているが、role / vendor_id が未設定のためアプリ機能を使えない状態。
 * - root layout が role=null のときに /no-access へリダイレクトする。
 * - 強制ログアウトはしない（案 ii）。ログアウトは本人操作（既存 /auth/signout POST）に任せる。
 * - 管理者が app_users.role を設定すると、次回アクセスから通常画面へ進める。
 *
 * 詳細設計: docs/13 §13-12-2 (b) / §13-12-5 / 会話履歴（A-7-app-3）
 */
export default async function NoAccessPage() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-full bg-zinc-50 px-6 py-16">
      <main className="mx-auto w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">
          アクセス権限がありません
        </h1>
        <p className="mt-3 text-sm text-zinc-700">
          ログインは成功していますが、まだ利用権限が設定されていません。
          管理者にユーザー設定の依頼をしてください。
        </p>

        {user && (
          <dl className="mt-6 grid grid-cols-3 gap-x-4 gap-y-2 rounded-lg border border-zinc-100 bg-zinc-50 p-4 text-xs">
            <dt className="text-zinc-500">表示名</dt>
            <dd className="col-span-2 text-zinc-900">
              {user.display_name ?? "（未設定）"}
            </dd>
            <dt className="text-zinc-500">メール</dt>
            <dd className="col-span-2 text-zinc-900">
              {user.email ?? "（不明）"}
            </dd>
            <dt className="text-zinc-500">ユーザーID</dt>
            <dd className="col-span-2 break-all font-mono text-[11px] text-zinc-700">
              {user.id}
            </dd>
          </dl>
        )}

        <div className="mt-8 flex flex-col gap-3">
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              ログアウト
            </button>
          </form>
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800"
          >
            /login へ戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
