import { createClient } from "@/lib/supabase/server";
import { PaginationNav } from "@/components/ui/PaginationNav";
import { HISTORY_PAGE_SIZE, getPagination, parsePage } from "@/lib/pagination";
import { orIlike, sanitizeSearchTerm } from "@/lib/search/list-filter";
import { normalizeProductRef } from "@/lib/stock/normalize-product-ref";
import type { StockLedgerRow } from "@/types/stock-ledger";
import type { StockProductRef } from "@/types/stock";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ ok?: string; q?: string; page?: string }>;
};

type RawLedgerRow = {
  id: string;
  product_id: string;
  location: string;
  movement_type: "in" | "out";
  quantity: number;
  created_at: string;
  products: StockProductRef | StockProductRef[] | null;
};

const MOVEMENT_LABEL: Record<string, string> = {
  in: "入庫",
  out: "出庫",
};

export default async function StockLedgerPage({ searchParams }: PageProps) {
  const { ok, q: rawQuery, page: rawPage } = await searchParams;
  const searchTerm = sanitizeSearchTerm(rawQuery);
  const requestedPage = parsePage(rawPage);

  const supabase = await createClient();
  const { data: productData } = searchTerm
    ? await supabase.from("products").select("id").or(orIlike(searchTerm, ["code", "name"]))
    : { data: [] as { id: string }[] };
  const productIds = (productData ?? []).map((row) => row.id);
  const searchConditions = searchTerm
    ? [
        `location.ilike.%${searchTerm}%`,
        ...(productIds.length ? [`product_id.in.(${productIds.join(",")})`] : []),
      ]
    : [];

  let countQuery = supabase.from("stock_ledger").select("id", { count: "exact", head: true });
  if (searchConditions.length) countQuery = countQuery.or(searchConditions.join(","));
  const { count, error: countError } = await countQuery;
  const pagination = getPagination(requestedPage, count ?? 0, HISTORY_PAGE_SIZE);

  let query = supabase
    .from("stock_ledger")
    .select("id, product_id, location, movement_type, quantity, created_at, products(code, name)")
    .order("created_at", { ascending: false })
    .range(pagination.from, pagination.to);
  if (searchConditions.length) query = query.or(searchConditions.join(","));
  const { data, error: dataError } = await query;
  const error = countError ?? dataError;

  const rows: StockLedgerRow[] = (data ?? []).map((row) => {
    const raw = row as RawLedgerRow;
    const product = normalizeProductRef(raw.products);
    return {
      id: raw.id,
      product_id: raw.product_id,
      location: raw.location,
      movement_type: raw.movement_type,
      quantity: Number(raw.quantity),
      created_at: raw.created_at,
      products: product
        ? { code: product.code, name: product.name }
        : null,
    };
  });

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/stock" className="text-sm text-zinc-500 hover:text-zinc-800">
              在庫一覧
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              入出庫履歴
            </h1>
            <p className="mt-1 text-sm text-zinc-500">検索結果を新しい順に50件ずつ表示します。</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/history-archive"
              className="shrink-0 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              1年以上前をExcel出力
            </Link>
            <Link
              href="/stock"
              className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              入出庫登録
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {ok && (
          <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            入出庫を登録しました。
          </p>
        )}

        <form method="GET" action="/stock/ledger" className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="text"
            name="q"
            defaultValue={searchTerm}
            placeholder="商品名・商品コード・保管場所で検索"
            className="w-72 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">検索</button>
          {searchTerm && <Link href="/stock/ledger" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">クリア</Link>}
          {searchTerm && <span className="text-sm text-zinc-500">「{searchTerm}」で検索中（{count ?? 0} 件）</span>}
        </form>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">履歴の読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
            <p className="mt-2 text-xs text-red-600">
              Supabase で 004_stock_ledger.sql を実行してください。
            </p>
          </div>
        )}

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            入出庫履歴がありません。
            <Link href="/stock" className="ml-1 text-zinc-900 underline">
              入出庫登録
            </Link>
            から追加できます。
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">日時</th>
                  <th className="px-4 py-3 font-medium">種別</th>
                  <th className="px-4 py-3 font-medium">商品コード</th>
                  <th className="px-4 py-3 font-medium">商品名</th>
                  <th className="px-4 py-3 font-medium">保管場所</th>
                  <th className="px-4 py-3 font-medium text-right">数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-600">
                      {new Date(row.created_at).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.movement_type === "in"
                            ? "text-green-700"
                            : "text-red-700"
                        }
                      >
                        {MOVEMENT_LABEL[row.movement_type] ?? row.movement_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-700">
                      {row.products?.code ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      {row.products?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-600">
                      {row.location}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-zinc-900">
                      {row.quantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && (
          <PaginationNav
            pathname="/stock/ledger"
            page={pagination.currentPage}
            totalPages={pagination.totalPages}
            totalCount={count ?? 0}
            params={{ q: searchTerm || undefined }}
          />
        )}
      </main>
    </div>
  );
}
