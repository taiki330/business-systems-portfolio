"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useId, useState, useTransition } from "react";
import { BUSINESS_TYPES, SKILL_TAGS } from "@/lib/constants/options";
import { useStoredId } from "@/lib/hooks/use-stored-id";
import { japanDate, timeMinutes } from "@/lib/utils/matching";
import { parseSearchParams } from "@/lib/types/search";

const DETAIL_KEYS = ["area", "business_type", "skill", "min_experience", "verified"] as const;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const DATE_CHIP_DAYS = 7;
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

function parseDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function addDays(date: string, days: number): string {
  const d = parseDate(date) ?? new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function readDefaultTimes(raw: string | null): { start: string; end: string } | null {
  try {
    const parsed = JSON.parse(raw ?? "null");
    return typeof parsed?.start === "string" && typeof parsed?.end === "string" && parsed.start && parsed.end ? { start: parsed.start, end: parsed.end } : null;
  } catch { return null; }
}

function withCurrent(options: string[], value: string): string[] {
  return value && !options.includes(value) ? [...options, value].sort() : options;
}

type Draft = { date: string; start: string; end: string };

/** 日付の札。選んでいる日は黄色。 */
function DateTile({ date, selected, onSelect }: { date: string; selected: boolean; onSelect: () => void }) {
  const d = parseDate(date)!;
  return <button type="button" aria-pressed={selected} aria-label={`${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAYS[d.getUTCDay()]}）`} onClick={onSelect}
    className={`flex h-[4.25rem] w-14 shrink-0 flex-col items-center justify-center rounded-lg border text-ink transition-colors ${selected ? "border-brand-yellow bg-brand-yellow" : "border-line bg-white hover:bg-paper"}`}>
    <span className="text-xl font-bold leading-none tabular-nums">{d.getUTCDate()}</span>
    <span className="mt-1.5 text-xs font-medium">{WEEKDAYS[d.getUTCDay()]}</span>
  </button>;
}

export function WorkerFilterForm() {
  const params = useSearchParams();
  return <FilterPanel key={params.toString()} params={params} />;
}

function FilterPanel({ params }: { params: URLSearchParams }) {
  const router = useRouter();
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const today = japanDate();
  const parsed = parseSearchParams(params.get("work_date") ?? undefined, params.get("start_time") ?? undefined, params.get("end_time") ?? undefined);
  const searched = parsed?.ok === true;
  const [draft, setDraft] = useState<Draft>({ date: params.get("work_date") ?? "", start: params.get("start_time") ?? "", end: params.get("end_time") ?? "" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [timeError, setTimeError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const { id: storedTimes, setId: storeTimes } = useStoredId("shiflun_default_times");
  const defaultTimes = readDefaultTimes(storedTimes);

  const dateChips = Array.from({ length: DATE_CHIP_DAYS }, (_, i) => addDays(today, i));
  const customDate = draft.date && !dateChips.includes(draft.date) ? draft.date : "";
  const detailCount = (["business_type", "skill", "min_experience", "verified"] as const).filter((key) => params.get(key)).length;
  const [detailOpen, setDetailOpen] = useState(false);
  const usingDefault = Boolean(defaultTimes && draft.start === defaultTimes.start && draft.end === defaultTimes.end);
  const hasAny = searched || DETAIL_KEYS.some((key) => params.get(key));

  function navigate(next: Draft, form: HTMLFormElement | null) {
    const query = new URLSearchParams();
    if (next.date && next.start && next.end) {
      const from = timeMinutes(next.start);
      const to = timeMinutes(next.end);
      if (from === null || to === null || to <= from) { setTimeError("終了は開始より後の時刻にしてください。"); return; }
      query.set("work_date", next.date);
      query.set("start_time", next.start);
      query.set("end_time", next.end);
    }
    setTimeError("");
    const data = form ? new FormData(form) : null;
    for (const key of DETAIL_KEYS) {
      const value = String((data ? data.get(key) : params.get(key)) ?? "").trim();
      if (value) query.set(key, value);
    }
    startTransition(() => router.push(`/companies?${query.toString()}`));
  }

  /** 日付だけ選んだときは、いつもの時間（なければ 17:00〜21:00）を入れてすぐ探せるようにする。 */
  function update(patch: Partial<Draft>, form: HTMLFormElement | null) {
    const next = { ...draft, ...patch };
    if (patch.date && !next.start && !next.end) { next.start = defaultTimes?.start ?? "17:00"; next.end = defaultTimes?.end ?? "21:00"; }
    setDraft(next);
    if (next.date && next.start && next.end) navigate(next, form);
    else setTimeError("");
  }

  function commitFilters(form: HTMLFormElement | null) {
    const filled = [draft.date, draft.start, draft.end].filter(Boolean).length;
    if (filled === 0 || filled === 3) navigate(draft, form);
  }

  const formElement = () => document.getElementById(formId) as HTMLFormElement | null;
  const select = "min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-base tabular-nums text-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue-light";

  return <form id={formId} onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); commitFilters(e.currentTarget); }} className="space-y-3">
    <fieldset>
      <legend className="sr-only">日付</legend>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {dateChips.map((date) => <DateTile key={date} date={date} selected={draft.date === date} onSelect={() => update({ date }, formElement())} />)}
        {customDate && <DateTile date={customDate} selected onSelect={() => setPickerOpen(true)} />}
        <button type="button" aria-expanded={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)} className="flex h-[4.25rem] w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-slate-400 bg-white text-xs font-medium text-ink-soft hover:bg-paper">
          他の日
        </button>
      </div>
      {pickerOpen && <div className="mt-2"><label htmlFor="search_date" className="sr-only">日付を選ぶ</label><input id="search_date" type="date" min={today} value={draft.date} onChange={(e) => update({ date: e.target.value }, e.currentTarget.form)} className="app-input" /></div>}
    </fieldset>

    <div className="flex items-center gap-2">
      <fieldset className="flex min-w-0 flex-[3] items-center gap-1">
        <legend className="sr-only">時間</legend>
        <label htmlFor="search_start" className="sr-only">開始時刻</label>
        <select id="search_start" value={draft.start} onChange={(e) => update({ start: e.target.value }, e.currentTarget.form)} className={select}>
          <option value="">開始</option>{withCurrent(TIME_OPTIONS, draft.start).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span aria-hidden="true" className="text-ink-soft">〜</span>
        <label htmlFor="search_end" className="sr-only">終了時刻</label>
        <select id="search_end" value={draft.end} onChange={(e) => update({ end: e.target.value }, e.currentTarget.form)} className={select}>
          <option value="">終了</option>{withCurrent(TIME_OPTIONS, draft.end).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </fieldset>
      <div className="min-w-0 flex-[2]">
        <label htmlFor="search_area" className="sr-only">エリア</label>
        <input id="search_area" name="area" enterKeyHint="search" defaultValue={params.get("area") ?? ""} placeholder="エリア" maxLength={60}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); } }}
          onBlur={(e) => { if (e.currentTarget.value.trim() !== (params.get("area") ?? "")) commitFilters(e.currentTarget.form); }}
          className="min-h-11 w-full rounded-lg border border-line bg-white px-3 text-base text-ink outline-none placeholder:text-ink-soft focus:border-brand-blue focus:ring-2 focus:ring-brand-blue-light" />
      </div>
    </div>
    {timeError && <p role="alert" className="text-sm text-rose-700">{timeError}</p>}

    <div className="flex items-center justify-between gap-3">
      <p role="status" className="text-xs text-ink-soft">{pending ? "検索中…" : draft.date && !searched ? "時間を選ぶと、その時間に空いている人を探せます。" : ""}</p>
      <div className="flex shrink-0 items-center gap-4">
        {hasAny && <button type="button" className="min-h-11 text-sm font-medium text-ink-soft hover:underline" onClick={() => startTransition(() => router.push("/companies"))}>クリア</button>}
        <button type="button" aria-expanded={detailOpen} aria-controls={`${formId}-detail`} onClick={() => setDetailOpen(!detailOpen)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand-blue hover:underline">
          絞り込み{detailCount > 0 && <span className="inline-flex min-w-5 justify-center rounded-full bg-brand-yellow px-1.5 text-xs font-bold leading-5 text-ink" aria-label={`${detailCount}件設定中`}>{detailCount}</span>}
        </button>
      </div>
    </div>

    <div id={`${formId}-detail`} hidden={!detailOpen} className="app-card space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="search_business" className="app-label">業態の経験</label><select id="search_business" name="business_type" defaultValue={params.get("business_type") ?? ""} onChange={(e) => commitFilters(e.currentTarget.form)} className="app-input"><option value="">指定なし</option>{BUSINESS_TYPES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><label htmlFor="search_skill" className="app-label">ポジション</label><select id="search_skill" name="skill" defaultValue={params.get("skill") ?? ""} onChange={(e) => commitFilters(e.currentTarget.form)} className="app-input"><option value="">指定なし</option>{SKILL_TAGS.map((s) => <option key={s}>{s}</option>)}</select></div>
      </div>
      <div><label htmlFor="search_experience" className="app-label">経験年数（以上）</label><input id="search_experience" name="min_experience" type="number" inputMode="decimal" min={0} max={99.9} step={0.1} defaultValue={params.get("min_experience") ?? ""} placeholder="例：1" onBlur={(e) => { if (e.currentTarget.value.trim() !== (params.get("min_experience") ?? "")) commitFilters(e.currentTarget.form); }} className="app-input" /></div>
      <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-ink"><input name="verified" type="checkbox" value="true" defaultChecked={params.get("verified") === "true"} onChange={(e) => commitFilters(e.currentTarget.form)} className="size-5 accent-brand-blue" />店長認証がある人のみ</label>
      {draft.start && draft.end && <div className="border-t border-line pt-3">
        {usingDefault
          ? <p className="text-xs text-ink-soft">{draft.start}〜{draft.end} は「いつもの時間」に保存されています。</p>
          : <button type="button" className="min-h-11 text-sm font-bold text-brand-blue hover:underline" onClick={() => {
            try { storeTimes(JSON.stringify({ start: draft.start, end: draft.end })); setSavedMessage("いつもの時間に保存しました。次からは日付を選ぶだけで探せます。"); }
            catch { setSavedMessage("保存できませんでした。"); }
          }}>{draft.start}〜{draft.end} を「いつもの時間」に保存</button>}
        {savedMessage && <p role="status" className="text-xs text-ink-soft">{savedMessage}</p>}
      </div>}
    </div>
  </form>;
}
