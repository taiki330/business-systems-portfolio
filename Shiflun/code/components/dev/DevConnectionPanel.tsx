import {
  checkSupabaseConnection,
  TABLE_LABELS,
} from "@/lib/supabase/connection-check";

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        connected ? "bg-brand-blue" : "bg-rose-500"
      }`}
      aria-hidden="true"
    />
  );
}

export async function DevConnectionPanel() {
  const result = await checkSupabaseConnection();

  return (
    <details className="mt-10 rounded-xl border border-dashed border-line bg-chip/60">
      <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-ink-soft select-none">
        開発者向け：Supabase 接続確認
      </summary>
      <div className="space-y-3 border-t border-line px-4 py-4">
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          <StatusDot connected={result.connected} />
          <span>{result.message}</span>
        </div>

        {result.tables.length > 0 && (
          <ul className="space-y-2">
            {result.tables.map((tableResult) => (
              <li
                key={tableResult.table}
                className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs"
              >
                <span className="text-ink-soft">
                  {TABLE_LABELS[tableResult.table]}
                </span>
                <span
                  className={
                    tableResult.ok ? "text-brand-blue" : "text-rose-700"
                  }
                >
                  {tableResult.ok
                    ? `OK（${tableResult.count ?? 0} 件）`
                    : "エラー"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
