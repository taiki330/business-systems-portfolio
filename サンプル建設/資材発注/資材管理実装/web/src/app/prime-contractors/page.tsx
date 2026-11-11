import { createPrimeContractor, updatePrimeContractor } from "@/app/prime-contractors/actions";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type PageProps = { searchParams: Promise<{ error?: string; ok?: string }> };
type PrimeContractor = {
  id: string;
  name: string;
  slip_number: string;
  is_active: boolean;
};

export default async function PrimeContractorsPage({ searchParams }: PageProps) {
  const [{ error: queryError, ok }, supabase] = await Promise.all([searchParams, createClient()]);
  const { data, error } = await supabase
    .from("prime_contractors")
    .select("id, name, slip_number, is_active")
    .order("name", { ascending: true });
  const primeContractors = (data ?? []) as PrimeContractor[];

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900">ホーム</Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">元請マスタ</h1>
          <p className="mt-1 text-sm text-zinc-700">元請番号を設定します。伝票用現場番号は元請ごとに現場登録時に自動採番されます。</p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        {queryError && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{decodeURIComponent(queryError)}</p>}
        {ok && <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">保存しました。</p>}
        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">読み込みエラー: {error.message}</p>}

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900">元請を追加</h2>
          <form action={createPrimeContractor} className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end">
            <label className="block text-sm font-medium text-zinc-800">元請名<input name="name" required className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900" /></label>
            <label className="block text-sm font-medium text-zinc-800">元請番号<input name="slip_number" required className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900" /></label>
            <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-800">追加</button>
          </form>
        </section>

        <section className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-700"><tr><th className="px-4 py-3 font-medium">元請名</th><th className="px-4 py-3 font-medium">元請番号</th><th className="px-4 py-3 font-medium">利用状態</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {primeContractors.map((primeContractor) => (
                <tr key={primeContractor.id}>
                  <td colSpan={4} className="p-0">
                    <form action={updatePrimeContractor.bind(null, primeContractor.id)} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px_80px] items-center gap-3 px-4 py-3">
                      <input name="name" required defaultValue={primeContractor.name} className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-zinc-900" />
                      <input name="slip_number" required defaultValue={primeContractor.slip_number} className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-zinc-900" />
                      <label className="flex items-center gap-2 text-zinc-800"><input name="is_active" type="checkbox" defaultChecked={primeContractor.is_active} />利用中</label>
                      <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium text-zinc-800 hover:bg-zinc-50">保存</button>
                    </form>
                  </td>
                </tr>
              ))}
              {primeContractors.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-zinc-600">元請はまだ登録されていません。</td></tr>}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
