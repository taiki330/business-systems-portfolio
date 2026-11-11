"use client";

import { SubmitButton } from "@/components/ui/SubmitButton";
import type { ProductOptionForSite } from "@/lib/products/fetch-options-for-site";
import type { SiteProductPlanStatusRow } from "@/types/site-product-plan";
import Link from "next/link";
import { useState } from "react";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  siteId: string;
  siteName: string;
  planRows: SiteProductPlanStatusRow[];
  pastProducts: (ProductOptionForSite & { lastRequestedAt: string; lastQuantity: number })[];
  catalogProducts: ProductOptionForSite[];
  error?: string;
};

function formatProductLabel(product: ProductOptionForSite): string {
  const base = product.code ? `${product.code} — ${product.name}` : product.name;
  const lot = formatLotSize(product.lot_size ?? null, product.unit ?? null);
  return lot ? `${base}（${lot}）` : base;
}

/**
 * 束の入り数と、依頼できる最小単位を「1束 20本・10本単位」の形で返す。
 * セット数が未設定の資材は null（束の概念が無い）。
 *
 * 0.5束単位での依頼が認められているため、最小単位は束の半分になる
 * （判定側の定義は migration 065 の order_unit。D-20260805-09）。
 */
function formatLotSize(
  lotSize: number | null,
  unit: string | null,
): string | null {
  if (lotSize == null || lotSize <= 0) return null;
  const suffix = unit ?? "";
  const orderUnit = lotSize / 2;
  return `1束 ${lotSize}${suffix}・${orderUnit}${suffix}単位で依頼可`;
}

export function OrderForm({
  action,
  siteId,
  siteName,
  planRows,
  pastProducts,
  catalogProducts,
  error,
}: Props) {
  const [catalogQuery, setCatalogQuery] = useState("");
  const query = catalogQuery.trim().toLowerCase();
  const visibleCatalogProducts = query
    ? catalogProducts.filter((product) =>
        `${product.code ?? ""} ${product.name}`.toLowerCase().includes(query),
      )
    : catalogProducts;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <Link href="/requests" className="text-sm text-zinc-600 hover:text-zinc-900">
        ← 出庫依頼一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
        出庫依頼を新規登録
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        現場: <span className="font-medium text-zinc-800">{siteName}</span>
        ／依頼中（requested）として登録します。在庫はまだ減りません。
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={action} className="mt-6 space-y-8">
        <input type="hidden" name="operation_id" value={crypto.randomUUID()} />
        <input type="hidden" name="site_id" value={siteId} />
        <div>
          <label
            htmlFor="delivery_deadline"
            className="block text-sm font-semibold text-zinc-900"
          >
            納期
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            資材が必要な日時を選んでください（15分単位）。
          </p>
          <input
            id="delivery_deadline"
            name="delivery_deadline"
            type="datetime-local"
            step={900}
            required
            className="mt-2 rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>

        <div>
          <label
            htmlFor="yard_loading_date"
            className="block text-sm font-semibold text-zinc-900"
          >
            ヤード積み込み日
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            資材をヤードに積み込む希望日を選んでください。
          </p>
          <input
            id="yard_loading_date"
            name="yard_loading_date"
            type="date"
            required
            className="mt-2 rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-zinc-900">
            予定されている資材
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            必要な数量を入力してください（0のままなら依頼しません）。
            「1束 ○本」と出ている資材は束で数える資材です（半束から依頼できます）。
          </p>

          {planRows.length === 0 ? (
            <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600">
              この現場の予定資材がまだ登録されていません。下の「その他の資材」から依頼してください。
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">商品</th>
                    <th className="px-3 py-2 font-medium">予定数量</th>
                    <th className="px-3 py-2 font-medium">依頼数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {planRows.map((row) => (
                    <tr key={row.product_id}>
                      <td className="px-3 py-2 text-zinc-900">
                        {row.product_code
                          ? `${row.product_code} — ${row.product_name}`
                          : row.product_name}
                        {formatLotSize(row.product_lot_size, row.product_unit) && (
                          <span className="mt-0.5 block text-xs font-medium text-amber-700">
                            {formatLotSize(row.product_lot_size, row.product_unit)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">
                        {row.planned_quantity}
                        {row.product_unit ?? ""}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          name={`plan_quantity_${row.product_id}`}
                          min={0}
                          step="1"
                          defaultValue=""
                          placeholder="0"
                          className="w-28 rounded-lg border border-zinc-300 px-2 py-1.5 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {pastProducts.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-900">過去に注文した資材</h2>
            <p className="mt-1 text-xs text-zinc-600">
              この現場で過去に注文した、予定数量に含まれない資材です。新しい注文順に最大20件表示します。
            </p>

            <div className="mt-3 overflow-x-auto rounded-lg border border-blue-200">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-blue-200 bg-blue-50 text-blue-900">
                  <tr>
                    <th className="px-3 py-2 font-medium">商品</th>
                    <th className="px-3 py-2 font-medium">前回注文</th>
                    <th className="px-3 py-2 font-medium">依頼数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {pastProducts.map((product) => (
                    <tr key={product.id}>
                      <td className="px-3 py-2 text-zinc-900">
                        {formatProductLabel(product)}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-600">
                        {new Date(product.lastRequestedAt).toLocaleDateString("ja-JP")}
                        <span className="ml-1">
                          {product.lastQuantity}{product.unit ?? ""}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <input type="hidden" name="extra_product_id" value={product.id} />
                        <input
                          type="number"
                          name="extra_quantity"
                          min={0}
                          step="1"
                          placeholder="0"
                          className="w-28 rounded-lg border border-zinc-300 px-2 py-1.5 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold text-zinc-900">その他の全商品</h2>
          <p className="mt-1 text-xs text-zinc-600">
            予定数量にない資材を、商品コード・商品名で絞り込んで数量を入力してください。
          </p>

          <div className="mt-3">
            <label htmlFor="catalog_query" className="sr-only">
              商品を絞り込む
            </label>
            <input
              id="catalog_query"
              type="search"
              value={catalogQuery}
              onChange={(event) => setCatalogQuery(event.target.value)}
              placeholder="商品コード・商品名で絞り込み"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            {visibleCatalogProducts.length} / {catalogProducts.length} 商品を表示
          </p>

          {visibleCatalogProducts.length === 0 ? (
            <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600">
              条件に一致する商品がありません。
            </p>
          ) : (
            <div className="mt-3 max-h-[32rem] overflow-auto rounded-lg border border-zinc-200">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-zinc-700">
                  <tr>
                    <th className="px-3 py-2 font-medium">商品</th>
                    <th className="px-3 py-2 font-medium">単位</th>
                    <th className="px-3 py-2 font-medium">依頼数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {visibleCatalogProducts.map((product) => (
                    <tr key={product.id}>
                      <td className="px-3 py-2 text-zinc-900">
                        {formatProductLabel(product)}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">{product.unit ?? "—"}</td>
                      <td className="px-3 py-2">
                        <input type="hidden" name="extra_product_id" value={product.id} />
                        <input
                          type="number"
                          name="extra_quantity"
                          min={0}
                          step="1"
                          placeholder="0"
                          className="w-28 rounded-lg border border-zinc-300 px-2 py-1.5 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="flex gap-3 border-t border-zinc-200 pt-6">
          <SubmitButton
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            pendingLabel="登録中..."
          >
            登録
          </SubmitButton>
          <Link
            href="/requests"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  );
}
