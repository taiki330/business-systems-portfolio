"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { getNotifications, readNotifications } from "@/lib/actions/notifications";
import { useWorkerId } from "@/lib/hooks/use-worker-id";
import { useStoreId } from "@/lib/hooks/use-stored-id";
import { usePollingData } from "@/lib/hooks/use-polling-data";
import { AccountRequired } from "@/components/ui/AccountRequired";
import { LoadingMascot } from "@/components/ui/LoadingMascot";
import { EmptyState } from "@/components/ui/EmptyState";
import { Participant, ParticipantRole, AppNotification } from "@/lib/types/database";

export function NotificationsClient({ role }: { role: ParticipantRole }) {
  const { workerId, ready: workerReady } = useWorkerId();
  const { storeId, ready: storeReady } = useStoreId();
  const id = role === "worker" ? workerId : storeId;
  if (!(workerReady && storeReady)) return null;
  return id ? <NotificationList key={`${role}:${id}`} actor={{ role, id }} /> : <AccountRequired role={role} />;
}

function notificationHref(role: ParticipantRole, n: AppNotification) {
  const base = role === "worker" ? "/workers" : "/managers";
  if (n.kind === "staff_message") return role === "worker" ? "/workers/chat/staff" : `/managers/chat/staff/${n.staff_worker_id}`;
  if ((n.kind === "message" || n.kind === "scout_accepted") && n.scout_id) return `${base}/chat/${n.scout_id}`;
  return `${base}/scouts`;
}

function NotificationList({ actor }: { actor: Participant }) {
  const { role, id } = actor;
  const load = useCallback(() => getNotifications({ role, id }), [role, id]);
  const { data, error, refresh } = usePollingData(load);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  async function open(notification: AppNotification) {
    setPending(true);
    try {
      const result = await readNotifications(actor, [notification.id]);
      if (result.error) { setActionError(result.error); return; }
      router.push(notificationHref(role, notification));
      void refresh();
    } catch { setActionError("通知を開けませんでした。もう一度お試しください。"); }
    finally { setPending(false); }
  }
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-2"><span className="app-pill">未読 {data?.unread ?? 0}件</span><button className="text-sm font-semibold text-brand-blue" disabled={pending || !data?.notifications.length} onClick={async () => {
      setPending(true);
      try { const result = await readNotifications(actor, data!.notifications.filter((n) => !n.read_at).map((n) => n.id)); setActionError(result.error); await refresh(); }
      catch { setActionError("既読にできませんでした。"); }
      finally { setPending(false); }
    }}>表示中を既読に</button></div>
    {(error || actionError) && <p role="alert" className="app-error">{error || actionError}</p>}
    {!data && !error && <LoadingMascot label="お知らせを読み込み中…" />}
    {data?.notifications.length === 0 && <EmptyState title="新しいお知らせをお待ちください" description="スカウトやメッセージの新着がここに届きます。" />}
    {data?.notifications.map((n) => <button key={n.id} disabled={pending} onClick={() => void open(n)} className={`app-card w-full text-left transition hover:border-brand-blue ${!n.read_at ? "border-brand-blue bg-brand-blue-light/40" : ""}`}>
      <div className="flex items-center gap-2">{!n.read_at && <span className="size-2 shrink-0 rounded-full bg-brand-blue" aria-label="未読" />}<h2 className="text-sm font-bold text-ink">{n.title}</h2></div><p className="mt-2 break-words text-sm leading-relaxed text-ink-soft">{n.body}</p><p className="mt-3 text-xs text-ink-soft">{new Date(n.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p>
    </button>)}
    {data && data.notifications.length >= 100 && <p className="text-center text-xs text-ink-soft">最近のお知らせ100件を表示しています。</p>}
  </div>;
}
