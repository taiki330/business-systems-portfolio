import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  canShowLeaseBatchAdminActions,
  resolveUiRole,
} from "@/lib/auth/ui-capabilities";
import { fetchLeaseBatches } from "@/lib/leases/fetch-batches";
import { LeaseSectionNav } from "@/components/leases/LeaseSectionNav";
import {
  LEASE_BATCH_STATUS_LABELS,
  LEASE_DELIVERY_KIND_LABELS,
  type LeaseBatchStatus,
} from "@/types/lease";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string; status?: string }>;
};

const STATUS_STYLES: Record<LeaseBatchStatus, string> = {
  draft: "bg-amber-50 text-amber-800",
  approved: "bg-blue-50 text-blue-800",
  receiving: "bg-blue-50 text-blue-800",
  received: "bg-green-50 text-green-800",
  closed: "bg-zinc-100 text-zinc-600",
  cancelled: "bg-zinc-100 text-zinc-500",
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "draft", label: "未承認" },
  { value: "approved", label: "受入待ち" },
  { value: "receiving", label: "一部受入" },
  { value: "received", label: "受入済み" },
  { value: "closed", label: "全量返却済み" },
  { value: "cancelled", label: "キャンセル" },
];

export default async function LeaseBatchesPage({ searchParams }: PageProps) {
  const { error: queryError, status } = await searchParams;

  const user = await getCurrentUser();
  const role = resolveUiRole(user);
  const showAdminActions = canShowLeaseBatchAdminActions(role);

  const { rows, error } = await fetchLeaseBatches({ status });

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              リース借用管理
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              事務が借用を登録・承認し、承認後にセンターが受入・出庫・返却を行います。
            </p>
          </div>
          {showAdminActions && (
            <Link
              href="/leases/batches/new"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              借用を登録
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <LeaseSectionNav active="batches" />

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

        <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="status"
              className="block text-xs font-medium text-zinc-600"
            >
              状態
            </label>
            <select
              id="status"
              name="status"
              defaultValue={status ?? ""}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            絞り込み
          </button>
        </form>

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            該当する借用がありません。
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="space-y-4">
            {rows.map((b) => (
              <article
                key={b.id}
                className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-zinc-900">
                        {b.lease_company_name ?? "（リース会社不明）"}
                      </h2>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[b.status]}`}
                      >
                        {LEASE_BATCH_STATUS_LABELS[b.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-600">
                      借用日 {b.borrowed_at}
                      <span className="mx-2 text-zinc-300">|</span>
                      伝票番号 {b.slip_number ?? "—"}
                      <span className="mx-2 text-zinc-300">|</span>
                      {LEASE_DELIVERY_KIND_LABELS[b.delivery_kind]}
                      {b.delivery_site_name ? `（${b.delivery_site_name}）` : ""}
                    </p>
                  </div>
                  <Link
                    href={`/leases/batches/${b.id}`}
                    className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                  >
                    借用詳細を見る →
                  </Link>
                </div>

                <div className="grid gap-5 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      借用商品（{b.item_count}件）
                    </h3>
                    <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                      {b.item_summaries.map((item, index) => (
                        <li
                          key={`${item.product_id}-${index}`}
                          className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm"
                        >
                          <span className="font-medium text-zinc-900">
                            {item.product_code && (
                              <span className="mr-2 font-mono text-xs text-zinc-500">
                                {item.product_code}
                              </span>
                            )}
                            {item.product_name}
                          </span>
                          <span className="shrink-0 font-semibold text-zinc-900">
                            {item.quantity} {item.product_unit ?? ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[420px]">
                    {[
                      ["借用合計", b.total_quantity],
                      ["受入済み", b.total_received],
                      ["返却済み", b.total_returned],
                      ["未返却", b.total_quantity - b.total_returned],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg bg-zinc-50 px-3 py-3 text-center">
                        <dt className="text-xs text-zinc-500">{label}</dt>
                        <dd className="mt-1 text-lg font-semibold text-zinc-900">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="mt-4 text-sm text-zinc-500">{rows.length} 件</p>
      </main>
    </div>
  );
}
