import { DeleteSupplierButton } from "@/components/purchases/DeleteSupplierButton";
import { ListSearchForm } from "@/components/ui/ListSearchForm";
import { fetchSuppliers } from "@/lib/purchases/fetch-suppliers";
import { sanitizeSearchTerm } from "@/lib/search/list-filter";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; q?: string }>;
};

/** 仕入先マスタ（事務のみ）。 */
export default async function SuppliersPage({ searchParams }: PageProps) {
  const { error: queryError, q: rawQuery } = await searchParams;
  const searchTerm = sanitizeSearchTerm(rawQuery);
  const { rows, error } = await fetchSuppliers(searchTerm || undefined);

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/purchases" className="text-sm text-zinc-500 hover:text-zinc-800">
              ← 仕入れ管理
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">仕入先マスタ</h1>
            <p className="mt-1 text-sm text-zinc-500">
              資材の購入先です。リース会社から購入する場合も、ここに仕入先として登録してください。
            </p>
          </div>
          <Link
            href="/purchases/suppliers/new"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            新規追加
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {queryError && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(queryError)}
          </p>
        )}
        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            読み込みに失敗しました: {error.message}
          </p>
        )}

        <ListSearchForm
          action="/purchases/suppliers"
          value={searchTerm}
          placeholder="仕入先名の一部で検索"
          count={rows.length}
        />

        {rows.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            {searchTerm
              ? "該当する仕入先がありません。"
              : "仕入先がまだ登録されていません。「新規追加」から登録してください。"}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">仕入先名</th>
                  <th className="px-4 py-3 font-medium">備考</th>
                  <th className="px-4 py-3 font-medium">状態</th>
                  <th className="px-4 py-3 font-medium">更新日時</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-900">{row.name}</td>
                    <td className="px-4 py-3 text-zinc-600">{row.note ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.is_active
                            ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                            : "rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600"
                        }
                      >
                        {row.is_active ? "有効" : "無効"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {new Date(row.updated_at).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/purchases/suppliers/${row.id}/edit`}
                          className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                        >
                          編集
                        </Link>
                        <DeleteSupplierButton id={row.id} name={row.name} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
