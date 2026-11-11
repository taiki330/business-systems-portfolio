import { requireAdmin } from "@/lib/auth/require-role";
import { fetchInventorySummary } from "@/lib/centers/fetch-center-summary";
import Link from "next/link";

function quantity(value: number) {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
}

function detailsHref(options: {
  centerId?: string;
  ownership?: "owned" | "leased" | "all";
  storageKind?: "center" | "site" | "all";
}) {
  const query = new URLSearchParams();
  if (options.centerId) query.set("center_id", options.centerId);
  if (options.ownership && options.ownership !== "all") query.set("ownership", options.ownership);
  if (options.storageKind && options.storageKind !== "all") query.set("storage_kind", options.storageKind);
  const suffix = query.toString();
  return `/stock/summary/details${suffix ? `?${suffix}` : ""}`;
}

export default async function InventorySummaryPage() {
  await requireAdmin();
  const { summary, error } = await fetchInventorySummary();

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-3 px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900">ホーム</Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">総在庫サマリー</h1>
            <p className="mt-1 text-sm text-zinc-700">自社材とリース材を分けて集計し、センター・現場を含む現在の総数を確認します。</p>
          </div>
          <Link href="/leases/stock" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">リース在庫の詳細</Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">在庫の集計に失敗しました: {error.message}</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 shadow-sm"><dt className="text-sm font-medium text-blue-800">総保有数（自社材）</dt><dd className="mt-1 text-3xl font-semibold tabular-nums text-blue-950"><Link href={detailsHref({ ownership: "owned" })} className="underline decoration-blue-300 underline-offset-4 hover:text-blue-700" title="商品別の内訳を見る">{quantity(summary.ownedTotal)}</Link></dd><p className="mt-1 text-xs text-blue-800">センター {quantity(summary.ownedAtCenter)} ／ 現場貸出中 {quantity(summary.ownedAtSites)}</p></div>
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-5 py-4 shadow-sm"><dt className="text-sm font-medium text-violet-800">リース借入数</dt><dd className="mt-1 text-3xl font-semibold tabular-nums text-violet-950"><Link href={detailsHref({ ownership: "leased" })} className="underline decoration-violet-300 underline-offset-4 hover:text-violet-700" title="商品別の内訳を見る">{quantity(summary.leasedTotal)}</Link></dd><p className="mt-1 text-xs text-violet-800">センター {quantity(summary.leasedAtCenter)} ／ 現場配置中 {quantity(summary.leasedAtSites)}</p></div>
              <div className="rounded-xl border border-zinc-300 bg-white px-5 py-4 shadow-sm"><dt className="text-sm font-medium text-zinc-800">総数</dt><dd className="mt-1 text-3xl font-semibold tabular-nums text-zinc-950"><Link href={detailsHref({})} className="underline decoration-zinc-300 underline-offset-4 hover:text-zinc-700" title="商品別の内訳を見る">{quantity(summary.total)}</Link></dd><p className="mt-1 text-xs text-zinc-700">自社保有数 ＋ リース借入数</p></div>
            </dl>

            <section className="mt-8 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-5 py-4"><h2 className="font-semibold text-zinc-900">センター別内訳</h2><p className="mt-1 text-sm text-zinc-700">各センターと、そのセンターに紐づく現場の数量を合算しています。</p></div>
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-700"><tr><th className="px-4 py-3 font-medium">センター</th><th className="px-4 py-3 text-right font-medium">自社：センター</th><th className="px-4 py-3 text-right font-medium">自社：現場</th><th className="px-4 py-3 text-right font-medium">自社保有数</th><th className="px-4 py-3 text-right font-medium">リース：センター</th><th className="px-4 py-3 text-right font-medium">リース：現場</th><th className="px-4 py-3 text-right font-medium">リース借入数</th><th className="px-4 py-3 text-right font-medium">総数</th></tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  {summary.centers.map((center) => <tr key={center.centerId} className="hover:bg-zinc-50/80"><td className="px-4 py-3 font-medium text-zinc-900">{center.centerName}<span className="ml-2 font-mono text-xs font-normal text-zinc-600">{center.centerCode}</span></td><td className="px-4 py-3 text-right tabular-nums"><Link href={detailsHref({ centerId: center.centerId, ownership: "owned", storageKind: "center" })} className="text-blue-800 underline decoration-blue-300 underline-offset-2 hover:text-blue-950">{quantity(center.ownedAtCenter)}</Link></td><td className="px-4 py-3 text-right tabular-nums"><Link href={detailsHref({ centerId: center.centerId, ownership: "owned", storageKind: "site" })} className="text-blue-800 underline decoration-blue-300 underline-offset-2 hover:text-blue-950">{quantity(center.ownedAtSites)}</Link></td><td className="px-4 py-3 text-right font-medium tabular-nums text-blue-900"><Link href={detailsHref({ centerId: center.centerId, ownership: "owned" })} className="underline decoration-blue-300 underline-offset-2 hover:text-blue-950">{quantity(center.ownedTotal)}</Link></td><td className="px-4 py-3 text-right tabular-nums"><Link href={detailsHref({ centerId: center.centerId, ownership: "leased", storageKind: "center" })} className="text-violet-800 underline decoration-violet-300 underline-offset-2 hover:text-violet-950">{quantity(center.leasedAtCenter)}</Link></td><td className="px-4 py-3 text-right tabular-nums"><Link href={detailsHref({ centerId: center.centerId, ownership: "leased", storageKind: "site" })} className="text-violet-800 underline decoration-violet-300 underline-offset-2 hover:text-violet-950">{quantity(center.leasedAtSites)}</Link></td><td className="px-4 py-3 text-right font-medium tabular-nums text-violet-900"><Link href={detailsHref({ centerId: center.centerId, ownership: "leased" })} className="underline decoration-violet-300 underline-offset-2 hover:text-violet-950">{quantity(center.leasedTotal)}</Link></td><td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-950"><Link href={detailsHref({ centerId: center.centerId })} className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-700">{quantity(center.total)}</Link></td></tr>)}
                </tbody>
              </table>
            </section>
            {summary.unassignedTotal > 0 && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">センターに紐づかない在庫が {quantity(summary.unassignedTotal)} あります。既存データの地域割当を確認してください。</p>}
          </>
        )}
      </main>
    </div>
  );
}
