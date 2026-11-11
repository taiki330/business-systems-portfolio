"use client";

import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { toStockLocation } from "@/lib/stock/location";
import type { ProductOption } from "@/types/stock";
import type { AdjustmentLocationOption } from "@/types/stock-adjustment";
import Link from "next/link";
import { useState } from "react";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  products: ProductOption[];
  locations: AdjustmentLocationOption[];
  /** `${product_id}|${location}` → システム上の数量 */
  stockMap: Record<string, number>;
  /**
   * vendor 用。保管場所は選ばせず、この現場に固定して表示する
   * （vendor は 1 アカウント＝1現場のため／D-20260801-14）。
   */
  lockedLocation?: AdjustmentLocationOption;
  error?: string;
};

/**
 * 在庫調整の申請フォーム（center / vendor）。
 *
 * 入力は「実際に数えた数量」（絶対値）。申請時点のシステム数量との差分を画面に表示し、
 * 承認時にはその差分が適用される（絶対値をそのまま設定するのではない）。
 */
export function StockAdjustmentRequestForm({
  action,
  products,
  locations,
  stockMap,
  lockedLocation,
  error,
}: Props) {
  const [productId, setProductId] = useState("");
  const [locationValue, setLocationValue] = useState(lockedLocation?.value ?? "");
  const [counted, setCounted] = useState("");


  const key =
    productId && locationValue
      ? `${productId}|${toStockLocation(locationValue)}`
      : "";
  const systemQty = key ? (stockMap[key] ?? 0) : null;

  // vendor（保管場所固定）のときは、今この現場にある資材を優先表示する。
  // システム上0でも実際にはある場合があるため、他の資材も選べるように「その他」として残す。
  const productOptions = lockedLocation
    ? [...products]
        .map((p) => {
          const qty = stockMap[`${p.id}|${toStockLocation(lockedLocation.value)}`] ?? 0;
          return { product: p, qty, inStock: qty > 0 };
        })
        .sort((a, b) => Number(b.inStock) - Number(a.inStock))
        .map(({ product: p, qty, inStock }) => ({
          value: p.id,
          label:
            (p.code ? `${p.code} — ${p.name}` : p.name) +
            (inStock ? `（現在庫 ${qty}）` : ""),
          keywords: p.code ?? undefined,
          group: inStock ? "この現場にある資材" : "その他の資材",
        }))
    : products.map((p) => ({
        value: p.id,
        label: p.code ? `${p.code} — ${p.name}` : p.name,
        keywords: p.code ?? undefined,
        group: p.category_name ?? null,
      }));

  const entered = Number(counted);
  const hasCount = counted !== "" && Number.isFinite(entered) && entered >= 0;
  const delta = hasCount && systemQty !== null ? entered - systemQty : null;

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <Link
        href="/stock/adjustments"
        className="text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← 在庫調整申請一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">在庫調整の申請</h1>
      <p className="mt-2 text-sm text-zinc-500">
        実際に数えた数量を申請します。この時点では在庫は変わりません。事務が承認したときに反映されます。
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={action} className="mt-6 space-y-5">
        <div>
          <label
            htmlFor="product_id"
            className="block text-sm font-medium text-zinc-700"
          >
            商品 <span className="text-red-600">*</span>
          </label>
          <div className="mt-1">
            <SearchableSelect
              id="product_id"
              name="product_id"
              required
              defaultValue={productId}
              onValueChange={setProductId}
              placeholder="資材名・コードの一部を入力"
              options={productOptions}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="location_value"
            className="block text-sm font-medium text-zinc-700"
          >
            保管場所 <span className="text-red-600">*</span>
          </label>
          <div className="mt-1">
            {lockedLocation ? (
              <>
                <input type="hidden" name="location_value" value={lockedLocation.value} />
                <p className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-zinc-700">
                  {lockedLocation.label}
                </p>
              </>
            ) : (
              <SearchableSelect
                id="location_value"
                name="location_value"
                required
                defaultValue={locationValue}
                onValueChange={setLocationValue}
                placeholder="センター、または現場名の一部を入力"
                options={locations.map((l) => ({ value: l.value, label: l.label }))}
              />
            )}
          </div>
        </div>

        {systemQty !== null && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
            <div className="flex justify-between text-zinc-700">
              <span>システム上の数量</span>
              <span className="font-medium tabular-nums">{systemQty}</span>
            </div>
          </div>
        )}

        <div>
          <label
            htmlFor="counted_quantity"
            className="block text-sm font-medium text-zinc-700"
          >
            実際に数えた数量 <span className="text-red-600">*</span>
          </label>
          <input
            id="counted_quantity"
            name="counted_quantity"
            type="number"
            required
            min={0}
            step="1"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900"
          />
        </div>

        {delta !== null && (
          <div
            className={
              delta === 0
                ? "rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm"
                : "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm"
            }
          >
            <div className="flex justify-between">
              <span className={delta === 0 ? "text-zinc-600" : "font-medium text-amber-800"}>
                差分（承認時に反映される数）
              </span>
              <span
                className={
                  delta === 0
                    ? "tabular-nums text-zinc-600"
                    : "font-semibold tabular-nums text-amber-800"
                }
              >
                {delta > 0 ? `+${delta}` : delta}
              </span>
            </div>
            {delta === 0 && (
              <p className="mt-2 text-xs text-zinc-500">
                システム上の数量と同じです。この内容では申請できません。
              </p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="note" className="block text-sm font-medium text-zinc-700">
            申請理由（任意）
          </label>
          <textarea
            id="note"
            name="note"
            rows={3}
            placeholder="例: 棚卸で実数を確認。束の数え間違いの可能性あり。"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={delta === 0}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            申請する
          </button>
          <Link
            href="/stock/adjustments"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  );
}
