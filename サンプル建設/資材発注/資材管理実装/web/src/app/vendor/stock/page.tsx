import { getCurrentUser } from "@/lib/auth/get-current-user";
import { shouldPageCallNotFound } from "@/lib/auth/access-rules";
import { fetchStockBreakdown } from "@/lib/leases/fetch-stock-breakdown";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

/**
 * 自現場の在庫（vendor 専用）。
 *
 * 現場に今どれだけ資材が残っているかを確認して、次の依頼数量を判断するための画面。
 * 自社所有かリースかの内訳は出さない（D-20260805-08）。現場にとって必要なのは
 * 「今いくつあるか」であり、所有形態は事務・センターが管理する情報のため。
 */
type PageProps = { searchParams: Promise<{ site_id?: string }> };

export default async function VendorSiteStockPage({ searchParams }: PageProps) {
  const { site_id: requestedSiteId } = await searchParams;
  const user = await getCurrentUser();
  if (user?.role && shouldPageCallNotFound("/vendor/stock", user.role)) {
    notFound();
  }
  const assignedSiteIds = user?.site_ids?.length ? user.site_ids : (user?.site_id ? [user.site_id] : []);

  if (assignedSiteIds.length === 0) {
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

  const supabase = await createClient();
  const { data: sites } = await supabase.from("sites").select("id,name,code").in("id", assignedSiteIds).order("name");
  const siteId = assignedSiteIds.includes(requestedSiteId ?? "") ? requestedSiteId! : (sites?.[0]?.id ?? assignedSiteIds[0]);
  const site = sites?.find((row) => row.id === siteId);
  const { products, error } = await fetchStockBreakdown({ siteId, storageKind: "site" });

  // 数量が残っているものだけ出す（0 の行を並べても判断材料にならない）
  const rows = products.filter((p) => p.totalQuantity > 0);

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            自現場の在庫
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            現場: {site?.name ?? "(現場不明)"}／今この現場に残っている数量です。
          </p>
          {sites && sites.length > 1 && <form method="get" className="mt-3 flex max-w-lg gap-2"><select name="site_id" defaultValue={siteId} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm">{sites.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} — ${item.name}` : item.name}</option>)}</select><button className="rounded-lg border px-3 py-2 text-sm">切り替え</button></form>}
          <Link
            href={`/stock/adjustments/new?site_id=${encodeURIComponent(siteId)}`}
            className="mt-3 inline-block text-sm text-zinc-600 underline hover:text-zinc-900"
          >
            この数量が違う場合は在庫調整を申請する →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">在庫の読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
          </div>
        )}

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            この現場に残っている資材はありません。
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">資材</th>
                  <th className="px-4 py-3 font-medium text-right">数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.productId} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 text-zinc-900">
                      {row.productCode
                        ? `${row.productCode} — ${row.productName}`
                        : row.productName}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-900">
                      {row.totalQuantity}
                      {row.productUnit ? (
                        <span className="ml-1 text-xs text-zinc-500">
                          {row.productUnit}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && (
          <p className="mt-4 text-sm text-zinc-500">{rows.length} 件</p>
        )}
      </main>
    </div>
  );
}
