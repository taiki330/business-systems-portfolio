"use client";

import Link from "next/link";
import { ReactNode, useCallback } from "react";
import { usePathname } from "next/navigation";
import { getChatUnreadCount } from "@/lib/actions/notifications";
import { useWorkerId } from "@/lib/hooks/use-worker-id";
import { useStoreId } from "@/lib/hooks/use-stored-id";
import { usePollingData } from "@/lib/hooks/use-polling-data";
import { ParticipantRole } from "@/lib/types/database";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  /** このメニューを「選択中」にする画面（href 以外）。 */
  also?: string[];
  /** 未読メッセージ数のバッジを出す */
  chat?: boolean;
};

function Icon({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-6">{children}</svg>;
}

const SEARCH = <Icon><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Icon>;
const SEND = <Icon><path d="M20.5 3.5 3.5 10.2l6.3 2.6 2.600 6.300L20.500 3.500Z" /><path d="m9.800 12.800 4.200-4.200" /></Icon>;
const CALENDAR = <Icon><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></Icon>;
const CHAT = <Icon><path d="M4.500 5.500h15a1 1 0 0 1 1 1v9.500a1 1 0 0 1-1 1h-8l-4.500 3.500v-3.500h-2.500a1 1 0 0 1-1-1V6.500a1 1 0 0 1 1-1Z" /></Icon>;
const MORE = <Icon><path d="M5.500 12h.01M12 12h.01M18.500 12h.01" strokeWidth="2.800" /></Icon>;
const PERSON = <Icon><circle cx="12" cy="8" r="3.800" /><path d="M4.500 20.500c.700-3.900 3.700-6 7.500-6s6.800 2.100 7.500 6" /></Icon>;

const MANAGER_NAV: NavItem[] = [
  { href: "/companies", label: "人材探し", icon: SEARCH },
  { href: "/managers/scouts", label: "スカウト", icon: SEND },
  { href: "/managers/shifts", label: "シフト", icon: CALENDAR, also: ["/managers/shift-periods"] },
  { href: "/managers/chat", label: "チャット", icon: CHAT, chat: true },
  { href: "/managers/more", label: "その他", icon: MORE, also: ["/managers/staff", "/managers/settings", "/managers/payouts", "/managers/checkin-qr", "/managers/verify", "/managers/notifications"] },
];

const WORKER_NAV: NavItem[] = [
  { href: "/workers/shifts", label: "希望提出", icon: CALENDAR },
  { href: "/workers/scouts", label: "スカウト", icon: SEND },
  { href: "/workers/chat", label: "チャット", icon: CHAT, chat: true },
  { href: "/workers/mypage", label: "プロフィール", icon: PERSON, also: ["/workers/earnings", "/workers/verify-identity", "/workers/notifications"] },
];

/** 下のメニューを出すワーカー側の画面。登録前の画面と、他人から見るプロフィール（/workers/[id]）には出さない。 */
const WORKER_AREA = ["/workers/shifts", "/workers/scouts", "/workers/chat", "/workers/mypage", "/workers/earnings", "/workers/verify-identity", "/workers/notifications", "/workers/join-store"];

function isActive(item: NavItem, pathname: string): boolean {
  return [item.href, ...(item.also ?? [])].some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

function ChatBadge({ role }: { role: ParticipantRole }) {
  const { workerId, ready: workerReady } = useWorkerId();
  const { storeId, ready: storeReady } = useStoreId();
  const id = role === "worker" ? workerId : storeId;
  if (!(workerReady && storeReady) || !id) return null;
  return <UnreadCount key={`${role}:${id}`} role={role} id={id} />;
}

function UnreadCount({ role, id }: { role: ParticipantRole; id: string }) {
  const load = useCallback(() => getChatUnreadCount({ role, id }), [role, id]);
  const { data } = usePollingData(load);
  if (!data?.unread) return null;
  return <span aria-label={`未読${data.unread}件`} className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-brand-blue px-1 text-center text-[10px] font-bold leading-[18px] text-white">{data.unread > 99 ? "99+" : data.unread}</span>;
}

export function BottomNav() {
  const pathname = usePathname();

  const isManagerArea = (pathname.startsWith("/managers") && pathname !== "/managers/login") || pathname.startsWith("/companies");
  const isWorkerArea = WORKER_AREA.some((href) => pathname === href || pathname.startsWith(`${href}/`));
  if (!isManagerArea && !isWorkerArea) return null;

  const items = isManagerArea ? MANAGER_NAV : WORKER_NAV;

  return (
    <nav aria-label={isManagerArea ? "店舗メニュー" : "ワーカーメニュー"} className="fixed bottom-0 left-0 right-0 z-50 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-lg gap-1 px-2 py-1.5">
        {items.map((item) => {
          const active = isActive(item, pathname);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] text-ink ${active ? "bg-brand-yellow font-bold" : "font-medium hover:bg-paper"}`}
              >
                <span className="relative">
                  {item.icon}
                  {item.chat && <ChatBadge role={isManagerArea ? "store" : "worker"} />}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
