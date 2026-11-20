"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createScoutRequest } from "@/lib/actions/scouts";
import { ScoutPrefillParams } from "@/lib/types/search";
import { useCurrentStore } from "@/lib/hooks/use-current-store";
import { calculateOffer, japanDate, SCOUT_FEE_PERCENT, calculateStoreCost } from "@/lib/utils/matching";
import { StoreSetupPrompt } from "@/components/companies/StoreSetupPrompt";
import { OfferSummary } from "@/components/companies/OfferSummary";
import { StoreCostSummary } from "@/components/companies/StoreCostSummary";
import { MINOR_NIGHT_SCOUT_ERROR, violatesMinorNightRule } from "@/lib/utils/minor";

type ScoutDraft = { fields: Record<string, string>; storeName: string; workMinutes: number; totalYen: number; hourlyWage: number };

export function ScoutForm({ workerId, isMinor = false, defaultValues }: { workerId: string; isMinor?: boolean; defaultValues?: Partial<ScoutPrefillParams> }) {
  const [draft, setDraft] = useState<ScoutDraft | null>(null);
  const { store, ready } = useCurrentStore();
  const [start, setStart] = useState(defaultValues?.preferred_start_time ?? "");
  const [end, setEnd] = useState(defaultValues?.preferred_end_time ?? "");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const offer = calculateOffer(Number(store?.hourly_wage), start, end, Number(breakMinutes));
  // 18歳未満のワーカーには、午後10時から翌午前5時にかかる勤務をお願いできない（DBでも止まる）。
  const nightBlocked = isMinor && violatesMinorNightRule(start, end);
  if (ready && !store) return <StoreSetupPrompt />;
  return <div className="space-y-5">
    <ol className="flex items-center gap-3 text-sm font-semibold"><li className={draft ? "text-ink-soft" : "text-brand-blue"}>1. 勤務条件</li><li aria-hidden="true" className="text-ink-soft">›</li><li className={draft ? "text-brand-blue" : "text-ink-soft"}>2. 金額を確認して送信</li></ol>
    <form hidden={Boolean(draft)} onSubmit={(event) => {
      event.preventDefault();
      if (!offer || !store) return;
      const fields = Object.fromEntries([...new FormData(event.currentTarget).entries()].map(([key, value]) => [key, String(value)]));
      setDraft({ fields, storeName: store.name, workMinutes: offer.workMinutes, totalYen: offer.totalYen, hourlyWage: Number(store.hourly_wage) });
    }} className="space-y-5">
      <input type="hidden" name="worker_id" value={workerId} />
      <input type="hidden" name="store_id" value={store?.id ?? ""} />
      <input type="hidden" name="expected_hourly_wage" value={store?.hourly_wage ?? ""} />
      <input type="hidden" name="expected_fee_percent" value={SCOUT_FEE_PERCENT} />
      <div><label className="app-label" htmlFor="preferred_work_date">働いてほしい日</label><input id="preferred_work_date" name="preferred_work_date" type="date" min={japanDate()} required defaultValue={defaultValues?.preferred_work_date} className="app-input" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="app-label" htmlFor="preferred_start_time">開始</label><input id="preferred_start_time" name="preferred_start_time" type="time" required value={start} onChange={(e) => setStart(e.target.value)} className="app-input min-w-0" /></div>
        <div><label className="app-label" htmlFor="preferred_end_time">終了（同日）</label><input id="preferred_end_time" name="preferred_end_time" type="time" required value={end} onChange={(e) => setEnd(e.target.value)} className="app-input min-w-0" /></div>
      </div>
      <div><label className="app-label" htmlFor="break_minutes">休憩（分）</label><input id="break_minutes" name="break_minutes" type="number" inputMode="numeric" min={0} max={1439} step={1} required value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} className="app-input" /></div>
      {nightBlocked && <p role="alert" className="app-error">{MINOR_NIGHT_SCOUT_ERROR}</p>}
      {offer ? <div aria-live="polite"><OfferSummary scout={{ offered_hourly_wage: Number(store?.hourly_wage), preferred_start_time: start, preferred_end_time: end, break_minutes: Number(breakMinutes), work_minutes: offer.workMinutes, offered_total_yen: offer.totalYen }} /></div> : <p className="rounded-xl bg-paper p-4 text-sm leading-relaxed text-ink-soft">店舗と勤務時間を選ぶと、ワーカーに届く提示額を自動計算します。</p>}
      {store && !store.hourly_wage && <Link href="/managers/settings" className="block text-sm font-semibold text-brand-blue underline">この店舗の時給を設定する</Link>}
      <div><label className="app-label" htmlFor="scout_message">お願いしたいお仕事</label><textarea id="scout_message" name="message" required maxLength={2000} rows={4} className="app-input" placeholder="当日のポジションや、お願いしたいことを伝えましょう。" /></div>
      <p className="text-xs leading-relaxed text-ink-soft">ワーカーが承諾すると、チャットで詳しい相談ができるようになります。</p>
      <button type="submit" disabled={!offer || !store || nightBlocked} className="app-primary w-full">提示額・手数料を確認する</button>
    </form>
    {draft && <ScoutConfirmation draft={draft} onBack={() => setDraft(null)} />}
  </div>;
}

function ScoutConfirmation({ draft, onBack }: { draft: ScoutDraft; onBack: () => void }) {
  const [state, action, pending] = useActionState(createScoutRequest, {});
  const cost = calculateStoreCost(draft.totalYen);
  return <form action={action} className="space-y-5">
    {Object.entries(draft.fields).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <div><h2 className="text-xl font-bold text-ink">この内容でスカウトを送りますか？</h2><p className="mt-2 text-sm font-semibold text-ink-soft">{draft.storeName}</p><p className="mt-1 text-sm text-ink-soft">{draft.fields.preferred_work_date}　{draft.fields.preferred_start_time}〜{draft.fields.preferred_end_time}（休憩{draft.fields.break_minutes}分）</p></div>
    <StoreCostSummary hourlyWage={draft.hourlyWage} workMinutes={draft.workMinutes} totalYen={draft.totalYen} />
    <div className="rounded-xl bg-paper p-4"><h3 className="text-xs font-semibold text-ink-soft">送信するメッセージ</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft">{draft.fields.message}</p></div>
    <p className="text-xs leading-relaxed text-ink-soft">スカウトの送信で決済は行われません。ワーカーの承諾後、チャットが開きます。</p>
    {state.error && <p role="alert" className="app-error">{state.error}</p>}
    <button disabled={pending} className="app-primary w-full">{pending ? "送信中…" : `合計${cost.storeTotalYen.toLocaleString()}円でスカウトを送る`}</button>
    <button type="button" disabled={pending} onClick={onBack} className="app-secondary w-full">勤務条件を修正する</button>
  </form>;
}
