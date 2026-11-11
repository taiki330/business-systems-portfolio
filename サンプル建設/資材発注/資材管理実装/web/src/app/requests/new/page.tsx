import { createOrder } from "@/app/requests/actions";
import { OrderForm } from "@/components/requests/OrderForm";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { fetchProductOptionsForSite } from "@/lib/products/fetch-options-for-site";
import { fetchSiteProductPlanStatus } from "@/lib/plans/fetch-plans";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; site_id?: string }>;
};

type PastRequestRow = {
  product_id: string;
  quantity: number | string;
  requested_at: string;
};

export default async function NewRequestPage({ searchParams }: PageProps) {
  const { error, site_id: requestedSiteId } = await searchParams;
  const user = await getCurrentUser();
  const assignedSiteIds = user?.site_ids?.length
    ? user.site_ids
    : (user?.site_id ? [user.site_id] : []);

  if (assignedSiteIds.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <Link href="/requests" className="text-sm text-zinc-600 hover:text-zinc-900">
          ← 出庫依頼一覧
        </Link>
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          アカウントに現場が設定されていません。管理者にアカウントの現場設定を依頼してください。
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: assignedSites } = await supabase
    .from("sites")
    .select("id, name, code")
    .in("id", assignedSiteIds)
    .order("name");
  const siteId = assignedSiteIds.includes(requestedSiteId ?? "")
    ? requestedSiteId!
    : (assignedSites?.[0]?.id ?? assignedSiteIds[0]);
  const site = assignedSites?.find((row) => row.id === siteId);
  const [{ rows: planRows }, allProducts, { data: pastRequestData }] = await Promise.all([
    fetchSiteProductPlanStatus({ siteId }),
    fetchProductOptionsForSite(siteId),
    supabase
      .from("stock_requests")
      .select("product_id, quantity, requested_at")
      .eq("site_id", siteId)
      .order("requested_at", { ascending: false })
      .limit(200),
  ]);

  const plannedProductIds = new Set(planRows.map((r) => r.product_id));
  const productById = new Map(allProducts.map((product) => [product.id, product]));
  const pastProducts = [] as { id: string; lastRequestedAt: string; lastQuantity: number }[];
  const pastProductIds = new Set<string>();
  for (const request of (pastRequestData ?? []) as PastRequestRow[]) {
    // 予定資材は最初の一覧に出ているため、過去注文欄では重複させない。
    if (plannedProductIds.has(request.product_id) || pastProductIds.has(request.product_id)) continue;
    if (!productById.has(request.product_id)) continue;
    pastProductIds.add(request.product_id);
    pastProducts.push({
      id: request.product_id,
      lastRequestedAt: request.requested_at,
      lastQuantity: Number(request.quantity),
    });
    if (pastProducts.length === 20) break;
  }
  const pastProductRows = pastProducts.map((past) => ({
    ...productById.get(past.id)!,
    lastRequestedAt: past.lastRequestedAt,
    lastQuantity: past.lastQuantity,
  }));
  const catalogProducts = allProducts.filter(
    (product) => !plannedProductIds.has(product.id) && !pastProductIds.has(product.id),
  );

  return (
    <div className="min-h-full bg-zinc-50">
      {assignedSites && assignedSites.length > 1 && (
        <form method="get" className="mx-auto max-w-2xl px-6 pt-8">
          <label className="block text-sm font-medium text-zinc-700">
            オーダーする現場
            <span className="mt-1 flex gap-2">
              <select name="site_id" defaultValue={siteId} className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2">
                {assignedSites.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} — ${item.name}` : item.name}</option>)}
              </select>
              <button className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white">切り替え</button>
            </span>
          </label>
        </form>
      )}
      <OrderForm
        action={createOrder}
        siteId={siteId}
        siteName={site?.name ?? "(現場不明)"}
        planRows={planRows}
        pastProducts={pastProductRows}
        catalogProducts={catalogProducts}
        error={error ? decodeURIComponent(error) : undefined}
      />
    </div>
  );
}
