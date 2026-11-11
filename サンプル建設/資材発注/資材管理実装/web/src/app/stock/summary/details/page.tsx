import { requireAdmin } from "@/lib/auth/require-role";
import { fetchInventorySummaryDetails } from "@/lib/centers/fetch-center-summary";
import Link from "next/link";

type PageProps = { searchParams: Promise<{ center_id?: string; ownership?: string; storage_kind?: string }> };

function parseOwnership(value: string | undefined): "owned" | "leased" | "all" {
  return value === "owned" || value === "leased" ? value : "all";
}
function parseStorageKind(value: string | undefined): "center" | "site" | "all" {
  return value === "center" || value === "site" ? value : "all";
}
function quantity(value: number) {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
}

export default async function InventorySummaryDetailsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const sp = await searchParams;
  const ownership = parseOwnership(sp.ownership);
  const storageKind = parseStorageKind(sp.storage_kind);
  const { rows, centerName, error } = await fetchInventorySummaryDetails({
    centerId: sp.center_id?.trim() || undefined,
    ownership,
    storageKind,
  });
  const ownershipLabel = ownership === "owned" ? "自社材" : ownership === "leased" ? "リース材" : "自社材・リース材";
  const storageLabel = storageKind === "center" ? "センター保管分" : storageKind === "site" ? "現場配置分" : "センター・現場の合計";

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white"><div className="mx-auto max-w-6xl px-6 py-4"><Link href="/stock/summary" className="text-sm text-zinc-600 hover:text-zinc-900">← 総在庫サマリー</Link><h1 className="mt-1 text-xl font-semibold text-zinc-900">在庫の内訳</h1><p className="mt-1 text-sm text-zinc-700">{centerName ? `${centerName}／` : "全センター／"}{ownershipLabel}／{storageLabel}</p></div></header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">読み込みエラー: {error.message}</p> : rows.length === 0 ? <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">該当する在庫はありません。</p> : <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-700"><tr><th className="px-4 py-3 font-medium">商品コード</th><th className="px-4 py-3 font-medium">資材名</th><th className="px-4 py-3 text-right font-medium">自社材</th><th className="px-4 py-3 text-right font-medium">リース材</th><th className="px-4 py-3 text-right font-medium">合計</th></tr></thead><tbody className="divide-y divide-zinc-100">{rows.map((row) => <tr key={row.productId} className="hover:bg-zinc-50/80"><td className="px-4 py-3 font-mono text-xs text-zinc-700">{row.productCode ?? "—"}</td><td className="px-4 py-3 font-medium text-zinc-900">{row.productName}{row.productUnit && <span className="ml-1 text-xs font-normal text-zinc-600">（{row.productUnit}）</span>}</td><td className="px-4 py-3 text-right tabular-nums text-blue-900">{quantity(row.ownedQuantity)}</td><td className="px-4 py-3 text-right tabular-nums text-violet-900">{quantity(row.leasedQuantity)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-950">{quantity(row.totalQuantity)}</td></tr>)}</tbody></table></div>}
        {!error && <p className="mt-4 text-sm text-zinc-600">{rows.length} 商品</p>}
      </main>
    </div>
  );
}
