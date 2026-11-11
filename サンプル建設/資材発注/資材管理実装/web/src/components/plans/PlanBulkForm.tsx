"use client";

import { SubmitButton } from "@/components/ui/SubmitButton";
import Link from "next/link";
import { useMemo, useState } from "react";

export type PlanProductRow = {
  id: string;
  code: string | null;
  name: string;
  unit: string | null;
  categoryName: string | null;
  /** 既に登録済みの予定数量。未登録は null */
  plannedQuantity: number | null;
};

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  siteId: string;
  siteName: string;
  products: PlanProductRow[];
};

const ALL_TAB = "__all__";
const UNCATEGORIZED = "未分類";

/**
 * 現場を1つ選んだ状態で、複数商品の予定数量をまとめて入力するフォーム。
 * 資材が多いと探しづらいため、資材種別（product_categories）のタブで絞り込む
 * （D-20260805-01 #7）。
 */
export function PlanBulkForm({ action, siteId, siteName, products }: Props) {
  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const p of products) {
      seen.add(p.categoryName ?? UNCATEGORIZED);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b, "ja"));
  }, [products]);

  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);

  // タブ切り替えで入力欄をアンマウントすると入力値が消えるため、
  // 全行を描画したまま CSS で表示/非表示を切り替える。
  function isVisible(product: PlanProductRow): boolean {
    if (activeTab === ALL_TAB) return true;
    return (product.categoryName ?? UNCATEGORIZED) === activeTab;
  }

  const visibleCount = products.filter(isVisible).length;

  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="site_id" value={siteId} />

      <p className="text-sm text-zinc-600">
        現場: <span className="font-medium text-zinc-900">{siteName}</span>
      </p>

      {categories.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            onClick={() => setActiveTab(ALL_TAB)}
            className={
              activeTab === ALL_TAB
                ? "rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white"
                : "rounded-lg border border-zinc-300 px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"
            }
          >
            すべて
          </button>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveTab(category)}
              className={
                activeTab === category
                  ? "rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white"
                  : "rounded-lg border border-zinc-300 px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"
              }
            >
              {category}
            </button>
          ))}
        </nav>
      )}

      {visibleCount === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-600">
          この種別の資材がありません。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-3 py-2 font-medium">資材</th>
                <th className="px-3 py-2 font-medium">種別</th>
                <th className="px-3 py-2 font-medium">予定数量</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {products.map((product) => (
                <tr key={product.id} className={isVisible(product) ? "" : "hidden"}>
                  <td className="px-3 py-2 text-zinc-900">
                    {product.code
                      ? `${product.code} — ${product.name}`
                      : product.name}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">
                    {product.categoryName ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      name={`plan_quantity_${product.id}`}
                      min={0}
                      step="1"
                      defaultValue={product.plannedQuantity ?? ""}
                      placeholder="未設定"
                      className="w-28 rounded-lg border border-zinc-300 px-2 py-1.5 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                    />
                    {product.unit && (
                      <span className="ml-1 text-xs text-zinc-500">
                        {product.unit}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-zinc-500">
        タブを切り替えても入力内容は保持されます。空欄のままの資材は変更されません。
      </p>

      <div className="flex gap-3 border-t border-zinc-200 pt-6">
        <SubmitButton
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          pendingLabel="保存中..."
        >
          まとめて保存
        </SubmitButton>
        <Link
          href="/plans"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          キャンセル
        </Link>
      </div>
    </form>
  );
}
