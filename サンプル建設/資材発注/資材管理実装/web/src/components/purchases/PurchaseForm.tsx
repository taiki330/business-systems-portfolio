"use client";

import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { SupplierOption } from "@/types/purchase";
import type { ProductOption } from "@/types/stock";
import Link from "next/link";
import { useState } from "react";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  products: ProductOption[];
  suppliers: SupplierOption[];
  /** product_id → センター在庫の現在数量 */
  centerStock: Record<string, number>;
  /** 今日（JST）の日付 yyyy-mm-dd。未来日の入力を防ぐ */
  today: string;
  error?: string;
};

/**
 * 仕入れ（購入）登録フォーム（事務のみ）。
 *
 * 登録するとセンター在庫が加算される。入力に応じて加算後の在庫数を即時表示し、
 * 桁の打ち間違いに気づけるようにする。
 */
export function PurchaseForm({
  action,
  products,
  suppliers,
  centerStock,
  today,
  error,
}: Props) {
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");

  const current = productId ? (centerStock[productId] ?? 0) : null;
  const entered = Number(quantity);
  const hasQuantity =
    quantity !== "" && Number.isFinite(entered) && entered > 0;
  const after = current !== null && hasQuantity ? current + entered : null;

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href="/purchases" className="text-sm text-zinc-600 hover:text-zinc-900">
        ← 仕入れ一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">仕入れを登録</h1>
      <p className="mt-2 text-sm text-zinc-500">
        資材を購入したときに登録します。登録するとセンター在庫が増え、在庫履歴には「仕入れ」として記録されます。
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {suppliers.length === 0 && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          仕入先がまだ登録されていません。
          <Link
            href="/purchases/suppliers/new"
            className="ml-1 underline hover:text-amber-900"
          >
            仕入先マスタ
          </Link>
          から登録してください。
        </p>
      )}

      <form action={action} className="mt-6 space-y-5">
        <div>
          <label
            htmlFor="purchase_date"
            className="block text-sm font-medium text-zinc-700"
          >
            購入日 <span className="text-red-600">*</span>
          </label>
          <input
            id="purchase_date"
            name="purchase_date"
            type="date"
            required
            defaultValue={today}
            max={today}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>

        <div>
          <label
            htmlFor="supplier_id"
            className="block text-sm font-medium text-zinc-700"
          >
            仕入先 <span className="text-red-600">*</span>
          </label>
          <div className="mt-1">
            <SearchableSelect
              id="supplier_id"
              name="supplier_id"
              required
              disabled={suppliers.length === 0}
              placeholder="仕入先名の一部を入力"
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="product_id"
            className="block text-sm font-medium text-zinc-700"
          >
            資材 <span className="text-red-600">*</span>
          </label>
          <div className="mt-1">
            <SearchableSelect
              id="product_id"
              name="product_id"
              required
              onValueChange={setProductId}
              placeholder="資材名・コードの一部を入力"
              options={products.map((p) => ({
                value: p.id,
                label: p.code ? `${p.code} — ${p.name}` : p.name,
                keywords: p.code ?? undefined,
                group: p.category_name ?? null,
              }))}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="quantity"
            className="block text-sm font-medium text-zinc-700"
          >
            数量 <span className="text-red-600">*</span>
          </label>
          <input
            id="quantity"
            name="quantity"
            type="number"
            required
            min={0.01}
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>

        {current !== null && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
            <div className="flex justify-between text-zinc-700">
              <span>現在のセンター在庫</span>
              <span className="font-medium tabular-nums">{current}</span>
            </div>
            {after !== null && (
              <div className="mt-1 flex justify-between">
                <span className="font-medium text-emerald-800">登録後の在庫</span>
                <span className="font-semibold tabular-nums text-emerald-800">
                  {after}
                </span>
              </div>
            )}
          </div>
        )}

        <div>
          <label htmlFor="note" className="block text-sm font-medium text-zinc-700">
            備考（任意）
          </label>
          <textarea
            id="note"
            name="note"
            rows={3}
            placeholder="例: 追加購入分。納品書番号 12345"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={suppliers.length === 0}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            登録する
          </button>
          <Link
            href="/purchases"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  );
}
