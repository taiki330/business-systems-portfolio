import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { DeleteSiteProductPlanButton } from "@/components/plans/DeleteSiteProductPlanButton";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  canShowOverPlanPage,
  canShowPlanWriteActions,
  resolveUiRole,
} from "@/lib/auth/ui-capabilities";
import { fetchSiteProductPlanStatus } from "@/lib/plans/fetch-plans";
import { fetchProductOptions } from "@/lib/products/fetch-options";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{
    error?: string;
    ok?: string;
    site_id?: string;
    product_id?: string;
    over?: string;
  }>;
};

const OK_MESSAGES: Record<string, string> = {
  created: "予定数量を登録しました。",
  updated: "予定数量を更新しました。",
  deleted: "予定数量を削除しました。",
};

/**
 * 現場×商品ごとの予定数量一覧（Phase 3-7）。
 *
 * 超過は警告表示のみで、出庫を止めることはない。
 * center は実在庫を見て従来どおり出庫数量を調整できる。
 */
export default async function PlansPage({ searchParams }: PageProps) {
  const {
    error: queryError,
    ok,
    site_id: siteId,
    product_id: productId,
    over,
  } = await searchParams;

  const user = await getCurrentUser();
  const role = resolveUiRole(user);
  const showWriteActions = canShowPlanWriteActions(role);
  const showOverLink = canShowOverPlanPage(role);

  const [{ rows, error }, sites, products] = await Promise.all([
    fetchSiteProductPlanStatus({
      siteId: siteId || undefined,
      productId: productId || undefined,
      overOnly: over === "1",
    }),
    fetchSiteOptions(),
    fetchProductOptions(),
  ]);

  const okText = ok === "csv_imported" ? "CSVの予定数量を反映しました。" : ok ? OK_MESSAGES[ok] : null;
  const overCount = rows.filter((r) => r.is_over).length;

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              現場別 予定数量
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              予定数量を超えても出庫は禁止されません。超過は確認・警告のために表示します。
            </p>
          </div>
          <div className="flex gap-2">
            {showOverLink && (
              <Link
                href="/plans/over"
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                超過依頼の確認
              </Link>
            )}
            {showWriteActions && (
              <Link
                href="/plans/import"
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                CSV取込
              </Link>
            )}
            {showWriteActions && (
              <Link
                href="/plans/new"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                予定数量を登録
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {okText && (
          <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {okText}
          </p>
        )}

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

        {over !== "1" && overCount > 0 && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            予定数量を超過している現場×商品が {overCount} 件あります。
          </p>
        )}

        <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
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
              defaultValue={siteId ?? ""}
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
              defaultValue={productId ?? ""}
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
          <label className="inline-flex items-center gap-2 pb-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              name="over"
              value="1"
              defaultChecked={over === "1"}
              className="h-4 w-4 rounded border-zinc-300"
            />
            超過ありのみ
          </label>
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            絞り込み
          </button>
        </form>

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            予定数量が登録されていません。
            {showWriteActions && "「予定数量を登録」から追加してください。"}
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">現場</th>
                  <th className="px-4 py-3 font-medium">商品</th>
                  <th className="px-4 py-3 text-right font-medium">予定数量</th>
                  <th className="px-4 py-3 text-right font-medium">既出庫</th>
                  <th className="px-4 py-3 text-right font-medium">未処理依頼</th>
                  <th className="px-4 py-3 text-right font-medium">見込</th>
                  <th className="px-4 py-3 text-right font-medium">超過</th>
                  <th className="px-4 py-3 text-right font-medium">現場在庫</th>
                  {showWriteActions && (
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => (
                  <tr
                    key={r.plan_id}
                    className={r.is_over ? "bg-amber-50/60" : "hover:bg-zinc-50/80"}
                  >
                    <td className="px-4 py-3 text-zinc-900">{r.site_name}</td>
                    <td className="px-4 py-3 text-zinc-900">
                      {r.product_code ? `${r.product_code} ` : ""}
                      {r.product_name}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-900">
                      {r.planned_quantity}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-600">
                      {r.shipped_quantity}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-600">
                      {r.pending_quantity}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-zinc-900">
                      {r.expected_quantity}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.is_over ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                          +{r.over_quantity}
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-600">
                      {r.current_site_quantity}
                    </td>
                    {showWriteActions && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-4">
                          <Link
                            href={`/plans/${r.plan_id}/edit`}
                            className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                          >
                            編集
                          </Link>
                          <DeleteSiteProductPlanButton
                            id={r.plan_id}
                            label={`${r.site_name} / ${r.product_name}`}
                          />
                        </div>
                      </td>
                    )}
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
