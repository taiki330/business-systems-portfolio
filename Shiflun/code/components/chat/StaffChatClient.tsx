"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { getStaffConversation, readStaffNotifications, sendStaffMessage } from "@/lib/actions/staff-chat";
import { useWorkerId } from "@/lib/hooks/use-worker-id";
import { useStoreId } from "@/lib/hooks/use-stored-id";
import { Participant, ParticipantRole } from "@/lib/types/database";
import { AccountRequired } from "@/components/ui/AccountRequired";
import { ChatRoom } from "@/components/chat/ChatRoom";
import { ChatSafetyPanel, ReportTarget } from "@/components/chat/ChatSafetyPanel";

/** 所属スタッフ ⇔ 店長。workerId を省略するとワーカー本人の会話を開く。 */
export function StaffChatClient({ role, workerId }: { role: ParticipantRole; workerId?: string }) {
  const { workerId: myWorkerId, ready: workerReady } = useWorkerId();
  const { storeId, ready: storeReady } = useStoreId();
  const id = role === "worker" ? myWorkerId : storeId;
  const staffId = role === "worker" ? myWorkerId : workerId;
  if (!(workerReady && storeReady)) return null;
  return id && staffId ? <StaffConversation key={`${role}:${id}:${staffId}`} actor={{ role, id }} workerId={staffId} /> : <AccountRequired role={role} />;
}

type Thread = Awaited<ReturnType<typeof getStaffConversation>>;

function StaffConversation({ actor: { role, id }, workerId }: { actor: Participant; workerId: string }) {
  const [result, setResult] = useState<Thread | null>(null);
  const load = useCallback((cursor?: { before?: number; after?: number }) => getStaffConversation({ role, id }, workerId, cursor), [role, id, workerId]);
  const send = useCallback((body: string, clientMessageId: string) => sendStaffMessage({ role, id }, workerId, body, clientMessageId), [role, id, workerId]);
  const markRead = useCallback((ids: string[]) => readStaffNotifications({ role, id }, workerId, ids), [role, id, workerId]);

  const [reportTarget, setReportTarget] = useState<ReportTarget>(null);

  const thread = result?.thread;
  const back = role === "worker" ? "/workers/chat" : "/managers/chat";
  const otherName = role === "worker" ? "店長" : thread ? `${thread.workerName}さん` : "スタッフ";
  return <ChatRoom
    role={role}
    load={load}
    send={send}
    markRead={markRead}
    onResult={setResult}
    blocked={result && !thread ? <section className="app-card py-8 text-center"><h2 className="text-lg font-bold text-ink">この会話は開けません</h2><p role="status" className="mt-2 text-sm leading-relaxed text-ink-soft">{result.error}</p><Link className="app-secondary mt-5" href={back}>チャット一覧へ</Link></section> : null}
    header={thread && <><p className="text-sm font-bold text-ink-soft">{role === "worker" ? `${thread.storeName} の店長` : `${thread.workerName}さん`}<span className="ml-2 text-xs font-medium text-ink-soft">{role === "worker" ? "所属先" : `${thread.storeName} 所属`}</span></p><ChatSafetyPanel actor={{ role, id }} kind="staff" threadId={workerId} otherName={otherName} target={reportTarget} onTargetChange={setReportTarget} /></>}
    onReport={setReportTarget}
    otherName={role === "worker" ? "店長" : thread ? thread.workerName : "スタッフ"}
    pill="所属スタッフ · シフトの相談"
    emptyHint={role === "worker"
      ? <>シフトの交代や、出られない日の相談などを<br />店長に直接送れます。</>
      : <>シフトのお願いや連絡事項を<br />スタッフに直接送れます。</>}
  />;
}
