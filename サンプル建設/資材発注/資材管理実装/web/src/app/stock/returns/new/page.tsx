import { returnMaterialsFromSite } from "@/app/stock/returns/actions";
import { BatchReturnForm, type BatchReturnItem } from "@/components/stock/BatchReturnForm";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import { fetchStockBreakdown } from "@/lib/leases/fetch-stock-breakdown";
import Link from "next/link";

type Props = { searchParams: Promise<{ site_id?: string; error?: string }> };
export default async function NewStockReturnPage({ searchParams }: Props) {
  const { site_id: siteId = "", error } = await searchParams;
  const sites = await fetchSiteOptions();
  const selectedSite = sites.find((site) => site.id === siteId);
  if (!selectedSite) return <main className="mx-auto max-w-lg p-8"><Link href="/stock/returns" className="text-sm underline">← 返却履歴</Link><h1 className="mt-4 text-2xl font-semibold">返却する現場を選択</h1><form className="mt-6" action="/stock/returns/new"><select name="site_id" required className="w-full rounded border p-2 text-zinc-900"><option value="">現場を選択</option>{sites.map((site)=><option key={site.id} value={site.id}>{site.code ? `${site.code} — ` : ""}{site.name}</option>)}</select><button className="mt-4 rounded bg-zinc-900 px-4 py-2 text-white">資材一覧を表示</button></form></main>;
  const { products, error: loadError } = await fetchStockBreakdown({ siteId, storageKind: "site" });
  const items: BatchReturnItem[] = products.flatMap((product) => product.details.map((detail, index) => ({ key: `${product.productId}:${detail.ownership}:${detail.leaseBatchItemId ?? index}`, ownership: detail.ownership, productId: product.productId, leaseBatchItemId: detail.leaseBatchItemId, code: product.productCode, name: product.productName, unit: product.productUnit, quantity: detail.quantity, detail: detail.ownership === "leased" ? `${detail.leaseCompanyName ?? "リース会社未設定"}${detail.returnDueDate ? ` / 返却期限: ${detail.returnDueDate}` : ""}` : null })));
  if (loadError) return <main className="p-8 text-red-700">読み込みエラー: {loadError.message}</main>;
  return <BatchReturnForm action={returnMaterialsFromSite} siteId={siteId} siteName={selectedSite.name} items={items} error={error ? decodeURIComponent(error) : undefined} />;
}
