import { correctStockReturn } from "@/app/stock/returns/actions";
import { requireAdmin } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function EditStockReturnPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_returns")
    .select("id, quantity, memo, created_at, products(name, code, unit), sites(name), over_returns(quantity)")
    .eq("id", id)
    .maybeSingle();

  if (!data) return <main className="mx-auto max-w-lg p-8"><p>対象の返却履歴が見つかりません。</p><Link href="/stock/returns" className="mt-4 inline-block underline">返却履歴へ戻る</Link></main>;
  const product = Array.isArray(data.products) ? data.products[0] : data.products;
  const site = Array.isArray(data.sites) ? data.sites[0] : data.sites;
  const over = (data.over_returns ?? []).reduce((sum, row) => sum + Number(row.quantity), 0);
  const inputQuantity = Number(data.quantity) + over;

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <Link href="/stock/returns" className="text-sm text-zinc-600">← 返却履歴</Link>
      <h1 className="mt-4 text-2xl font-semibold">返却登録を修正</h1>
      <div className="mt-4 rounded-lg border bg-zinc-50 p-4 text-sm">
        <p>現場: <strong>{site?.name ?? "-"}</strong></p>
        <p className="mt-1">商品: <strong>{product?.code ? `${product.code} — ` : ""}{product?.name ?? "-"}</strong></p>
        <p className="mt-1 text-zinc-500">登録日時: {new Date(data.created_at).toLocaleString("ja-JP")}</p>
      </div>
      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">数量を直すと、現場在庫・センター在庫・返却履歴・過入庫をまとめて修正します。</p>
      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{decodeURIComponent(error)}</p>}
      <form action={correctStockReturn.bind(null, id)} className="mt-6 space-y-4">
        <label className="block text-sm font-medium">正しい返却数量
          <input name="quantity" type="number" min="1" step="1" required defaultValue={inputQuantity} className="mt-1 block w-full rounded-lg border px-3 py-2" />
        </label>
        <label className="block text-sm font-medium">メモ
          <textarea name="memo" defaultValue={data.memo ?? ""} className="mt-1 block min-h-24 w-full rounded-lg border px-3 py-2" />
        </label>
        <div className="flex gap-3"><button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">修正を確定</button><Link href="/stock/returns" className="rounded-lg border px-4 py-2 text-sm">キャンセル</Link></div>
      </form>
    </main>
  );
}
