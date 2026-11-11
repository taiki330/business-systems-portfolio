import { DeleteLeaseCompanyButton } from "@/components/leases/DeleteLeaseCompanyButton";
import { LeaseSectionNav } from "@/components/leases/LeaseSectionNav";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  canShowMasterWriteActions,
  resolveUiRole,
} from "@/lib/auth/ui-capabilities";
import { createClient } from "@/lib/supabase/server";
import type { LeaseCompany } from "@/types/lease-company";
import { ListSearchForm } from "@/components/ui/ListSearchForm";
import { orIlike, sanitizeSearchTerm } from "@/lib/search/list-filter";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; q?: string }>;
};

export default async function LeaseCompaniesPage({ searchParams }: PageProps) {
  const { error: queryError, q: rawQuery } = await searchParams;
  const searchTerm = sanitizeSearchTerm(rawQuery);
  const user = await getCurrentUser();
  const showWriteActions = canShowMasterWriteActions(resolveUiRole(user));
  const supabase = await createClient();

  let listQuery = supabase
    .from("lease_companies")
    .select("id, name, note, is_active, created_at, updated_at")
    .order("name", { ascending: true });
  if (searchTerm) {
    listQuery = listQuery.or(orIlike(searchTerm, ["name"]));
  }
  const { data, error } = await listQuery;

  const leaseCompanies = (data ?? []) as LeaseCompany[];

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              リース会社マスタ
            </h1>
          </div>
          {showWriteActions && (
            <Link
              href="/leases/companies/new"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              新規追加
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <LeaseSectionNav active="companies" />

        <ListSearchForm
          action="/leases/companies"
          value={searchTerm}
          placeholder="リース会社名の一部で検索"
          count={leaseCompanies.length}
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

        {!error && leaseCompanies.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            リース会社がまだありません。
            {showWriteActions && "「新規追加」から登録してください。"}
          </p>
        )}

        {!error && leaseCompanies.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">リース会社名</th>
                  <th className="px-4 py-3 font-medium">状態</th>
                  <th className="px-4 py-3 font-medium">備考</th>
                  <th className="px-4 py-3 font-medium">更新日時</th>
                  {showWriteActions && (
                    <th className="px-4 py-3 font-medium text-right">操作</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {leaseCompanies.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-900">{c.name}</td>
                    <td className="px-4 py-3">
                      {c.is_active ? (
                        <span className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">
                          有効
                        </span>
                      ) : (
                        <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                          無効
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {c.note ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {new Date(c.updated_at).toLocaleString("ja-JP")}
                    </td>
                    {showWriteActions && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-4">
                          <Link
                            href={`/leases/companies/${c.id}/edit`}
                            className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                          >
                            編集
                          </Link>
                          <DeleteLeaseCompanyButton id={c.id} name={c.name} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-sm text-zinc-500">{leaseCompanies.length} 件</p>
      </main>
    </div>
  );
}
