"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { suspendAccount, SuspensionState } from "@/lib/actions/moderation";

type Props = {
  /** 停止する相手。ワーカーか店舗のどちらか一方。 */
  target: { kind: "worker" | "store"; id: string; name: string };
  /** 通報から押したときは、その通報も対応済みになる。 */
  reportId?: string;
};

/** 利用停止。ふだんは閉じておき、理由の入力と確認のチェックを済ませないと押せない。 */
export function SuspendForm({ target, reportId }: Props) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: SuspensionState, form: FormData) => {
    const result = await suspendAccount(prev, form);
    if (result.success) router.refresh();
    return result;
  }, {} as SuspensionState);
  const who = target.kind === "worker" ? "ワーカー" : "店舗";
  const id = `suspend_${reportId ?? target.id}`;
  return <details className="rounded-lg border border-line px-3">
    <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-rose-700">{who}「{target.name}」を利用停止にする</summary>
    <form action={action} className="space-y-3 pb-3 pt-1">
      <input type="hidden" name={target.kind === "worker" ? "worker_id" : "store_id"} value={target.id} />
      {reportId && <input type="hidden" name="report_id" value={reportId} />}
      <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-soft">
        <li>このアカウントはログインできなくなり、いまのログインも切れます。</li>
        <li>同じログインでワーカーと店舗の両方を登録している場合は、両方が止まります。</li>
        <li>停止した店舗に届いている返信待ちのスカウトは、辞退扱いになります。</li>
        <li>勤務・支払いの記録とチャットの履歴は、そのまま残ります。解除すると、またログインできます。</li>
      </ul>
      <div><label htmlFor={`${id}_reason`} className="app-label">停止の理由（記録に残ります）</label><textarea id={`${id}_reason`} name="reason" required rows={2} maxLength={1000} className="app-input" placeholder="例：繰り返しの嫌がらせメッセージのため" /></div>
      <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" name="confirm" required className="mt-1 size-4 accent-brand-blue" /><span>内容を確認しました。利用停止にします。</span></label>
      {state.error && <p role="alert" className="app-error">{state.error}</p>}
      <button disabled={pending} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-rose-700 px-4 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-50">{pending ? "停止中…" : "利用停止にする"}</button>
    </form>
  </details>;
}
