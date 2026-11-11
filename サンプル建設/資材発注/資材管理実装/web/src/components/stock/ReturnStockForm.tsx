"use client";

import type { SiteRef, StockProductRef } from "@/types/stock";
import Link from "next/link";
import { useState } from "react";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  productId: string;
  siteId: string;
  product: StockProductRef | null;
  site: SiteRef | null;
  currentQuantity: number;
  error?: string;
};

/**
 * 返却登録フォーム。
 *
 * 現場在庫を超える数量の入力を許可し、超過分は過入庫として扱う（Phase 6-2）。
 * 入力に応じて「在庫へ加算される分」と「過入庫になる分」を即時に表示し、
 * 数え間違いに気づけるようにする。実際の分割は return_from_site RPC が行う。
 */
export function ReturnStockForm({
  action,
  productId,
  siteId,
  product,
  site,
  currentQuantity,
  error,
}: Props) {
  const [input, setInput] = useState("");

  const entered = Number(input);
  const hasInput = input !== "" && Number.isFinite(entered) && entered > 0;
  const normal = hasInput ? Math.min(entered, currentQuantity) : 0;
  const over = hasInput ? Math.max(entered - currentQuantity, 0) : 0;
  const unit = product?.unit ? ` ${product.unit}` : "";

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href="/stock/sites" className="text-sm text-zinc-600 hover:text-zinc-900">
        ← 現場在庫一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">返却登録</h1>
      <p className="mt-2 text-sm text-zinc-500">
        現場在庫を減らし、センター在庫を増やします（即時反映・センター経由）。
      </p>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm">
        <p className="text-zinc-500">現場</p>
        <p className="font-medium text-zinc-900">{site?.name ?? "-"}</p>
        <p className="mt-2 text-zinc-500">商品</p>
        <p className="font-medium text-zinc-900">
          {product
            ? product.code
              ? `${product.code} — ${product.name}`
              : product.name
            : "-"}
        </p>
        <p className="mt-2 text-zinc-500">現在の現場在庫数</p>
        <p className="font-medium tabular-nums text-zinc-900">
          {currentQuantity}
          {unit}
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={action} className="mt-6 space-y-5">
        <input type="hidden" name="product_id" value={productId} />
        <input type="hidden" name="site_id" value={siteId} />

        <div>
          <label
            htmlFor="quantity"
            className="block text-sm font-medium text-zinc-700"
          >
            返却数量 <span className="text-red-600">*</span>
          </label>
          <input
            id="quantity"
            name="quantity"
            type="number"
            required
            min={0.01}
            step="1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
          <p className="mt-1 text-xs text-zinc-500">
            実際に戻ってきた数を入力してください。現場在庫を超える分は過入庫として記録され、在庫には加算されません。
          </p>
        </div>

        {hasInput && (
          <div
            className={
              over > 0
                ? "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm"
                : "rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm"
            }
          >
            <div className="flex justify-between text-zinc-700">
              <span>在庫へ加算される分</span>
              <span className="font-medium tabular-nums">
                {normal}
                {unit}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className={over > 0 ? "font-medium text-amber-800" : "text-zinc-500"}>
                うち過入庫
              </span>
              <span
                className={
                  over > 0
                    ? "font-semibold tabular-nums text-amber-800"
                    : "tabular-nums text-zinc-500"
                }
              >
                {over}
                {unit}
              </span>
            </div>
            {over > 0 && (
              <p className="mt-2 text-xs text-amber-800">
                現場在庫（{currentQuantity}
                {unit}）を超えています。超過分は在庫に加算せず、事務の過入庫一覧で確認します。
                数え間違いの可能性がないか確認してください。
              </p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="memo" className="block text-sm font-medium text-zinc-700">
            メモ（任意）
          </label>
          <textarea
            id="memo"
            name="memo"
            rows={3}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            返却を実行
          </button>
          <Link
            href="/stock/sites"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  );
}
