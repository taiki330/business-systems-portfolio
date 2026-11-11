import {
  approveStockAdjustment,
  rejectStockAdjustment,
} from "@/app/stock/adjustments/actions";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { resolveUiRole } from "@/lib/auth/ui-capabilities";
import { fetchAdjustmentRequests } from "@/lib/stock/fetch-adjustment-requests";
import {
  isStockAdjustmentStatus,
  STOCK_ADJUSTMENT_STATUS_LABELS,
  type StockAdjustmentStatus,
} from "@/types/stock-adjustment";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ status?: string; error?: string; ok?: string }>;
};

const FILTERS = [
  { value: "pending", label: "未処理" },
  { value: "approved", label: "承認済み" },
  { value: "rejected", label: "却下" },
  { value: "all", label: "すべて" },
];

const OK_MESSAGES: Record<string, string> = {
  requested: "申請しました。事務の承認後に在庫へ反映されます。",
  approved: "承認しました。在庫へ反映されています。",
  rejected: "却下しました。在庫は変更していません。",
};

export default async function StockAdjustmentsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filter =
    sp.status && FILTERS.some((f) => f.value === sp.status)
      ? sp.status
      : "pending";
  const status: StockAdjustmentStatus | undefined = isStockAdjustmentStatus(
    filter,
  )
    ? filter
    : undefined;

  const [{ rows, error }, user] = await Promise.all([
    fetchAdjustmentRequests(status),
    getCurrentUser(),
  ]);
  const role = resolveUiRole(user);
  const canDecide = role === "admin";
  const canRequest = role === "center" || role === "vendor";

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-start justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              在庫調整申請
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              実地で数えた数量との食い違いを申請します。承認されたときにのみ在庫へ反映されます。
            </p>
            <nav className="mt-4 flex gap-2">
              {FILTERS.map((f) => (
                <Link
                  key={f.value}
                  href={`/stock/adjustments?status=${f.value}`}
                  className={
                    f.value === filter
                      ? "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white"
                      : "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                  }
                >
                  {f.label}
                </Link>
              ))}
            </nav>
          </div>
          {canRequest && (
            <Link
              href="/stock/adjustments/new"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              調整を申請
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {sp.error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(sp.error)}
          </p>
        )}
        {sp.ok && OK_MESSAGES[sp.ok] && (
          <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {OK_MESSAGES[sp.ok]}
          </p>
        )}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">申請一覧の読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
          </div>
        )}

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            対象の申請はありません。
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[1200px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">保管場所</th>
                  <th className="px-4 py-3 font-medium">商品名</th>
                  <th className="px-4 py-3 text-right font-medium">申請時システム</th>
                  <th className="px-4 py-3 text-right font-medium">実測</th>
                  <th className="px-4 py-3 text-right font-medium">差分</th>
                  <th className="px-4 py-3 font-medium">状態</th>
                  <th className="px-4 py-3 font-medium">申請</th>
                  {canDecide && <th className="px-4 py-3 font-medium">処理</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-900">
                      {row.storageKind === "center"
                        ? "センター"
                        : (row.sites?.name ?? "(現場不明)")}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      {row.products
                        ? row.products.code
                          ? `${row.products.code} — ${row.products.name}`
                          : row.products.name
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-600">
                      {row.systemQuantity}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-600">
                      {row.countedQuantity}
                    </td>
                    <td
                      className={
                        row.delta > 0
                          ? "px-4 py-3 text-right font-semibold tabular-nums text-emerald-700"
                          : "px-4 py-3 text-right font-semibold tabular-nums text-red-700"
                      }
                    >
                      {row.delta > 0 ? `+${row.delta}` : row.delta}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.status === "pending"
                            ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                            : row.status === "approved"
                              ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                              : "rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600"
                        }
                      >
                        {STOCK_ADJUSTMENT_STATUS_LABELS[row.status]}
                      </span>
                      {row.decidedNote && (
                        <p className="mt-1 text-xs text-zinc-500">{row.decidedNote}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      <div>{new Date(row.requestedAt).toLocaleString("ja-JP")}</div>
                      <div className="text-xs">{row.requestedByName ?? "-"}</div>
                      {row.note && (
                        <div className="mt-1 text-xs text-zinc-600">{row.note}</div>
                      )}
                    </td>
                    {canDecide && (
                      <td className="px-4 py-3">
                        {row.status === "pending" ? (
                          <div className="flex items-center gap-2">
                            <form action={approveStockAdjustment} className="flex gap-2">
                              <input type="hidden" name="id" value={row.id} />
                              <input type="hidden" name="status" value={filter} />
                              <input
                                type="text"
                                name="decided_note"
                                placeholder="コメント（任意）"
                                className="w-32 rounded-lg border border-zinc-300 px-2 py-1 text-sm"
                              />
                              <button
                                type="submit"
                                className="whitespace-nowrap rounded-lg bg-zinc-900 px-3 py-1 text-sm font-medium text-white hover:bg-zinc-800"
                              >
                                承認
                              </button>
                            </form>
                            <form action={rejectStockAdjustment}>
                              <input type="hidden" name="id" value={row.id} />
                              <input type="hidden" name="status" value={filter} />
                              <button
                                type="submit"
                                className="whitespace-nowrap rounded-lg border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                              >
                                却下
                              </button>
                            </form>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-500">
                            {row.decidedAt
                              ? `${new Date(row.decidedAt).toLocaleString("ja-JP")} / ${row.decidedByName ?? "-"}`
                              : "-"}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && <p className="mt-4 text-sm text-zinc-500">{rows.length} 件</p>}
      </main>
    </div>
  );
}
