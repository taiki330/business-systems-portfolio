import { getCurrentUser } from "@/lib/auth/get-current-user";
import { resolveUiRole } from "@/lib/auth/ui-capabilities";
import { SiteFilterForm } from "@/components/ui/SiteFilterForm";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import { fetchSiteProgressEvents } from "@/lib/sites/fetch-site-progress";
import { SITE_PROGRESS_LABELS } from "@/types/site-progress";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ site_id?: string }>;
};

/** 現場進捗の記録一覧。記録は事務のみ、閲覧は事務とセンター。 */
export default async function SiteProgressPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const selectedSiteId = sp.site_id?.trim() || "";

  const [{ rows, error }, user, sites] = await Promise.all([
    fetchSiteProgressEvents(selectedSiteId || undefined),
    getCurrentUser(),
    fetchSiteOptions(),
  ]);
  const canRecord = resolveUiRole(user) === "admin";
  const exportHref = selectedSiteId
    ? `/stock/progress/export?site_id=${encodeURIComponent(selectedSiteId)}`
    : "/stock/progress/export";

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-start justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">現場進捗</h1>
            <p className="mt-1 text-sm text-zinc-500">
              組立完了・解体開始・解体完了（完工）の記録です。各記録はその時点の数量を保存しているため、あとから返却が動いても内容は変わりません。
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={exportHref}
              className="whitespace-nowrap rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Excel出力
            </Link>
            <Link
              href="/stock/outstanding"
              className="whitespace-nowrap rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              未返却資材一覧
            </Link>
            {canRecord && (
              <Link
                href="/stock/progress/new"
                className="whitespace-nowrap rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                進捗を記録
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <SiteFilterForm
          action="/stock/progress"
          sites={sites}
          value={selectedSiteId}
          count={error ? undefined : rows.length}
        />

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">進捗の読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
          </div>
        )}

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            進捗の記録がまだありません。
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">現場</th>
                  <th className="px-4 py-3 font-medium">区分</th>
                  <th className="px-4 py-3 font-medium">発生日</th>
                  <th className="px-4 py-3 text-right font-medium">出庫総数</th>
                  <th className="px-4 py-3 text-right font-medium">返却</th>
                  <th className="px-4 py-3 text-right font-medium">未返却</th>
                  <th className="px-4 py-3 text-right font-medium">現場残</th>
                  <th className="px-4 py-3 font-medium">記録</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3">
                      <Link
                        href={`/leases/stock?storage_kind=site&site_id=${encodeURIComponent(row.siteId)}`}
                        className="font-medium text-blue-700 hover:text-blue-900 hover:underline"
                        title={`${row.siteName}の資材を見る`}
                      >
                        {row.siteName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.kind === "dismantle_completed"
                            ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                            : "rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700"
                        }
                      >
                        {SITE_PROGRESS_LABELS[row.kind]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{row.occurredOn}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                      {row.totals.shipped}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                      {row.totals.returned}
                    </td>
                    <td
                      className={
                        row.totals.outstanding > 0
                          ? "px-4 py-3 text-right font-semibold tabular-nums text-amber-700"
                          : "px-4 py-3 text-right tabular-nums text-zinc-700"
                      }
                    >
                      {row.totals.outstanding}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                      {row.totals.siteQuantity}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      <div>{new Date(row.recordedAt).toLocaleString("ja-JP")}</div>
                      <div className="text-xs">{row.recordedByName ?? "-"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/stock/progress/${row.id}`}
                        className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                      >
                        レポート
                      </Link>
                    </td>
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
