import { fetchLeaseDueList } from "@/lib/leases/fetch-due-list";
import { LeaseSectionNav } from "@/components/leases/LeaseSectionNav";
import { LEASE_DUE_STATE_LABELS, type LeaseDueState } from "@/types/lease";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ overdue?: string }>;
};

const DUE_STYLES: Record<LeaseDueState, string> = {
  overdue: "bg-red-50 text-red-700",
  today: "bg-amber-50 text-amber-800",
  before: "bg-zinc-100 text-zinc-600",
  none: "bg-zinc-50 text-zinc-400",
};

/**
 * リース中一覧・期限超過一覧（Phase 3-6）。
 * 未返却数量がある借用分のみを表示する（要件定義書 §9 期限管理）。
 */
export default async function LeaseDuePage({ searchParams }: PageProps) {
  const { overdue } = await searchParams;
  const overdueOnly = overdue === "1";

  const { rows, error } = await fetchLeaseDueList({ overdueOnly });

  const overdueCount = rows.filter((r) => r.dueState === "overdue").length;
  const totalOutstanding = rows.reduce(
    (sum, row) => sum + row.returnObligationQuantity,
    0,
  );

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            返却期限・未返却リース
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            未返却数量が残っている商品を、期限の近い順に確認できます。
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <LeaseSectionNav active="due" />

        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            読み込みエラー: {error.message}
          </p>
        )}

        {!overdueOnly && overdueCount > 0 && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            返却期限を過ぎている借用が {overdueCount} 件あります。
          </p>
        )}

        <div className="mb-4 flex gap-2">
          <Link
            href="/leases/due"
            className={`rounded-lg border px-4 py-2 text-sm font-medium ${
              overdueOnly
                ? "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                : "border-zinc-900 bg-zinc-900 text-white"
            }`}
          >
            リース中すべて
          </Link>
          <Link
            href="/leases/due?overdue=1"
            className={`rounded-lg border px-4 py-2 text-sm font-medium ${
              overdueOnly
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            期限超過のみ
          </Link>
        </div>

        {!error && (
          <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
              <dt className="text-sm text-zinc-500">未返却の借用明細</dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-900">
                {rows.length}
                <span className="ml-1 text-sm font-normal">件</span>
              </dd>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
              <dt className="text-sm text-red-700">期限超過</dt>
              <dd className="mt-1 text-2xl font-semibold text-red-800">
                {overdueCount}
                <span className="ml-1 text-sm font-normal">件</span>
              </dd>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
              <dt className="text-sm text-amber-800">未返却数量 合計</dt>
              <dd className="mt-1 text-2xl font-semibold text-amber-950">
                {totalOutstanding}
              </dd>
            </div>
          </dl>
        )}

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            {overdueOnly
              ? "期限を超過している借用はありません。"
              : "未返却のリースはありません。"}
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">期限状態</th>
                  <th className="px-4 py-3 font-medium">返却期限</th>
                  <th className="px-4 py-3 font-medium">リース会社</th>
                  <th className="px-4 py-3 font-medium">商品</th>
                  <th className="px-4 py-3 font-medium">伝票番号</th>
                  <th className="px-4 py-3 font-medium">借用日</th>
                  <th className="px-4 py-3 text-right font-medium">借用数量</th>
                  <th className="px-4 py-3 text-right font-medium">受入済み</th>
                  <th className="px-4 py-3 text-right font-medium">返却済み</th>
                  <th className="px-4 py-3 text-right font-medium">未返却</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => (
                  <tr key={r.itemId} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${DUE_STYLES[r.dueState]}`}
                      >
                        {LEASE_DUE_STATE_LABELS[r.dueState]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      {r.returnDueDate ?? "未定"}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      {r.leaseCompanyName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      <Link
                        href={`/leases/batches/${r.batchId}`}
                        className="font-semibold text-blue-700 hover:text-blue-900 hover:underline"
                      >
                        {r.productCode ? `${r.productCode} ` : ""}
                        {r.productName}
                      </Link>
                      <span className="mt-1 block text-xs text-zinc-500">
                        クリックして借用詳細を表示
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {r.slipNumber ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{r.borrowedAt}</td>
                    <td className="px-4 py-3 text-right text-zinc-900">
                      {r.quantity}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-600">
                      {r.receivedQuantity}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-600">
                      {r.returnedQuantity}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-zinc-900">
                      {r.returnObligationQuantity}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/leases/batches/${r.batchId}`}
                        className="inline-block whitespace-nowrap rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                      >
                        詳細を見る →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-sm text-zinc-500">{rows.length} 件</p>
      </main>
    </div>
  );
}
