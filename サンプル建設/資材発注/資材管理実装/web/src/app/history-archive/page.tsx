import { purgeOldStockHistory, startStockHistoryArchive } from "@/app/history-archive/actions";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type PageProps = { searchParams: Promise<{ error?: string; ok?: string; run_id?: string }> };

export default async function HistoryArchivePage({ searchParams }: PageProps) {
  const { error, ok, run_id: runId } = await searchParams;
  const supabase = await createClient();
  const { data: cutoffValue } = runId
    ? await supabase.rpc("get_stock_history_archive_cutoff", { p_run_id: runId })
    : { data: null };
  const archiveCutoff = cutoffValue as string | null;
  const [ledgerCount, returnsCount, overReturnsCount] = archiveCutoff
    ? await Promise.all([
        supabase.from("stock_ledger").select("id", { count: "exact", head: true }).lt("created_at", archiveCutoff),
        supabase.from("stock_returns").select("id", { count: "exact", head: true }).lt("created_at", archiveCutoff),
        supabase.from("over_returns").select("id", { count: "exact", head: true }).lt("created_at", archiveCutoff),
      ])
    : [{ count: 0 }, { count: 0 }, { count: 0 }];
  const pageLinks = (path: string, count: number | null | undefined) =>
    Array.from(
      { length: Math.max(1, Math.ceil((count ?? 0) / 10_000)) },
      (_, index) => `${path}?run_id=${encodeURIComponent(runId ?? "")}&page=${index + 1}`,
    );

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <Link href="/menu/master" className="text-sm text-zinc-600 hover:text-zinc-900">
            ホーム・マスタ・設定
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">履歴のExcel出力・削除</h1>
          <p className="mt-1 text-sm text-zinc-600">
            直近1年はシステム内に残します。それより前の対象履歴だけを出力・削除できます。
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(error)}
          </p>
        )}
        {ok === "stock-purged" && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            対象履歴を削除しました。直近1年分は引き続きシステム内に残ります。
          </p>
        )}

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-zinc-900">対象履歴</h2>
          <p className="mt-1 text-sm text-zinc-600">
            入出庫台帳、返却履歴、過入庫を、削除前にExcel用CSVとして出力します。
          </p>

          {!runId ? (
            <form action={startStockHistoryArchive} className="mt-4">
              <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                アーカイブ出力を開始
              </button>
            </form>
          ) : (
            <>
              <p className="mt-3 text-xs text-zinc-600">
                3種類すべてのファイルをダウンロードした場合のみ、削除ボタンが有効になります。10,000件を超える履歴は複数ファイルに分かれます。
              </p>
              <div className="mt-3 space-y-3">
                {(
                  [
                    ["入出庫台帳", pageLinks("/stock/ledger/export", ledgerCount.count)],
                    ["返却履歴", pageLinks("/stock/returns/export", returnsCount.count)],
                    ["過入庫", pageLinks("/stock/over-returns/export", overReturnsCount.count)],
                  ] as const
                ).map(([label, links]) => (
                  <div key={label}>
                    <p className="text-sm font-medium text-zinc-800">
                      {label}（{links.length}ファイル）
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {links.map((href, index) => (
                        <a
                          key={href}
                          href={href}
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                        >
                          {links.length === 1 ? "Excel出力" : `${index + 1}/${links.length} を出力`}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <form action={purgeOldStockHistory} className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
                <input type="hidden" name="run_id" value={runId} />
                <p className="text-sm font-semibold text-red-800">出力済みの対象履歴だけを削除</p>
                <p className="mt-1 text-xs text-red-700">
                  未確認の過入庫と、直近1年の訂正に関係する返却・台帳は削除されません。
                </p>
                <label className="mt-3 block text-sm text-red-800">
                  確認のため、「削除」と入力
                  <input
                    name="confirmation"
                    className="mt-1 block w-full max-w-xs rounded-lg border border-red-300 bg-white px-3 py-2 text-zinc-900"
                    autoComplete="off"
                  />
                </label>
                <button type="submit" className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800">
                  1年以上前の対象履歴を削除
                </button>
              </form>
            </>
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-zinc-900">削除対象外の履歴</h2>
          <p className="mt-1 text-sm text-zinc-600">
            仕入れ、リース、センター間移動、棚卸、在庫調整、未返却資材などは、この画面に含めず引き続きシステム内に残します。
          </p>
        </section>
      </main>
    </div>
  );
}
