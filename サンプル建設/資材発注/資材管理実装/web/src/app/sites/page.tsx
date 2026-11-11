import { DeleteSiteButton } from "@/components/sites/DeleteSiteButton";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  canShowMasterWriteActions,
  resolveUiRole,
} from "@/lib/auth/ui-capabilities";
import { createClient } from "@/lib/supabase/server";
import type { Site } from "@/types/site";
import { ListSearchForm } from "@/components/ui/ListSearchForm";
import { orIlike, sanitizeSearchTerm } from "@/lib/search/list-filter";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; q?: string }>;
};

export default async function SitesPage({ searchParams }: PageProps) {
  const { error: queryError, q: rawQuery } = await searchParams;
  const searchTerm = sanitizeSearchTerm(rawQuery);
  const user = await getCurrentUser();
  const showWriteActions = canShowMasterWriteActions(resolveUiRole(user));
  const supabase = await createClient();

  let listQuery = supabase
    .from("sites")
    .select("id, code, name, address, prime_contractor_id, slip_site_number, center_id, allow_partial_lot_default, created_at, updated_at")
    .order("code", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (searchTerm) {
    listQuery = listQuery.or(orIlike(searchTerm, ["name", "code"]));
  }
  const { data, error } = await listQuery;

  const sites: Site[] = data ?? [];

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              現場マスタ
            </h1>
          </div>
          {showWriteActions && (
            <Link
              href="/sites/new"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              新規追加
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <ListSearchForm
          action="/sites"
          value={searchTerm}
          placeholder="現場名・コードの一部で検索"
          count={sites.length}
        />

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

        {!error && sites.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            現場がまだありません。「新規追加」から登録してください。
          </p>
        )}

        {!error && sites.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">コード</th>
                  <th className="px-4 py-3 font-medium">現場名</th>
                  <th className="px-4 py-3 font-medium">住所</th>
                  <th className="px-4 py-3 font-medium">更新日時</th>
                  {showWriteActions && (
                    <th className="px-4 py-3 font-medium text-right">操作</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sites.map((s) => (
                  <tr key={s.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 font-mono text-zinc-700">
                      {s.code ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">{s.name}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-zinc-600">
                      {s.address ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {new Date(s.updated_at).toLocaleString("ja-JP")}
                    </td>
                    {showWriteActions && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-4">
                          <Link
                            href={`/sites/${s.id}/products`}
                            className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                          >
                            商品紐づけ
                          </Link>
                          <Link
                            href={`/sites/${s.id}/edit`}
                            className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                          >
                            編集
                          </Link>
                          <DeleteSiteButton id={s.id} name={s.name} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-sm text-zinc-500">{sites.length} 件</p>
      </main>
    </div>
  );
}
