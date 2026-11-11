import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { fetchLotSizeViolations } from "@/lib/plans/fetch-lot-size-status";
import { fetchProductOptions } from "@/lib/products/fetch-options";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{
    site_id?: string;
    product_id?: string;
    from?: string;
    to?: string;
    status?: string;
    violation?: string;
    pending?: string;
  }>;
};

const STATUS_LABELS: Record<string, string> = {
  requested: "依頼中",
  accepted: "受付済み",
  shipped: "出庫済み",
  cancelled: "キャンセル",
};

/**
 * 半端もん（セット数の倍数以外）の依頼確認ページ（admin 専用）。
 *
 * 半端もんの依頼を自動で拒否せず、確認・警告の対象として一覧表示する
 * （予定数量超過の確認 /plans/over と同方針）。
 */
export default async function LotSizePage({ searchParams }: PageProps) {
  const params = await searchParams;

  // 既定は「半端もんありのみ」。フィルタを明示指定した場合はその内容に従う。
  const violationOnly =
    params.violation === undefined ? true : params.violation === "1";
  const pendingOnly = params.pending === "1";

  const [{ rows, error }, sites, products] = await Promise.all([
    fetchLotSizeViolations({
      site_id: params.site_id || undefined,
      product_id: params.product_id || undefined,
      from: params.from || undefined,
      to: params.to || undefined,
      status: params.status || undefined,
      violation_only: violationOnly,
      pending_only: pendingOnly,
    }),
    fetchSiteOptions(),
    fetchProductOptions(),
  ]);

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            半端もんの確認
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            セット数の倍数以外（半端もん）で依頼されている資材を確認します。半端もんの依頼は自動で拒否されません。
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            読み込みエラー: {error.message}
          </p>
        )}

        <form
          method="GET"
          className="mb-6 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div>
            <label
              htmlFor="site_id"
              className="block text-xs font-medium text-zinc-600"
            >
              現場
            </label>
            <SearchableSelect
              id="site_id"
              name="site_id"
              defaultValue={params.site_id ?? ""}
              allowEmpty
              emptyLabel="すべて"
              placeholder="現場名の一部を入力"
              options={sites.map((s) => ({
                value: s.id,
                label: s.code ? `${s.code} ${s.name}` : s.name,
                keywords: s.code ?? undefined,
              }))}
            />
          </div>

          <div>
            <label
              htmlFor="product_id"
              className="block text-xs font-medium text-zinc-600"
            >
              商品
            </label>
            <SearchableSelect
              id="product_id"
              name="product_id"
              defaultValue={params.product_id ?? ""}
              allowEmpty
              emptyLabel="すべて"
              placeholder="資材名の一部を入力"
              options={products.map((p) => ({
                value: p.id,
                label: p.code ? `${p.code} ${p.name}` : p.name,
                keywords: p.code ?? undefined,
                group: p.category_name ?? null,
              }))}
            />
          </div>

          <div>
            <label
              htmlFor="from"
              className="block text-xs font-medium text-zinc-600"
            >
              依頼日（開始）
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={params.from ?? ""}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="to"
              className="block text-xs font-medium text-zinc-600"
            >
              依頼日（終了）
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={params.to ?? ""}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="status"
              className="block text-xs font-medium text-zinc-600"
            >
              依頼ステータス
            </label>
            <select
              id="status"
              name="status"
              defaultValue={params.status ?? ""}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">すべて</option>
              <option value="requested">依頼中</option>
              <option value="accepted">受付済み</option>
              <option value="shipped">出庫済み</option>
              <option value="cancelled">キャンセル</option>
            </select>
          </div>

          <label className="flex items-center gap-2 pt-5 text-sm text-zinc-700">
            <input
              type="checkbox"
              name="violation"
              value="1"
              defaultChecked={violationOnly}
              className="h-4 w-4 rounded border-zinc-300"
            />
            半端もんありのみ
          </label>

          <label className="flex items-center gap-2 pt-5 text-sm text-zinc-700">
            <input
              type="checkbox"
              name="pending"
              value="1"
              defaultChecked={pendingOnly}
              className="h-4 w-4 rounded border-zinc-300"
            />
            未処理のみ（依頼中・受付済み）
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              絞り込み
            </button>
          </div>
        </form>

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            該当する依頼はありません。
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">現場</th>
                  <th className="px-4 py-3 font-medium">商品</th>
                  <th className="px-4 py-3 text-right font-medium">セット数</th>
                  <th className="px-4 py-3 text-right font-medium">依頼数量</th>
                  <th className="px-4 py-3 font-medium">半端もん</th>
                  <th className="px-4 py-3 font-medium">依頼者</th>
                  <th className="px-4 py-3 font-medium">依頼日時</th>
                  <th className="px-4 py-3 font-medium">状態</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => (
                  <tr
                    key={r.request_id}
                    className={
                      r.is_lot_size_violation
                        ? "bg-amber-50/60"
                        : "hover:bg-zinc-50/80"
                    }
                  >
                    <td className="px-4 py-3 text-zinc-900">{r.site_name}</td>
                    <td className="px-4 py-3 text-zinc-900">
                      {r.product_code ? `${r.product_code} ` : ""}
                      {r.product_name}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-600">
                      {r.lot_size === null ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        <>
                          {r.lot_size}
                          {r.order_unit !== null && (
                            <span className="ml-1 text-xs text-zinc-400">
                              （{r.order_unit}単位）
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-zinc-900">
                      {r.quantity}
                    </td>
                    <td className="px-4 py-3">
                      {r.is_lot_size_violation ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                          半端もん
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {r.requester_label ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {new Date(r.requested_at).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {STATUS_LABELS[r.status] ?? r.status}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/requests/${r.request_id}`}
                        className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                      >
                        依頼詳細
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
