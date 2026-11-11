import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/get-current-user";

export const dynamic = "force-dynamic";

/**
 * A-7-app-1: 403（権限不足）画面。
 *
 * - vendor が internal 専用画面にアクセスしたときに root layout から redirect される。
 * - 強制ログアウトはしない。誤って踏んだ場合に元の役割で別画面に戻れるよう導線を残す。
 * - (b) 未登録ユーザーは A-7-app-3 で /no-access へ寄せ済み（こちらには来ない想定）。
 *
 * 詳細設計: docs/13 §2 / §13-12 / 会話履歴（A-7-app-1 / D1 = 403）
 */
export default async function ForbiddenPage() {
  const user = await getCurrentUser();

  const role = user?.role ?? null;
  const backHref = role === "vendor" ? "/vendor/stock" : "/";

  return (
    <div className="min-h-full bg-zinc-50 px-6 py-16">
      <main className="mx-auto w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-red-600">
          403 Forbidden
        </p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-900">
          この画面にはアクセスできません
        </h1>
        <p className="mt-3 text-sm text-zinc-700">
          現在のロールではこの操作が許可されていません。
          管理者にお問い合わせください。
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
            <dt className="text-zinc-500">ロール</dt>
            <dd className="col-span-2 text-zinc-900">
              {role === "internal"
                ? "内部"
                : role === "admin"
                  ? "事務"
                  : role === "center"
                    ? "サンプル市Aセンター"
                : role === "vendor"
                  ? "業者"
                  : "（未登録）"}
            </dd>
          </dl>
        )}

        <div className="mt-8 flex flex-col gap-3">
          <Link
            href={backHref}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800"
          >
            {role === "vendor" ? "倉庫在庫へ戻る" : "ホームへ戻る"}
          </Link>
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              ログアウト
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
