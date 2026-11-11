import { requestStockAdjustment } from "@/app/stock/adjustments/actions";
import { StockAdjustmentRequestForm } from "@/components/stock/StockAdjustmentRequestForm";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { resolveUiRole } from "@/lib/auth/ui-capabilities";
import { fetchProductOptions } from "@/lib/products/fetch-options";
import { createClient } from "@/lib/supabase/server";
import type { AdjustmentLocationOption } from "@/types/stock-adjustment";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; site_id?: string }>;
};

type StockRow = { product_id: string; location: string; quantity: number };

/**
 * 在庫調整の申請フォーム。
 *
 * vendor は割り当てられた現場のうち選択中の1現場に固定する。
 * center は「センター（倉庫）＋全現場」から選ぶ
 * （センターの在庫調整は vendor には申請させない）。
 */
export default async function NewStockAdjustmentPage({ searchParams }: PageProps) {
  const { error: queryError, site_id: requestedSiteId } = await searchParams;
  const user = await getCurrentUser();
  const role = resolveUiRole(user);
  const supabase = await createClient();

  const assignedSiteIds = user?.site_ids?.length ? user.site_ids : (user?.site_id ? [user.site_id] : []);
  if (role === "vendor" && assignedSiteIds.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900">
          ← ホーム
        </Link>
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          アカウントに現場が設定されていません。管理者に設定を依頼してください。
        </p>
      </div>
    );
  }

  const [products, sitesResult, stockResult] = await Promise.all([
    fetchProductOptions(),
    role === "vendor"
      ? supabase.from("sites").select("id, name").in("id", assignedSiteIds).order("name")
      : supabase.from("sites").select("id, name").order("name"),
    supabase.from("stock_items").select("product_id, location, quantity"),
  ]);

  const stockMap: Record<string, number> = {};
  for (const r of (stockResult.data ?? []) as StockRow[]) {
    stockMap[`${r.product_id}|${r.location}`] = Number(r.quantity);
  }

  const locations: AdjustmentLocationOption[] = [];
  let lockedLocation: AdjustmentLocationOption | undefined;
  const vendorSites = role === "vendor"
    ? ((sitesResult.data ?? []) as { id: string; name: string }[])
    : [];

  if (role === "vendor") {
    const siteId = assignedSiteIds.includes(requestedSiteId ?? "") ? requestedSiteId! : (vendorSites[0]?.id ?? assignedSiteIds[0]);
    const site = vendorSites.find((row) => row.id === siteId);
    lockedLocation = { value: siteId, label: `現場: ${site?.name ?? "不明"}` };
  } else {
    if (role === "center") {
      locations.push({ value: "center", label: "センター（倉庫）" });
    }
    for (const s of (sitesResult.data ?? []) as { id: string; name: string }[]) {
      locations.push({ value: s.id, label: `現場: ${s.name}` });
    }
  }

  return (
    <div className="min-h-full bg-zinc-50">
      {role === "vendor" && vendorSites.length > 1 && (
        <form method="get" className="mx-auto max-w-lg px-6 pt-8"><label className="block text-sm font-medium">申請する現場<span className="mt-1 flex gap-2"><select name="site_id" defaultValue={lockedLocation?.value} className="min-w-0 flex-1 rounded-lg border px-3 py-2">{vendorSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select><button className="rounded-lg border px-3 py-2 text-sm">切り替え</button></span></label></form>
      )}
      <StockAdjustmentRequestForm
        action={requestStockAdjustment}
        products={products}
        locations={locations}
        lockedLocation={lockedLocation}
        stockMap={stockMap}
        error={queryError ? decodeURIComponent(queryError) : undefined}
      />
    </div>
  );
}
