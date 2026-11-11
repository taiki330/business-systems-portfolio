import { startInventoryCount } from "@/app/stock/inventory/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type Props = { searchParams: Promise<{ error?: string }> };

const STATUS_LABELS: Record<string, string> = {
  draft: "実数入力中",
  counted: "差異確認中",
  completed: "完了",
};

export default async function InventoryCountPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: counts } = await supabase
    .from("inventory_counts")
    .select("id,status,started_at,counted_at,completed_at,note")
    .order("started_at", { ascending: false })
    .limit(30);

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <Link
            href="/stock"
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold">棚卸</h1>
          <p className="mt-1 text-sm text-zinc-600">
            システム数と棚卸実数を保存して比較し、確認後に選択した差異だけを在庫へ反映します。
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {decodeURIComponent(error)}
          </p>
        )}

        <form
          action={startInventoryCount}
          className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <label className="block text-sm font-medium text-zinc-800">
            メモ（任意）
            <input
              name="note"
              className="mt-1 block w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-zinc-900 placeholder:text-zinc-500 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700"
              placeholder="例：2026年度 定期棚卸"
            />
          </label>
          <SubmitButton
            pendingLabel="開始中..."
            className="mt-4 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-500"
          >
            棚卸を開始
          </SubmitButton>
        </form>

        <h2 className="mt-8 text-base font-semibold text-zinc-900">棚卸履歴</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-700">
              <tr>
                <th className="p-3 font-medium">開始日時</th>
                <th className="p-3 font-medium">状態</th>
                <th className="p-3 font-medium">メモ</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 text-zinc-800">
              {(counts ?? []).map((count) => (
                <tr key={count.id} className="hover:bg-zinc-50">
                  <td className="p-3">
                    {new Date(count.started_at).toLocaleString("ja-JP")}
                  </td>
                  <td className="p-3 font-medium">
                    {STATUS_LABELS[count.status] ?? count.status}
                  </td>
                  <td className="p-3">{count.note || "－"}</td>
                  <td className="p-3 text-right">
                    <Link
                      className="font-medium text-blue-800 underline hover:text-blue-950"
                      href={`/stock/inventory/${count.id}`}
                    >
                      {count.status === "draft"
                        ? "入力する"
                        : count.status === "counted"
                          ? "差異を確認"
                          : "結果を見る"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(counts ?? []).length === 0 && (
            <p className="px-6 py-10 text-center text-sm text-zinc-600">
              棚卸履歴はまだありません。
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
