"use client";

import Link from "next/link";
import { useState } from "react";
import { ScoutRequest, ScoutRequestStatus } from "@/lib/types/database";
import { offerNumbers } from "@/components/companies/OfferSummary";
import { EmptyState } from "@/components/ui/EmptyState";
import { Photo } from "@/components/ui/Photo";
import { CalendarIcon, ChevronRightIcon, ClockIcon } from "@/components/ui/Icons";
import { durationLabel } from "@/lib/utils/matching";
import { shortDate, shortTime } from "@/lib/utils/format";

const TABS: { status: ScoutRequestStatus; label: string; empty: string }[] = [
  { status: "pending", label: "未返信", empty: "返信待ちのスカウトはありません" },
  { status: "accepted", label: "承諾済み", empty: "承諾したスカウトはまだありません" },
  { status: "rejected", label: "履歴", empty: "辞退したスカウトはありません" },
];

export const SCOUT_STATUS_LABEL: Record<ScoutRequestStatus, string> = { pending: "未返信", accepted: "承諾済み", rejected: "辞退済み" };

/** ワーカーに届いたスカウトの一覧。くわしい条件と返信は、カードから開く画面で行う。 */
export function ScoutInbox({ scouts, photos = {} }: { scouts: ScoutRequest[]; photos?: Record<string, string> }) {
  const [tab, setTab] = useState<ScoutRequestStatus>("pending");
  const current = TABS.find((t) => t.status === tab)!;
  const shown = scouts.filter((s) => s.status === tab);
  const pendingCount = scouts.filter((s) => s.status === "pending").length;

  return <div>
    <div role="tablist" aria-label="スカウトの状態" className="app-tabs">
      {TABS.map((t) => <button key={t.status} type="button" role="tab" aria-selected={tab === t.status} onClick={() => setTab(t.status)} className="app-tab">
        {t.label}
        {t.status === "pending" && pendingCount > 0 && <span className="inline-flex min-w-6 justify-center rounded-full bg-brand-yellow px-1.5 text-xs font-bold leading-6 text-ink">{pendingCount}</span>}
      </button>)}
    </div>
    <div role="tabpanel" aria-label={current.label} className="mt-4 flex flex-col gap-3">
      {shown.length === 0 && <EmptyState title={current.empty} description={tab === "pending" ? "プロフィールと勤務希望を整えておくと、お店の目に留まりやすくなります。" : undefined} actionHref={tab === "pending" ? "/workers/mypage" : undefined} actionLabel={tab === "pending" ? "プロフィールを整える" : undefined} />}
      {shown.map((scout) => <ScoutCard key={scout.id} scout={scout} photo={scout.store_id ? photos[scout.store_id] : undefined} />)}
    </div>
  </div>;
}

function ScoutCard({ scout, photo }: { scout: ScoutRequest; photo?: string }) {
  const offer = offerNumbers(scout);
  const storeName = scout.store_name || scout.company_name || "店舗";
  return <article className="app-card">
    <div className="flex gap-3">
      <Photo src={photo} name={storeName} className="h-[4.5rem] w-24" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-bold leading-snug text-ink [overflow-wrap:anywhere]">{storeName}</h2>
          <span className={`shrink-0 ${scout.status === "pending" ? "app-pill" : "app-tag"}`}>{SCOUT_STATUS_LABEL[scout.status]}</span>
        </div>
        {scout.company_name && scout.company_name !== storeName && <p className="mt-1 truncate text-xs text-ink-soft">{scout.company_name}</p>}
      </div>
    </div>

    <div className="mt-4 flex items-center gap-4">
      <dl className="min-w-0 flex-1 space-y-1.5 text-base font-bold tabular-nums text-ink">
        <div className="flex items-center gap-2"><dt><CalendarIcon className="size-5 text-ink-soft" /><span className="sr-only">勤務日</span></dt><dd>{scout.preferred_work_date ? shortDate(scout.preferred_work_date) : "日付未定"}</dd></div>
        <div className="flex items-center gap-2"><dt><ClockIcon className="size-5 text-ink-soft" /><span className="sr-only">時間</span></dt><dd>{shortTime(scout.preferred_start_time)}〜{shortTime(scout.preferred_end_time)}</dd></div>
      </dl>
      {offer && <div className="shrink-0 border-l border-line pl-4 text-right">
        <p className="text-[1.75rem] font-black leading-none tabular-nums text-ink">{offer.total.toLocaleString()}<span className="ml-0.5 text-base font-bold">円</span></p>
        <p className="mt-1.5 text-xs text-ink-soft">時給 {offer.wage.toLocaleString()}円 × {durationLabel(offer.minutes)}</p>
      </div>}
    </div>

    {scout.message && <p className="mt-4 line-clamp-2 border-t border-line pt-3 text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">{scout.message}</p>}

    <Link href={`/workers/scouts/${scout.id}`} className="app-primary relative mt-4 w-full">
      {scout.status === "pending" ? "勤務条件を見る" : "内容を見る"}
      <ChevronRightIcon className="absolute right-4 size-5" />
    </Link>
    {scout.status === "pending" && <p className="mt-2 text-center text-xs text-ink-soft">承諾後にチャットが使えます</p>}
  </article>;
}
