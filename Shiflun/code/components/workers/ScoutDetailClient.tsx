"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode, useActionState, useCallback } from "react";
import { getScoutsByWorkerId, updateScoutStatus, ScoutStatusState } from "@/lib/actions/scouts";
import { useCurrentWorker } from "@/lib/hooks/use-current-worker";
import { usePollingData } from "@/lib/hooks/use-polling-data";
import { ScoutRequest, Worker } from "@/lib/types/database";
import { OfferSummary } from "@/components/companies/OfferSummary";
import { SCOUT_STATUS_LABEL } from "@/components/workers/ScoutInbox";
import { AccountRequired } from "@/components/ui/AccountRequired";
import { LoadingMascot } from "@/components/ui/LoadingMascot";
import { Photo } from "@/components/ui/Photo";
import { shortDate, shortTime } from "@/lib/utils/format";

/** スカウト1件の勤務条件と、承諾・辞退。 */
export function ScoutDetailClient({ scoutId }: { scoutId: string }) {
  const { worker, ready } = useCurrentWorker();
  if (!ready) return null;
  return worker ? <Detail key={`${worker.id}:${scoutId}`} worker={worker} scoutId={scoutId} /> : <AccountRequired role="worker" />;
}

function Detail({ worker, scoutId }: { worker: Worker; scoutId: string }) {
  const load = useCallback(() => getScoutsByWorkerId(worker.id), [worker.id]);
  const { data, error, refresh } = usePollingData(load);
  if (error) return <p role="alert" className="app-error">{error}</p>;
  if (!data) return <LoadingMascot label="スカウトを読み込み中…" />;
  const scout = data.scouts.find((s) => s.id === scoutId);
  if (!scout) {
    return <section className="app-card py-8 text-center">
      <h2 className="app-section-title">このスカウトは見つかりません</h2>
      <p className="mt-2 text-sm text-ink-soft">取り下げられたか、すでに終了しています。</p>
      <Link href="/workers/scouts" className="app-secondary mt-5">スカウト一覧へ</Link>
    </section>;
  }
  return <ScoutConditions scout={scout} workerId={worker.id} photo={scout.store_id ? data.photos[scout.store_id] : undefined} onReply={refresh} />;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex gap-3 border-b border-line py-3 text-sm last:border-b-0">
    <dt className="w-20 shrink-0 text-ink-soft">{label}</dt>
    <dd className="min-w-0 flex-1 font-bold text-ink [overflow-wrap:anywhere]">{children}</dd>
  </div>;
}

function ScoutConditions({ scout, workerId, photo, onReply }: { scout: ScoutRequest; workerId: string; photo?: string; onReply: () => Promise<void> }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: ScoutStatusState, form: FormData) => {
    const result = await updateScoutStatus(prev, form);
    if (result.status) await onReply();
    if (result.status === "accepted" && scout.store_id) router.push(`/workers/chat/${scout.id}`);
    return result;
  }, {});
  const status = state.status ?? scout.status;
  const storeName = scout.store_name || scout.company_name || "店舗";

  return <div className="flex flex-col gap-4">
    <section className="app-card">
      <div className="flex items-center gap-3">
        <Photo src={photo} name={storeName} className="h-20 w-28" />
        <div className="min-w-0 flex-1">
          <span className={status === "pending" ? "app-pill" : "app-tag"}>{SCOUT_STATUS_LABEL[status]}</span>
          <h2 className="mt-2 text-lg font-bold leading-snug text-ink [overflow-wrap:anywhere]">{storeName}</h2>
          {scout.company_name && scout.company_name !== storeName && <p className="mt-0.5 text-xs text-ink-soft [overflow-wrap:anywhere]">{scout.company_name}</p>}
        </div>
      </div>
      <div className="mt-4"><OfferSummary scout={scout} /></div>
    </section>

    <section className="app-card py-1">
      <dl>
        <Row label="日にち">{scout.preferred_work_date ? shortDate(scout.preferred_work_date) : "日付未定"}</Row>
        <Row label="時間">{shortTime(scout.preferred_start_time)}〜{shortTime(scout.preferred_end_time)}</Row>
        <Row label="休憩">{(scout.break_minutes ?? 0) > 0 ? `${scout.break_minutes}分` : "なし"}</Row>
        <Row label="支払い">お店から直接受け取ります</Row>
      </dl>
    </section>

    {scout.message && <section className="app-card">
      <h3 className="text-sm font-bold text-ink-soft">お店からのメッセージ</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">{scout.message}</p>
    </section>}

    {state.error && <p role="alert" className="app-error">{state.error}</p>}

    {status === "pending" && <form action={action} className="space-y-2">
      <input type="hidden" name="scout_id" value={scout.id} />
      <input type="hidden" name="worker_id" value={workerId} />
      <p className="text-center text-xs leading-relaxed text-ink-soft">承諾すると勤務予定に追加され、お店とのチャットが開きます。</p>
      <div className="flex gap-2">
        <button name="status" value="rejected" disabled={pending} className="app-secondary flex-1">辞退する</button>
        <button name="status" value="accepted" disabled={pending} className="app-primary flex-[2]">{pending ? "返信中…" : "承諾する"}</button>
      </div>
    </form>}
    {status === "accepted" && (scout.store_id
      ? <Link className="app-primary w-full" href={`/workers/chat/${scout.id}`}>お店とチャットする</Link>
      : <p className="text-sm text-ink-soft">このスカウトは店舗情報の確認が必要です。</p>)}
    {status === "rejected" && <p className="app-notice">このスカウトは辞退済み、または取り消されました。</p>}
  </div>;
}
