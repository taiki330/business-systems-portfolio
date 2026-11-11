import { getCurrentUser } from "@/lib/auth/get-current-user";
import { DeleteUserButton } from "@/components/users/DeleteUserButton";
import { fetchAppUsers } from "@/lib/users/fetch-users";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string; link?: string }>;
};

function okMessage(ok: string | undefined): string | null {
  if (ok === "created") return "アカウントを発行し、招待メールを送信しました。";
  if (ok === "updated") return "ユーザーを更新しました。";
  if (ok === "deleted") return "アカウントを削除しました。";
  if (ok === "link_generated") return "アカウントを発行しました。招待リンクを本人に伝えてください。";
  return null;
}

export default async function UsersPage({ searchParams }: PageProps) {
  const { error: queryError, ok, link } = await searchParams;
  const [currentUser, { rows, error }] = await Promise.all([
    getCurrentUser(),
    fetchAppUsers(),
  ]);
  const okText = okMessage(ok);
  const generatedLink = ok === "link_generated" ? link : undefined;

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              ユーザー管理
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              ログインを発行し、利用できる現場を1つ以上割り当てます。
            </p>
          </div>
          <Link
            href="/users/new"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            アカウントを発行
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {okText && (
          <p className="mb-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {okText}
          </p>
        )}

        {generatedLink && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-800">
              このリンクは今だけ表示されます。コピーしてLINE等で本人に送ってください。
            </p>
            <input
              type="text"
              readOnly
              value={generatedLink}
              className="mt-2 w-full rounded border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-zinc-800"
            />
          </div>
        )}

        {queryError && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(queryError)}
          </p>
        )}

        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            読み込みエラー: {error.message}
          </p>
        )}

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            登録済みユーザーがいません。「アカウントを発行」から追加してください。
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">メールアドレス</th>
                  <th className="px-4 py-3 font-medium">表示名</th>
                  <th className="px-4 py-3 font-medium">役割</th>
                  <th className="px-4 py-3 font-medium">現場</th>
                  <th className="px-4 py-3 font-medium">更新日時</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-900">
                      {u.email ?? "-"}
                      {currentUser?.id === u.id && (
                        <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                          自分
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {u.display_name ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {u.role === "vendor"
                        ? "現場"
                        : u.role === "center"
                          ? `center${u.center_name ? `（${u.center_name}）` : ""}`
                          : "admin(事務)"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {u.role === "center"
                        ? (u.center_name ?? "-")
                        : u.site_names?.length
                          ? u.site_names.join("、")
                          : (u.site_name ?? "-")}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {new Date(u.updated_at).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-4">
                        <Link
                          href={`/users/${u.id}/edit`}
                          className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                        >
                          編集
                        </Link>
                        {currentUser?.id !== u.id && (
                          <DeleteUserButton id={u.id} email={u.email} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && (
          <p className="mt-4 text-sm text-zinc-500">{rows.length} 件</p>
        )}
      </main>
    </div>
  );
}
