"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Store, ScoutRequest, ScoutRequestStatus } from "@/lib/types/database";
import { getScoutsByStoreId, StoreScout } from "@/lib/actions/scouts";
import { useCurrentStore } from "@/lib/hooks/use-current-store";
import { usePollingData } from "@/lib/hooks/use-polling-data";
import { StoreSetupPrompt } from "@/components/companies/StoreSetupPrompt";
import { LoadingMascot } from "@/components/ui/LoadingMascot";
import { EmptyState } from "@/components/ui/EmptyState";
import { Photo } from "@/components/ui/Photo";
import { CalendarIcon, ClockIcon } from "@/components/ui/Icons";
import { OfferSummary } from "@/components/companies/OfferSummary";
import { StoreCostSummary } from "@/components/companies/StoreCostSummary";
import { shortDate, shortTime } from "@/lib/utils/format";

const TABS: { status: ScoutRequestStatus; label: string; empty: string }[] = [
  { status: "pending", label: "返信待ち", empty: "返信待ちのスカウトはありません" },
  { status: "accepted", label: "承諾済み", empty: "承諾されたスカウトはまだありません" },
  { status: "rejected", label: "辞退・取消", empty: "辞退されたスカウトはありません" },
];

function SavedCost({ scout }: { scout: ScoutRequest }) {
  return scout.offered_total_yen != null && scout.service_fee_yen != null && scout.store_total_yen != null && scout.work_minutes != null
    ? <StoreCostSummary hourlyWage={Number(scout.offered_hourly_wage)} workMinutes={scout.work_minutes} totalYen={Number(scout.offered_total_yen)} feePercent={Number(scout.service_fee_percent)} feeYen={Number(scout.service_fee_yen)} storeTotalYen={Number(scout.store_total_yen)} />
    : <OfferSummary scout={scout} />;
}

export function StoreScoutsClient() {
  const { store, ready } = useCurrentStore();
  if (ready && !store) return <StoreSetupPrompt />;
  return store ? <StoreScoutFeed key={store.id} store={store} /> : null;
}

function StoreScoutFeed({ store }: { store: Store }) {
  const load = useCallback(() => getScoutsByStoreId(store.id), [store.id]);
  const { data, error } = usePollingData(load);
  const [tab, setTab] = useState<ScoutRequestStatus>("pending");
  if (error) return <p role="alert" className="app-error">{error}</p>;
  if (!data) return <LoadingMascot label="送ったスカウトを読み込み中…" />;
  if (data.scouts.length === 0) return <EmptyState title="まだスカウトを送っていません" description="お店に合うワーカーを探して声をかけましょう。" actionHref="/companies" actionLabel="ワーカーを探す" />;

  const current = TABS.find((t) => t.status === tab)!;
  const shown = data.scouts.filter((s) => s.status === tab);
  const count = (status: ScoutRequestStatus) => data.scouts.filter((s) => s.status === status).length;

  return <div>
    <div role="tablist" aria-label="スカウトの状態" className="app-tabs">
      {TABS.map((t) => <button key={t.status} type="button" role="tab" aria-selected={tab === t.status} onClick={() => setTab(t.status)} className="app-tab">
        {t.label}
        {t.status !== "rejected" && count(t.status) > 0 && <span className={`inline-flex min-w-6 justify-center rounded-full px-1.5 text-xs font-bold leading-6 text-ink ${t.status === "pending" ? "bg-brand-yellow" : "bg-chip"}`}>{count(t.status)}</span>}
      </button>)}
    </div>
    <div role="tabpanel" aria-label={current.label} className="mt-4 flex flex-col gap-3">
      {shown.length === 0 && <p className="py-8 text-center text-sm text-ink-soft">{current.empty}</p>}
      {shown.map((scout) => <SentScoutCard key={scout.id} scout={scout} photo={data.photos[scout.worker_id]} />)}
    </div>
  </div>;
}

function SentScoutCard({ scout, photo }: { scout: StoreScout; photo?: string }) {
  const name = scout.workers?.name ?? "ワーカー";
  return <article className="app-card">
    <div className="flex items-center gap-3">
      <Photo src={photo} name={name} className="size-16" />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-bold text-ink">{name}さん</h2>
        <dl className="mt-1 space-y-0.5 text-sm font-bold tabular-nums text-ink">
          <div className="flex items-center gap-1.5"><dt><CalendarIcon className="size-4 text-ink-soft" /><span className="sr-only">勤務日</span></dt><dd>{scout.preferred_work_date ? shortDate(scout.preferred_work_date) : "日付未定"}</dd></div>
          <div className="flex items-center gap-1.5"><dt><ClockIcon className="size-4 text-ink-soft" /><span className="sr-only">時間</span></dt><dd>{shortTime(scout.preferred_start_time)}〜{shortTime(scout.preferred_end_time)}</dd></div>
        </dl>
      </div>
    </div>
    <details className="mt-3 border-t border-line pt-1">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-brand-blue">金額の内訳を見る</summary>
      <div className="pb-1 pt-2"><SavedCost scout={scout} /></div>
    </details>
    {scout.status === "accepted" && <Link className="app-primary mt-2 w-full" href={`/managers/chat/${scout.id}`}>チャットで相談する</Link>}
    {scout.status === "pending" && <p className="mt-2 text-center text-xs text-ink-soft">ワーカーが承諾するとチャットが開きます</p>}
  </article>;
}
