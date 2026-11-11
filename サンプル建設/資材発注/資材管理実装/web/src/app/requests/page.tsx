import { getCurrentUser } from "@/lib/auth/get-current-user";
import { resolveUiRole } from "@/lib/auth/ui-capabilities";
import { createClient } from "@/lib/supabase/server";
import {
  STOCK_REQUEST_STATUSES,
  STOCK_REQUEST_STATUS_LABEL,
  isStockRequestStatus,
  type StockRequestRow,
  type StockRequestStatus,
} from "@/types/stock-request";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ status?: string; error?: string }>;
};

const DEFAULT_STATUS: StockRequestStatus = "requested";

type RawRow = Omit<StockRequestRow, "sites" | "products"> & {
  sites:
    | { name: string; code: string | null }
    | { name: string; code: string | null }[]
    | null;
  products:
    | { name: string; code: string | null; unit: string | null }
    | { name: string; code: string | null; unit: string | null }[]
    | null;
};

function pickFirst<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function statusBadgeClass(status: StockRequestStatus): string {
  switch (status) {
    case "requested":
      return "bg-amber-100 text-amber-800";
    case "accepted":
      return "bg-blue-100 text-blue-800";
    case "shipped":
      return "bg-green-100 text-green-800";
    case "cancelled":
      return "bg-zinc-200 text-zinc-700";
  }
}

export default async function RequestsPage({ searchParams }: PageProps) {
  const { status: statusRaw, error: queryError } = await searchParams;
  const status: StockRequestStatus | "all" =
    statusRaw === "all"
      ? "all"
      : statusRaw && isStockRequestStatus(statusRaw)
        ? statusRaw
        : DEFAULT_STATUS;

  // 出庫依頼を作成できるのは vendor（現場）のみ。
  // 事務・センターは参照と受付/出庫の操作を行う（D-20260805-03）。
  const user = await getCurrentUser();
  const canCreateRequest = resolveUiRole(user) === "vendor";

  const supabase = await createClient();
  let query = supabase
    .from("stock_requests")
    .select(
      "id, site_id, product_id, quantity, status, requested_at, accepted_at, shipped_at, cancelled_at, note, sites(name, code), products(name, code, unit)",
    )
    .order("requested_at", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  const rows: StockRequestRow[] = (data ?? []).map((row) => {
    const raw = row as RawRow;
    return {
      id: raw.id,
      site_id: raw.site_id,
      product_id: raw.product_id,
      quantity: Number(raw.quantity),
      status: raw.status,
      requested_at: raw.requested_at,
      accepted_at: raw.accepted_at,
      shipped_at: raw.shipped_at,
      cancelled_at: raw.cancelled_at,
      note: raw.note,
      sites: pickFirst(raw.sites),
      products: pickFirst(raw.products),
    };
  });

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              出庫依頼
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              初期表示は「依頼中（requested）」。詳細画面で受付・出庫・キャンセルができます。
            </p>
          </div>
          {canCreateRequest && (
            <Link
              href="/requests/new"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              新規依頼
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {queryError && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(queryError)}
          </p>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">出庫依頼の読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
            <p className="mt-2 text-xs text-red-600">
              Supabase で 005_stock_requests.sql を実行してください。
            </p>
          </div>
        )}

        <nav className="mb-6 flex flex-wrap gap-2 text-sm">
          {(["all", ...STOCK_REQUEST_STATUSES] as const).map((s) => {
            const active = s === status;
            const label = s === "all" ? "すべて" : STOCK_REQUEST_STATUS_LABEL[s];
            const href = s === DEFAULT_STATUS ? "/requests" : `/requests?status=${s}`;
            return (
              <Link
                key={s}
                href={href}
                className={
                  active
                    ? "rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white"
                    : "rounded-lg border border-zinc-300 px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"
                }
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            {status === "all"
              ? canCreateRequest
                ? "出庫依頼がまだありません。「新規依頼」から登録してください。"
                : "出庫依頼がまだありません。"
              : `「${
                  status === "requested"
                    ? STOCK_REQUEST_STATUS_LABEL.requested
                    : STOCK_REQUEST_STATUS_LABEL[status as StockRequestStatus]
                }」の依頼はありません。`}
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">依頼日時</th>
                  <th className="px-4 py-3 font-medium">現場</th>
                  <th className="px-4 py-3 font-medium">商品</th>
                  <th className="px-4 py-3 font-medium text-right">数量</th>
                  <th className="px-4 py-3 font-medium">ステータス</th>
                  <th className="px-4 py-3 font-medium">備考</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-600">
                      {new Date(row.requested_at).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      {row.sites
                        ? row.sites.code
                          ? `${row.sites.code} — ${row.sites.name}`
                          : row.sites.name
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      {row.products
                        ? row.products.code
                          ? `${row.products.code} — ${row.products.name}`
                          : row.products.name
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-900">
                      {row.quantity}
                      {row.products?.unit ? (
                        <span className="ml-1 text-xs text-zinc-500">
                          {row.products.unit}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(row.status)}`}
                      >
                        {STOCK_REQUEST_STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-3 text-zinc-600">
                      {row.note ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/requests/${row.id}`}
                        className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                      >
                        詳細
                      </Link>
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
