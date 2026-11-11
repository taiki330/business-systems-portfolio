import { recordSiteProgress } from "@/app/stock/progress/actions";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { createClient } from "@/lib/supabase/server";
import {
  SITE_PROGRESS_LABELS,
  SITE_PROGRESS_ORDER,
} from "@/types/site-progress";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; site_id?: string; kind?: string }>;
};

/** 今日（JST）の日付を yyyy-mm-dd で返す。 */
function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 現場進捗の記録フォーム（事務のみ）。 */
export default async function NewSiteProgressPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: sites } = await supabase
    .from("sites")
    .select("id, code, name")
    .order("name");

  return (
    <div className="min-h-full bg-zinc-50">
      <div className="mx-auto w-full max-w-lg px-6 py-10">
        <Link
          href="/stock/progress"
          className="text-sm text-zinc-600 hover:text-zinc-900"
        >
          ← 現場進捗一覧
        </Link>

        <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
          現場進捗を記録
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          記録した瞬間に、その時点の出庫総数・返却・未返却・現場に残っている数を確定して保存します。
          あとから返却が動いても、この記録の内容は変わりません。
        </p>

        {sp.error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(sp.error)}
          </p>
        )}

        <form action={recordSiteProgress} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="site_id"
              className="block text-sm font-medium text-zinc-700"
            >
              現場 <span className="text-red-600">*</span>
            </label>
            <div className="mt-1">
              <SearchableSelect
                id="site_id"
                name="site_id"
                required
                defaultValue={sp.site_id ?? ""}
                placeholder="現場名の一部を入力（例: 天）"
                options={(
                  (sites ?? []) as { id: string; code: string | null; name: string }[]
                ).map((s) => ({
                  value: s.id,
                  label: s.code ? `${s.code} — ${s.name}` : s.name,
                  keywords: s.code ?? undefined,
                }))}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="kind"
              className="block text-sm font-medium text-zinc-700"
            >
              区分 <span className="text-red-600">*</span>
            </label>
            <select
              id="kind"
              name="kind"
              required
              defaultValue={sp.kind ?? ""}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900"
            >
              <option value="">選択してください</option>
              {SITE_PROGRESS_ORDER.map((k) => (
                <option key={k} value={k}>
                  {SITE_PROGRESS_LABELS[k]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500">
              同じ区分をあとから記録し直すこともできます（最新の記録が有効になります）。
            </p>
          </div>

          <div>
            <label
              htmlFor="occurred_on"
              className="block text-sm font-medium text-zinc-700"
            >
              発生日
            </label>
            <input
              id="occurred_on"
              name="occurred_on"
              type="date"
              defaultValue={todayJst()}
              max={todayJst()}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900"
            />
            <p className="mt-1 text-xs text-zinc-500">
              実際にその状態になった日です。数量は「いま」の値で確定されます。
            </p>
          </div>

          <div>
            <label htmlFor="note" className="block text-sm font-medium text-zinc-700">
              メモ（任意）
            </label>
            <textarea
              id="note"
              name="note"
              rows={3}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              記録する
            </button>
            <Link
              href="/stock/progress"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              キャンセル
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
