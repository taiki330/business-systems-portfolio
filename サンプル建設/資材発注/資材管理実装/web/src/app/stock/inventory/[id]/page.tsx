import {
  applyInventoryCount,
  saveInventoryCount,
} from "@/app/stock/inventory/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

type InventoryStatus = "draft" | "counted" | "completed";

export default async function InventoryCountDetailPage({
  params,
  searchParams,
}: Props) {
  const { id } = await params;
  const { error, ok } = await searchParams;
  const supabase = await createClient();
  const [{ data: count }, { data: items }] = await Promise.all([
    supabase
      .from("inventory_counts")
      .select("id,status,started_at,counted_at,completed_at,note")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("inventory_count_items")
      .select(
        "id,system_quantity,counted_quantity,difference_quantity,applied,products(code,name,unit)",
      )
      .eq("inventory_count_id", id)
      .order("id"),
  ]);

  if (!count) notFound();

  const status = count.status as InventoryStatus;
  const isDraft = status === "draft";
  const isReview = status === "counted";
  const hasDifferences = (items ?? []).some(
    (item) => Number(item.difference_quantity ?? 0) !== 0,
  );

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <Link
            href="/stock/inventory"
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            棚卸一覧
          </Link>
          <h1 className="mt-1 text-xl font-semibold">
            {isDraft
              ? "棚卸実数を入力"
              : isReview
                ? "棚卸差異を確認"
                : "棚卸結果"}
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            {isDraft
              ? "開始時点のシステム在庫と、数えた実数を入力して保存します。この時点では在庫数は変わりません。"
              : isReview
                ? "システム数と棚卸実数を比較し、在庫へ反映する明細を選択してください。"
                : "棚卸時の差異と、在庫へ反映した明細を確認できます。"}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {ok === "saved" && (
          <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-medium text-blue-900">
            実数を保存しました。在庫数はまだ変更されていません。
          </p>
        )}
        {ok === "completed" && (
          <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">
            選択した差異を在庫へ反映し、棚卸を完了しました。
          </p>
        )}
        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {decodeURIComponent(error)}
          </p>
        )}

        <div className="mb-5 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-zinc-600">開始日時</p>
            <p className="mt-1 font-medium">
              {new Date(count.started_at).toLocaleString("ja-JP")}
            </p>
          </div>
          <div>
            <p className="text-zinc-600">状態</p>
            <p className="mt-1 font-medium">
              {isDraft ? "実数入力中" : isReview ? "差異確認中" : "完了"}
            </p>
          </div>
          <div>
            <p className="text-zinc-600">メモ</p>
            <p className="mt-1 font-medium">{count.note || "－"}</p>
          </div>
        </div>

        <form
          action={
            isDraft
              ? saveInventoryCount.bind(null, id)
              : isReview
                ? applyInventoryCount.bind(null, id)
                : undefined
          }
        >
          {isReview && (
            <input
              type="hidden"
              name="has_differences"
              value={hasDifferences ? "1" : "0"}
            />
          )}
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-700">
                <tr>
                  {isReview && (
                    <th className="w-24 p-3 text-center">在庫反映</th>
                  )}
                  {status === "completed" && (
                    <th className="w-24 p-3 text-center">反映結果</th>
                  )}
                  <th className="p-3">商品</th>
                  <th className="p-3 text-right">システム数</th>
                  <th className="p-3 text-right">棚卸実数</th>
                  <th className="p-3 text-right">差異</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {(items ?? []).map((item) => {
                  const product = Array.isArray(item.products)
                    ? item.products[0]
                    : item.products;
                  const system = Number(item.system_quantity);
                  const actual =
                    item.counted_quantity == null
                      ? system
                      : Number(item.counted_quantity);
                  const difference = Number(item.difference_quantity ?? 0);

                  return (
                    <tr key={item.id} className="text-zinc-800">
                      {isReview && (
                        <td className="p-3 text-center">
                          {difference !== 0 ? (
                            <input
                              type="checkbox"
                              name="apply_item_ids"
                              value={item.id}
                              aria-label={`${product?.name ?? "商品"}の差異を在庫へ反映`}
                              className="h-5 w-5"
                            />
                          ) : (
                            <span className="text-zinc-500">不要</span>
                          )}
                        </td>
                      )}
                      {status === "completed" && (
                        <td className="p-3 text-center font-medium">
                          {difference === 0
                            ? "差異なし"
                            : item.applied
                              ? "反映済み"
                              : "未反映"}
                        </td>
                      )}
                      <td className="p-3 font-medium">
                        {product?.code ? `${product.code} — ` : ""}
                        {product?.name ?? "商品"} {product?.unit ?? ""}
                      </td>
                      <td className="p-3 text-right tabular-nums">{system}</td>
                      <td className="p-3 text-right tabular-nums">
                        {isDraft ? (
                          <input
                            className="w-28 rounded-md border border-zinc-400 bg-white px-2 py-1.5 text-right text-zinc-900 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700"
                            type="number"
                            min="0"
                            step="1"
                            name={`count_${item.id}`}
                            defaultValue={actual}
                            required
                          />
                        ) : (
                          actual
                        )}
                      </td>
                      <td
                        className={`p-3 text-right font-semibold tabular-nums ${
                          difference === 0
                            ? "text-zinc-600"
                            : difference > 0
                              ? "text-blue-800"
                              : "text-red-700"
                        }`}
                      >
                        {isDraft
                          ? "保存後に計算"
                          : difference > 0
                            ? `+${difference}`
                            : difference}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {isDraft && (
            <SubmitButton
              pendingLabel="保存中..."
              className="mt-4 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-500"
            >
              実数を保存して差異を確認
            </SubmitButton>
          )}

          {isReview && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-950">
                チェックした明細だけ、棚卸実数を現在庫へ反映します。
              </p>
              <p className="mt-1 text-xs text-amber-900">
                この操作を行うまでは、システム上の在庫数量は変わりません。
              </p>
              <SubmitButton
                pendingLabel="反映中..."
                className="mt-3 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-500"
              >
                選択した差異を在庫へ反映して完了
              </SubmitButton>
            </div>
          )}
        </form>
      </main>
    </div>
  );
}
