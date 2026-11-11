"use client";

import { SubmitButton } from "@/components/ui/SubmitButton";
import { useMemo, useState } from "react";

type CenterOption = { id: string; name: string };

export type TransferProduct = {
  id: string;
  code: string | null;
  name: string;
  unit: string | null;
  availableQuantity: number;
};

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  fromCenterName: string;
  destinationCenters: CenterOption[];
  products: TransferProduct[];
  error?: string;
};

function formatProductLabel(product: TransferProduct): string {
  return product.code ? `${product.code} — ${product.name}` : product.name;
}

function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(quantity);
}

export function CenterTransferForm({
  action,
  fromCenterName,
  destinationCenters,
  products,
  error,
}: Props) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = useMemo(
    () => normalizedQuery
      ? products.filter((product) =>
          `${product.code ?? ""} ${product.name}`.toLowerCase().includes(normalizedQuery),
        )
      : products,
    [normalizedQuery, products],
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-900">センター間移動を登録</h2>
      <p className="mt-1 text-xs text-zinc-600">
        {fromCenterName}が現在保有している自社資材を表示しています。移動先と数量を入力して登録してください。在庫を超える数量を入力した場合も登録はできますが、不足として履歴に記録されます。
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={action} className="mt-4 space-y-4">
        <div>
          <label htmlFor="to_center_id" className="block text-sm font-medium text-zinc-700">
            移動先センター <span className="text-red-600">*</span>
          </label>
          <select
            id="to_center_id"
            name="to_center_id"
            required
            defaultValue=""
            className="mt-1 w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          >
            <option value="" disabled>
              選択してください
            </option>
            {destinationCenters.map((center) => (
              <option key={center.id} value={center.id}>
                {center.name}
              </option>
            ))}
          </select>
        </div>

        <section>
          <h3 className="text-sm font-medium text-zinc-700">移動する資材</h3>
          <p className="mt-1 text-xs text-zinc-600">
            移動しない資材は空欄のままにしてください。
          </p>
          <label htmlFor="transfer_product_query" className="sr-only">
            資材を絞り込む
          </label>
          <input
            id="transfer_product_query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="商品コード・商品名で絞り込み"
            className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
          <p className="mt-2 text-xs text-zinc-600">
            {visibleProducts.length} / {products.length} 商品を表示
          </p>

          {visibleProducts.length === 0 ? (
            <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600">
              {products.length === 0
                ? "移動できる在庫はありません。"
                : "条件に一致する資材がありません。"}
            </p>
          ) : (
            <div className="mt-3 max-h-[32rem] overflow-auto rounded-lg border border-zinc-200">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-zinc-700">
                  <tr>
                    <th className="px-3 py-2 font-medium">資材</th>
                    <th className="px-3 py-2 text-right font-medium">現在庫</th>
                    <th className="px-3 py-2 font-medium">移動数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {visibleProducts.map((product) => (
                    <tr key={product.id}>
                      <td className="px-3 py-2 text-zinc-900">{formatProductLabel(product)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                        {formatQuantity(product.availableQuantity)}{product.unit ?? ""}
                      </td>
                      <td className="px-3 py-2">
                        <input type="hidden" name="product_id" value={product.id} />
                        <input
                          type="number"
                          name="quantity"
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

        <div>
          <label htmlFor="note" className="block text-sm font-medium text-zinc-700">
            備考（任意）
          </label>
          <input
            id="note"
            name="note"
            type="text"
            maxLength={200}
            className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>

        <div className="border-t border-zinc-200 pt-4">
          <SubmitButton
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            pendingLabel="登録中..."
          >
            移動を登録
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
