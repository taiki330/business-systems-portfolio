import { fetchSiteProgressDetail } from "@/lib/sites/fetch-site-progress";
import {
  OWNERSHIP_LABELS,
  SITE_PROGRESS_FOCUS,
  SITE_PROGRESS_LABELS,
} from "@/types/site-progress";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
};

/**
 * 進捗記録の詳細（＝完工時レポート）。
 * 区分ごとに主役の数値を変えて表示する（組立完了・解体開始は出庫総数、解体完了は現場残）。
 */
export default async function SiteProgressDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { detail, error } = await fetchSiteProgressDetail(id);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <p className="text-red-700">読み込みエラー: {error.message}</p>
        <Link href="/stock/progress" className="mt-4 inline-block text-sm text-zinc-600">
          一覧へ戻る
        </Link>
      </div>
    );
  }
  if (!detail) notFound();

  const { event, items, baseline } = detail;
  const focus = SITE_PROGRESS_FOCUS[event.kind];
  const focusValue =
    focus.key === "shipped" ? event.totals.shipped : event.totals.siteQuantity;
  const shippedDiff = baseline
    ? event.totals.shipped - baseline.totals.shipped
    : null;

  const owned = items.filter((i) => i.ownership === "owned");
  const leased = items.filter((i) => i.ownership === "leased");

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link
            href="/stock/progress"
            className="text-sm text-zinc-500 hover:text-zinc-800"
          >
            ← 現場進捗一覧
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            {event.siteName}／{SITE_PROGRESS_LABELS[event.kind]}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            発生日 {event.occurredOn} ／ 記録{" "}
            {new Date(event.recordedAt).toLocaleString("ja-JP")}
            {event.recordedByName ? `（${event.recordedByName}）` : ""}
          </p>
          {event.note && (
            <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
              {event.note}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* 区分ごとの主役の数値 */}
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-6">
          <p className="text-sm text-zinc-500">{focus.label}</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums text-zinc-900">
            {focusValue}
          </p>
          <p className="mt-1 text-sm text-zinc-500">{focus.description}</p>

          {shippedDiff !== null && (
            <p
              className={
                shippedDiff === 0
                  ? "mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600"
                  : "mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
              }
            >
              組立完了時（{baseline?.occurredOn}）の出庫総数{" "}
              {baseline?.totals.shipped} と比べて{" "}
              {shippedDiff === 0
                ? "変わっていません。"
                : `${shippedDiff > 0 ? "+" : ""}${shippedDiff} 変動しています。`}
            </p>
          )}
        </div>

        {/* 合計 */}
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: "出庫総数", value: event.totals.shipped },
            { label: "通常返却", value: event.totals.returned },
            { label: "未返却", value: event.totals.outstanding, warn: true },
            { label: "過入庫", value: event.totals.overReturn, warn: true },
            { label: "現場残", value: event.totals.siteQuantity },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-3"
            >
              <p className="text-xs text-zinc-500">{c.label}</p>
              <p
                className={
                  c.warn && c.value > 0
                    ? "mt-1 text-xl font-semibold tabular-nums text-amber-700"
                    : "mt-1 text-xl font-semibold tabular-nums text-zinc-900"
                }
              >
                {c.value}
              </p>
            </div>
          ))}
        </div>

        <p className="mb-2 text-sm text-zinc-500">
          未返却数は「出庫総数 − 通常返却」で計算しています（過入庫は含みません）。
          現場残は記録時点で実際にその現場にあった数量です。
        </p>

        {[
          { title: "自社資材", rows: owned },
          { title: "リース資材", rows: leased },
        ].map((group) => (
          <section key={group.title} className="mb-8">
            <h2 className="mb-2 text-sm font-semibold text-zinc-800">
              {group.title}
              <span className="ml-2 font-normal text-zinc-500">
                {group.rows.length} 品目
              </span>
            </h2>
            {group.rows.length === 0 ? (
              <p className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-500">
                該当する資材はありません。
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                    <tr>
                      <th className="px-4 py-3 font-medium">資材</th>
                      <th className="px-4 py-3 font-medium">種別</th>
                      <th className="px-4 py-3 text-right font-medium">出庫</th>
                      <th className="px-4 py-3 text-right font-medium">返却</th>
                      <th className="px-4 py-3 text-right font-medium">未返却</th>
                      <th className="px-4 py-3 text-right font-medium">過入庫</th>
                      <th className="px-4 py-3 text-right font-medium">現場残</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {group.rows.map((i) => (
                      <tr
                        key={`${i.productId}-${i.ownership}`}
                        className="hover:bg-zinc-50/80"
                      >
                        <td className="px-4 py-3 text-zinc-900">
                          {i.productCode ? `${i.productCode} — ${i.productName}` : i.productName}
                          {i.productUnit && (
                            <span className="ml-1 text-xs text-zinc-500">
                              ({i.productUnit})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-600">
                          {i.categoryName ?? (
                            <span className="text-zinc-400">未分類</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                          {i.shippedQuantity}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                          {i.returnedQuantity}
                        </td>
                        <td
                          className={
                            i.outstandingQuantity > 0
                              ? "px-4 py-3 text-right font-semibold tabular-nums text-amber-700"
                              : "px-4 py-3 text-right tabular-nums text-zinc-700"
                          }
                        >
                          {i.outstandingQuantity}
                        </td>
                        <td
                          className={
                            i.overReturnQuantity > 0
                              ? "px-4 py-3 text-right font-semibold tabular-nums text-amber-700"
                              : "px-4 py-3 text-right tabular-nums text-zinc-400"
                          }
                        >
                          {i.overReturnQuantity}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-900">
                          {i.siteQuantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}

        <p className="text-xs text-zinc-500">
          {OWNERSHIP_LABELS.leased}
          資材には過入庫の仕組みがないため、リース分の過入庫は常に 0 で表示されます。
        </p>
      </main>
    </div>
  );
}
