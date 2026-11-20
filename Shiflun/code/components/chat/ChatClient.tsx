"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { getConversation, sendChatMessage } from "@/lib/actions/messages";
import { readChatNotifications } from "@/lib/actions/notifications";
import { useWorkerId } from "@/lib/hooks/use-worker-id";
import { useStoreId } from "@/lib/hooks/use-stored-id";
import { Participant, ParticipantRole, ScoutRequest } from "@/lib/types/database";
import { AccountRequired } from "@/components/ui/AccountRequired";
import { OfferSummary } from "@/components/companies/OfferSummary";
import { ChatRoom } from "@/components/chat/ChatRoom";
import { ChatSafetyPanel, ReportTarget } from "@/components/chat/ChatSafetyPanel";

export function ChatClient({ role, scoutId }: { role: ParticipantRole; scoutId: string }) {
  const { workerId, ready: workerReady } = useWorkerId();
  const { storeId, ready: storeReady } = useStoreId();
  const id = role === "worker" ? workerId : storeId;
  if (!(workerReady && storeReady)) return null;
  return id ? <Conversation key={`${role}:${id}:${scoutId}`} actor={{ role, id }} scoutId={scoutId} /> : <AccountRequired role={role} />;
}

function Conversation({ actor: { role, id }, scoutId }: { actor: Participant; scoutId: string }) {
  const [result, setResult] = useState<{ scout: ScoutRequest | null; error: string | null } | null>(null);
  const load = useCallback((cursor?: { before?: number; after?: number }) => getConversation({ role, id }, scoutId, cursor), [role, id, scoutId]);
  const send = useCallback((body: string, clientMessageId: string) => sendChatMessage({ role, id }, scoutId, body, clientMessageId), [role, id, scoutId]);
  const markRead = useCallback((ids: string[]) => readChatNotifications({ role, id }, scoutId, ids), [role, id, scoutId]);

  const [reportTarget, setReportTarget] = useState<ReportTarget>(null);

  const scout = result?.scout;
  const open = scout && scout.status === "accepted" && scout.store_id;
  const base = role === "worker" ? "/workers" : "/managers";
  const otherName = role === "worker" ? scout?.store_name ?? "お店" : scout?.workers?.name ?? "ワーカー";
  return <ChatRoom
    role={role}
    load={load}
    send={send}
    markRead={markRead}
    onResult={setResult}
    blocked={result && !open ? <section className="app-card py-8 text-center"><h2 className="text-lg font-bold text-ink">承諾後にチャットが開きます</h2><p role="status" className="mt-2 text-sm leading-relaxed text-ink-soft">{result.error || "ワーカーがスカウトを承諾すると、お互いにメッセージを送れます。"}</p><Link className="app-secondary mt-5" href={`${base}/scouts`}>スカウトに戻る</Link></section> : null}
    header={scout && <><details className="app-card"><summary className="cursor-pointer text-sm font-bold text-ink">{role === "store" ? `${scout.workers?.name ?? "ワーカー"}さん` : scout.store_name} · {scout.preferred_work_date} の勤務条件</summary><div className="mt-4"><p className="mb-3 text-sm text-ink-soft">{scout.preferred_start_time?.slice(0, 5)}〜{scout.preferred_end_time?.slice(0, 5)}</p><OfferSummary scout={scout} /></div></details><ChatSafetyPanel actor={{ role, id }} kind="scout" threadId={scoutId} otherName={otherName} target={reportTarget} onTargetChange={setReportTarget} /></>}
    otherName={otherName}
    onReport={setReportTarget}
    pill="承諾済み · チャットで相談できます"
    emptyHint={<>あいさつから始めましょう。<br />集合場所や持ち物など、当日のことを相談できます。</>}
  />;
}
