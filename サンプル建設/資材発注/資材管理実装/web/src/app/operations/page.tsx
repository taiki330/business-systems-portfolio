import { fetchOperationLogs } from "@/lib/audit/fetch-operation-logs";
import {
  ACTOR_ROLE_LABELS,
  isOperationEntityType,
  OPERATION_ENTITY_LABELS,
  OPERATION_ENTITY_ORDER,
  OPERATION_LABELS,
} from "@/types/operation-log";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ type?: string }>;
};

/** detail の主要な値だけを人が読める形にする（全文は折りたたみで表示）。 */
function summarizeDetail(detail: Record<string, unknown> | null): string | null {
  if (!detail) return null;
  const parts: string[] = [];
  const num = (v: unknown) => (v === null || v === undefined ? null : String(v));

  if (detail.input_quantity !== undefined) {
    parts.push(`入力 ${num(detail.input_quantity)}`);
    if (detail.normal_quantity !== undefined) {
      parts.push(`在庫加算 ${num(detail.normal_quantity)}`);
    }
    if (detail.over_quantity !== undefined && Number(detail.over_quantity) > 0) {
      parts.push(`過入庫 ${num(detail.over_quantity)}`);
    }
  }
  if (detail.quantity_before !== undefined) {
    parts.push(`${num(detail.quantity_before)} → ${num(detail.quantity_after)}`);
  }
  if (detail.counted_quantity !== undefined) {
    parts.push(
      `実測 ${num(detail.counted_quantity)} / システム ${num(detail.system_quantity)}`,
    );
  }
  if (detail.movement_type !== undefined) {
    parts.push(detail.movement_type === "in" ? "入庫" : "出庫");
  }
  if (detail.prev_status !== undefined && detail.prev_status !== null) {
    parts.push(`${detail.prev_status} → ${detail.status}`);
  }
  if (detail.kind !== undefined) parts.push(String(detail.kind));
  if (detail.location !== undefined) parts.push(String(detail.location));

  return parts.length > 0 ? parts.join(" / ") : null;
}

/**
 * 操作履歴（事務向け）。
 * 業務データを変更した操作のみが記録される（検索・閲覧・PDF 閲覧は対象外）。
 */
export default async function OperationLogsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const entityType =
    sp.type && isOperationEntityType(sp.type) ? sp.type : undefined;

  const { rows, error } = await fetchOperationLogs(entityType);

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-[1400px] px-6 py-4">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
            ホーム
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">操作履歴</h1>
          <p className="mt-1 text-sm text-zinc-500">
            在庫や依頼などの業務データを変更した操作の記録です（新しい順に最大200件）。参照・検索の操作は記録されません。
          </p>

          <nav className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/operations"
              className={
                !entityType
                  ? "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
              }
            >
              すべて
            </Link>
            {OPERATION_ENTITY_ORDER.map((t) => (
              <Link
                key={t}
                href={`/operations?type=${t}`}
                className={
                  entityType === t
                    ? "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white"
                    : "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                }
              >
                {OPERATION_ENTITY_LABELS[t]}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">操作履歴の読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
          </div>
        )}

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            該当する操作履歴がありません。
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">日時</th>
                  <th className="px-4 py-3 font-medium">操作者</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                  <th className="px-4 py-3 font-medium">対象</th>
                  <th className="px-4 py-3 text-right font-medium">数量</th>
                  <th className="px-4 py-3 font-medium">内容</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => {
                  const summary = summarizeDetail(row.detail);
                  return (
                    <tr key={row.id} className="align-top hover:bg-zinc-50/80">
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                        {new Date(row.createdAt).toLocaleString("ja-JP")}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        <div>{row.actorName ?? "-"}</div>
                        {row.actorRole && (
                          <div className="text-xs text-zinc-500">
                            {ACTOR_ROLE_LABELS[row.actorRole] ?? row.actorRole}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-zinc-900">
                        {OPERATION_LABELS[row.operation] ?? row.operation}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {row.productName && <div>{row.productName}</div>}
                        {row.siteName && (
                          <div className="text-xs text-zinc-500">
                            現場: {row.siteName}
                          </div>
                        )}
                        {!row.productName && !row.siteName && (
                          <span className="text-zinc-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                        {row.quantity ?? "-"}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {summary ?? "-"}
                        {row.detail && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-600">
                              詳細
                            </summary>
                            <pre className="mt-1 max-w-md overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-zinc-600">
                              {JSON.stringify(row.detail, null, 2)}
                            </pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!error && <p className="mt-4 text-sm text-zinc-500">{rows.length} 件</p>}
      </main>
    </div>
  );
}
