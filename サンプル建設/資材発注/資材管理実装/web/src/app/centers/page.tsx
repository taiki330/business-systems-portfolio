import { createCenter, updateCenterName } from "@/app/centers/actions";
import { requireAdmin } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type PageProps = { searchParams: Promise<{ error?: string; ok?: string }> };
type Center = { id: string; code: string; name: string; stock_location: string };

export default async function CentersPage({ searchParams }: PageProps) {
  await requireAdmin();
  const [{ error: queryError, ok }, supabase] = await Promise.all([searchParams, createClient()]);
  const { data, error } = await supabase.from("centers").select("id, code, name, stock_location").order("code");
  const centers = (data ?? []) as Center[];

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white"><div className="mx-auto max-w-5xl px-6 py-4"><Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900">ホーム</Link><h1 className="mt-1 text-xl font-semibold text-zinc-900">センターマスタ</h1><p className="mt-1 text-sm text-zinc-700">センターを追加し、現場・センターアカウント・在庫の紐付け先として使用します。</p></div></header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        {queryError && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{decodeURIComponent(queryError)}</p>}
        {ok && <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">保存しました。</p>}
        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">読み込みエラー: {error.message}</p>}

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900">センターを追加</h2>
          <p className="mt-1 text-sm text-zinc-700">コードは在庫の保管場所を識別する内部キーです。作成後は変更できません。</p>
          <form action={createCenter} className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end">
            <label className="block text-sm font-medium text-zinc-800">センター名<input name="name" required placeholder="例：中部（名古屋）" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900" /></label>
            <label className="block text-sm font-medium text-zinc-800">センターコード<input name="code" required pattern="[a-z][a-z0-9_-]{1,29}" placeholder="例：chubu" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-zinc-900" /><span className="mt-1 block text-xs font-normal text-zinc-600">英小文字・数字・-・_、2〜30文字</span></label>
            <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-800">追加</button>
          </form>
        </section>

        <section className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 px-5 py-4"><h2 className="font-semibold text-zinc-900">登録済みセンター</h2><p className="mt-1 text-sm text-zinc-700">名称は変更できます。コードと保管場所は履歴との対応を保つため変更しません。</p></div>
          <table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-700"><tr><th className="px-4 py-3 font-medium">センター名</th><th className="px-4 py-3 font-medium">コード</th><th className="px-4 py-3 font-medium">在庫保管場所</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-zinc-100">
            {centers.map((center) => <tr key={center.id}><td colSpan={4} className="p-0"><form action={updateCenterName.bind(null, center.id)} className="grid grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)_80px] items-center gap-3 px-4 py-3"><input name="name" required defaultValue={center.name} className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-zinc-900" /><code className="text-zinc-800">{center.code}</code><code className="text-xs text-zinc-700">{center.stock_location}</code><button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium text-zinc-800 hover:bg-zinc-50">保存</button></form></td></tr>)}
            {centers.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-zinc-600">センターがありません。</td></tr>}
          </tbody></table>
        </section>
      </main>
    </div>
  );
}
