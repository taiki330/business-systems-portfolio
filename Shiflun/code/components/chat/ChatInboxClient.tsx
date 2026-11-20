"use client";

import Link from "next/link";
import { useCallback } from "react";
import { getChatInbox } from "@/lib/actions/staff-chat";
import { useWorkerId } from "@/lib/hooks/use-worker-id";
import { useCurrentStore } from "@/lib/hooks/use-current-store";
import { usePollingData } from "@/lib/hooks/use-polling-data";
import { ChatThread, Participant, ParticipantRole } from "@/lib/types/database";
import { AccountRequired } from "@/components/ui/AccountRequired";
import { LoadingMascot } from "@/components/ui/LoadingMascot";
import { EmptyState } from "@/components/ui/EmptyState";
import { StoreSetupPrompt } from "@/components/companies/StoreSetupPrompt";

export function ChatInboxClient({ role }: { role: ParticipantRole }) {
  const { workerId, ready: workerReady } = useWorkerId();
  const { store, ready: storeReady } = useCurrentStore();
  if (role === "store") {
    if (!storeReady) return null;
    if (!store) return <StoreSetupPrompt />;
    return <Inbox key={store.id} actor={{ role, id: store.id }} />;
  }
  if (!workerReady) return null;
  return workerId ? <Inbox key={workerId} actor={{ role, id: workerId }} /> : <AccountRequired role={role} />;
}

function href(role: ParticipantRole, thread: ChatThread) {
  if (thread.kind === "scout") return `${role === "worker" ? "/workers" : "/managers"}/chat/${thread.id}`;
  return role === "worker" ? "/workers/chat/staff" : `/managers/chat/staff/${thread.id}`;
}

function when(iso: string) {
  const date = new Date(iso);
  const today = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) === date.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
  return date.toLocaleString("ja-JP", today ? { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" } : { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
}

function Inbox({ actor }: { actor: Participant }) {
  const { role, id } = actor;
  const load = useCallback(() => getChatInbox({ role, id }), [role, id]);
  const { data, error } = usePollingData(load);
  const accent = role === "store" ? "bg-brand-blue" : "bg-brand-blue";
  const hasStaffThread = data?.threads.some((t) => t.kind === "staff");
  return <div className="space-y-3">
    {error && <p role="alert" className="app-error">{error}</p>}
    {!data && !error && <LoadingMascot label="チャットを読み込み中…" />}
    {data && role === "worker" && !hasStaffThread && <Link href="/workers/join-store" className="app-card block text-sm leading-relaxed text-ink-soft">所属店舗を登録すると、店長とシフトの相談ができます。<span className="mt-1 block font-bold text-brand-blue">所属店舗を登録する</span></Link>}
    {data?.threads.length === 0 && <EmptyState title="まだ会話はありません" description={role === "store" ? "所属スタッフが登録されるか、スカウトが承諾されるとここに表示されます。" : "スカウトを承諾すると、お店とのチャットがここに表示されます。"} />}
    {!!data?.threads.length && <ul className="overflow-hidden rounded-xl border border-line bg-white">
      {data.threads.map((thread) => <li key={`${thread.kind}:${thread.id}`} className="border-b border-line last:border-b-0">
        <Link href={href(role, thread)} className="flex items-center gap-3 px-4 py-3.5 hover:bg-paper">
          <span aria-hidden="true" className={`grid size-11 shrink-0 place-items-center rounded-full text-base font-black text-white ${thread.kind === "staff" ? accent : "bg-brand-yellow"}`}>{thread.title.slice(0, 1)}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-bold text-ink">{thread.title}</span>{thread.lastMessage && <time className="shrink-0 text-[11px] text-ink-soft">{when(thread.lastMessage.created_at)}</time>}</span>
            <span className="mt-0.5 block truncate text-[11px] font-medium text-ink-soft">{thread.subtitle}</span>
            <span className="flex items-center justify-between gap-2"><span className={`truncate text-sm ${thread.unread ? "font-semibold text-ink" : "text-ink-soft"}`}>{thread.lastMessage ? `${thread.lastMessage.sender_role === role ? "あなた: " : ""}${thread.lastMessage.body}` : "まだメッセージはありません"}</span>{thread.unread > 0 && <span className="shrink-0 rounded-full bg-brand-yellow px-2 py-0.5 text-[11px] font-bold text-ink" aria-label={`未読${thread.unread}件`}>{thread.unread > 99 ? "99+" : thread.unread}</span>}</span>
          </span>
        </Link>
      </li>)}
    </ul>}
  </div>;
}
