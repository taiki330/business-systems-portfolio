import { DeleteProductButton } from "@/components/products/DeleteProductButton";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  canShowMasterWriteActions,
  resolveUiRole,
} from "@/lib/auth/ui-capabilities";
import { createClient } from "@/lib/supabase/server";
import type { Product } from "@/types/product";
import { ListSearchForm } from "@/components/ui/ListSearchForm";
import { fetchProductCategories } from "@/lib/products/fetch-categories";
import { orIlike, sanitizeSearchTerm } from "@/lib/search/list-filter";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; q?: string; category_id?: string }>;
};

/** 一覧表示用。埋め込んだ資材種別名を含む（PostgREST は単一/配列いずれも返しうる）。 */
type ProductListRow = Product & {
  product_categories: { name: string } | { name: string }[] | null;
};

function categoryName(
  raw: ProductListRow["product_categories"],
): string | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? (raw[0]?.name ?? null) : raw.name;
}

export default async function ProductsPage({ searchParams }: PageProps) {
  const {
    error: queryError,
    q: rawQuery,
    category_id: categoryFilter,
  } = await searchParams;
  const searchTerm = sanitizeSearchTerm(rawQuery);
  const user = await getCurrentUser();
  const showWriteActions = canShowMasterWriteActions(resolveUiRole(user));
  const supabase = await createClient();

  let listQuery = supabase
    .from("products")
    .select(
      "id, code, name, unit, category_id, lot_size, weight_kg, created_at, updated_at, product_categories(name)",
    )
    .order("code", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (searchTerm) {
    listQuery = listQuery.or(orIlike(searchTerm, ["name", "code"]));
  }
  // "none" は未分類（category_id が NULL）の絞り込み
  if (categoryFilter === "none") {
    listQuery = listQuery.is("category_id", null);
  } else if (categoryFilter) {
    listQuery = listQuery.eq("category_id", categoryFilter);
  }

  const [{ data, error }, { rows: categories }] = await Promise.all([
    listQuery,
    fetchProductCategories(),
  ]);

  const products = (data ?? []) as ProductListRow[];

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              商品マスタ
            </h1>
          </div>
          {showWriteActions && (
            <div className="flex gap-2">
            <Link
              href="/products/export"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              商品マスタCSV
            </Link>
            <Link
              href="/products/new"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              新規追加
            </Link>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <ListSearchForm
          action="/products"
          value={searchTerm}
          placeholder="資材名・コードの一部で検索"
          count={products.length}
        >
          <select
            name="category_id"
            defaultValue={categoryFilter ?? ""}
            aria-label="資材種別で絞り込む"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700"
          >
            <option value="">種別すべて</option>
            {categories
              .filter((c) => c.is_active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            <option value="none">未分類</option>
          </select>
        </ListSearchForm>

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

        {!error && products.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            商品がまだありません。「新規追加」から登録してください。
          </p>
        )}

        {!error && products.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">コード</th>
                  <th className="px-4 py-3 font-medium">名称</th>
                  <th className="px-4 py-3 font-medium">単位</th>
                  <th className="px-4 py-3 font-medium">分類</th>
                  <th className="px-4 py-3 font-medium">セット数</th>
                  <th className="px-4 py-3 font-medium">更新日時</th>
                  {showWriteActions && (
                    <th className="px-4 py-3 font-medium text-right">操作</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 font-mono text-zinc-700">
                      {p.code ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">{p.name}</td>
                    <td className="px-4 py-3 text-zinc-600">{p.unit ?? "—"}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {categoryName(p.product_categories) ?? (
                        <span className="text-zinc-400">未分類</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {p.lot_size ?? <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {new Date(p.updated_at).toLocaleString("ja-JP")}
                    </td>
                    {showWriteActions && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-4">
                          <Link
                            href={`/products/${p.id}/edit`}
                            className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                          >
                            編集
                          </Link>
                          <DeleteProductButton id={p.id} name={p.name} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-sm text-zinc-500">{products.length} 件</p>
      </main>
    </div>
  );
}
