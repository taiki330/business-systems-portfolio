"use client";

import { FormEvent, useEffect, useState } from "react";
import { getBlockState, reportChat, setBlock, ThreadKind } from "@/lib/actions/chat-safety";
import { CHAT_REPORT_REASONS } from "@/lib/constants/safety";
import { ChatReportReason, Participant, ThreadMessage } from "@/lib/types/database";

/** 通報の対象。"thread" は会話全体、メッセージを渡すとそのメッセージ。 */
export type ReportTarget = ThreadMessage | "thread" | null;

type Props = {
  actor: Participant;
  kind: ThreadKind;
  /** scout: scout_id / staff: worker_id */
  threadId: string;
  otherName: string;
  target: ReportTarget;
  onTargetChange: (target: ReportTarget) => void;
};

/** チャット画面の「通報する」「ブロックする」。通報したことは相手に伝わらない。 */
export function ChatSafetyPanel({ actor: { role, id }, kind, threadId, otherName, target, onTargetChange }: Props) {
  const [blocked, setBlocked] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getBlockState({ role, id }, kind, threadId).then((result) => { if (active) setBlocked(result.blocked); });
    return () => { active = false; };
  }, [role, id, kind, threadId]);

  async function changeBlock(next: boolean) {
    setBusy(true); setError(null); setNotice(null);
    const result = await setBlock({ role, id }, kind, threadId, next);
    setBusy(false); setConfirmingBlock(false);
    if (result.error) { setError(result.error); return; }
    setBlocked(result.blocked);
    setNotice(result.blocked ? `${otherName}をブロックしました。` : "ブロックを解除しました。");
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null); setNotice(null);
    const result = await reportChat({ role, id }, kind, threadId, {
      messageId: target && target !== "thread" ? target.id : null,
      reason: String(form.get("reason")) as ChatReportReason,
      detail: String(form.get("detail") ?? ""),
    });
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    onTargetChange(null);
    setNotice("通報を受け付けました。運営が内容を確認します。");
  }

  const linkButton = "min-h-11 px-1 text-xs font-semibold text-ink-soft underline underline-offset-2 hover:text-ink disabled:opacity-50";
  return <section aria-label="通報とブロック" className="space-y-3">
    {blocked && <p role="status" className="rounded-xl border border-brand-yellow bg-brand-yellow-light p-3 text-sm leading-relaxed text-brand-yellow-dark">{otherName}をブロックしています。お互いにメッセージを送れません。</p>}
    <div className="flex flex-wrap items-center justify-end gap-x-4">
      <button type="button" className={linkButton} disabled={busy} onClick={() => { setNotice(null); setError(null); setConfirmingBlock(false); onTargetChange(target ? null : "thread"); }}>通報する</button>
      {blocked
        ? <button type="button" className={linkButton} disabled={busy} onClick={() => void changeBlock(false)}>ブロックを解除する</button>
        : <button type="button" className={linkButton} disabled={busy} onClick={() => { setNotice(null); setError(null); onTargetChange(null); setConfirmingBlock((open) => !open); }}>ブロックする</button>}
    </div>
    {error && <p role="alert" className="app-error">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-chip p-3 text-sm text-ink-soft">{notice}</p>}

    {confirmingBlock && !blocked && <div className="app-card space-y-3">
      <h2 className="text-sm font-bold text-ink">{otherName}をブロックしますか？</h2>
      <p className="text-sm leading-relaxed text-ink-soft">ブロックすると、お互いにメッセージを送れなくなり、{role === "worker" ? "このお店からのスカウトも届かなくなります" : "このワーカーは人材検索に表示されず、スカウトも送れなくなります"}。ブロックしたことは相手に通知されません。あとで解除できます。</p>
      <div className="flex gap-2"><button type="button" className="app-secondary flex-1" disabled={busy} onClick={() => setConfirmingBlock(false)}>やめる</button><button type="button" className="app-secondary flex-1 border-rose-300 text-rose-700" disabled={busy} onClick={() => void changeBlock(true)}>{busy ? "処理中…" : "ブロックする"}</button></div>
    </div>}

    {target && <form onSubmit={submitReport} className="app-card space-y-4">
      <h2 className="text-sm font-bold text-ink">運営に通報する</h2>
      {target !== "thread"
        ? <blockquote className="rounded-xl bg-paper p-3 text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-semibold text-ink-soft">通報するメッセージ</span>{target.body}</blockquote>
        : <p className="text-sm leading-relaxed text-ink-soft">{otherName}とのやり取り全体を通報します。特定のメッセージを通報したいときは、そのメッセージの下の「通報」を押してください。</p>}
      <div><label htmlFor="report_reason" className="app-label">理由</label><select id="report_reason" name="reason" required defaultValue="" className="app-input"><option value="" disabled>選んでください</option>{CHAT_REPORT_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></div>
      <div><label htmlFor="report_detail" className="app-label">くわしい状況（任意）</label><textarea id="report_detail" name="detail" rows={3} maxLength={1000} className="app-input" placeholder="いつ、どんなことがあったか" /></div>
      <p className="text-xs leading-relaxed text-ink-soft">通報したことは相手に伝わりません。運営が内容を確認し、利用規約にもとづいて対応します。</p>
      <div className="flex gap-2"><button type="button" className="app-secondary flex-1" disabled={busy} onClick={() => onTargetChange(null)}>やめる</button><button className="app-primary flex-1" disabled={busy}>{busy ? "送信中…" : "通報を送る"}</button></div>
    </form>}
  </section>;
}
