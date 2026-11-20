"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback } from "react";
import { useWorkerId } from "@/lib/hooks/use-worker-id";
import { useStoreId } from "@/lib/hooks/use-stored-id";
import { usePollingData } from "@/lib/hooks/use-polling-data";
import { getNotifications } from "@/lib/actions/notifications";
import { Participant } from "@/lib/types/database";

export function NotificationBell() {
  const path = usePathname();
  const { workerId } = useWorkerId();
  const { storeId } = useStoreId();
  const role = path.startsWith("/workers") || path.startsWith("/checkin") ? "worker" : "store";
  const id = role === "worker" ? workerId : storeId;
  if (!id) return null;
  return <BellCount key={`${role}:${id}`} actor={{ role, id }} />;
}

function BellCount({ actor }: { actor: Participant }) {
  const { role, id } = actor;
  const load = useCallback(() => getNotifications({ role, id }), [role, id]);
  const { data } = usePollingData(load);
  const unread = data?.unread ?? 0;
  return <Link href={role === "worker" ? "/workers/notifications" : "/managers/notifications"} aria-label={`お知らせ${unread ? `・未読${unread}件` : ""}`} className="relative -mr-2 inline-flex size-11 shrink-0 items-center justify-center text-ink">
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-7"><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7 2.5 7h-17S6 15 6 9Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
    {unread > 0 && <span className="absolute right-0 top-0.5 min-w-5 rounded-full bg-brand-yellow px-1 text-center text-[11px] font-bold leading-5 text-ink">{unread > 99 ? "99+" : unread}</span>}
  </Link>;
}
