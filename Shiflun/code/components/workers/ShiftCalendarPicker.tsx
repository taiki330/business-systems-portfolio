"use client";

import { useActionState, useState } from "react";
import { submitShiftCalendarEntries } from "@/lib/actions/availability";
import { getMonthDays, weekdayShort } from "@/lib/utils/calendar";
import { useCurrentWorker } from "@/lib/hooks/use-current-worker";
import { MINOR_NIGHT_NOTICE, MINOR_NIGHT_SLOT_ERROR, violatesMinorNightRule } from "@/lib/utils/minor";

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

function addMonths(dateStr: string, delta: number): string {
  const [y, m] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  return `${y}年${m}月`;
}

export function ShiftCalendarPicker({ workerId }: { workerId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [monthBase, setMonthBase] = useState(today.slice(0, 8) + "01");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [start, setStart] = useState("17:00");
  const [end, setEnd] = useState("22:00");
  const [state, action, pending] = useActionState(submitShiftCalendarEntries, {});
  // 18歳未満は、午後10時から翌午前5時にかかる時間を登録できない（DBでも止まる）。先に画面で知らせる。
  const { worker } = useCurrentWorker();
  const nightBlocked = Boolean(worker?.is_minor) && violatesMinorNightRule(start, end);

  const cells = getMonthDays(
    Number(monthBase.split("-")[0]),
    Number(monthBase.split("-")[1]),
  );

  function toggleDate(dateStr: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
      return next;
    });
  }

  const sorted = [...selected].sort();

  if (state.success) {
    return (
      <div className="rounded-xl border border-brand-blue bg-brand-blue-light p-6 text-center">
        <p className="text-2xl">✓</p>
        <p className="mt-2 font-bold text-brand-blue">
          {state.createdCount}日分のシフト希望を提出しました
        </p>
        <p className="mt-1 text-sm text-brand-blue">店長の確認をお待ちください。</p>
        <button
          type="button"
          onClick={() => { setSelected(new Set()); window.location.reload(); }}
          className="mt-4 text-sm text-brand-blue underline"
        >
          続けて提出する
        </button>
      </div>
    );
  }

  return (
    <div>
      {state.error && (
        <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          {state.error}
        </p>
      )}

      {/* 月ナビ */}
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => setMonthBase((b) => addMonths(b, -1))}
          aria-label="前の月" className="flex size-11 items-center justify-center rounded-lg text-2xl leading-none text-ink hover:bg-chip">‹</button>
        <span className="text-lg font-bold tabular-nums text-ink">{monthLabel(monthBase)}</span>
        <button type="button" onClick={() => setMonthBase((b) => addMonths(b, 1))}
          aria-label="次の月" className="flex size-11 items-center justify-center rounded-lg text-2xl leading-none text-ink hover:bg-chip">›</button>
      </div>

      {/* カレンダー */}
      <div className="rounded-xl border border-line overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={`py-2 text-center text-xs font-semibold ${i === 5 ? "text-brand-blue" : i === 6 ? "text-red-500" : "text-ink-soft"}`}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((dateStr, i) => {
            if (!dateStr) return <div key={`e-${i}`} className="min-h-[44px] bg-paper" />;
            const isPast = dateStr < today;
            const isToday = dateStr === today;
            const isSel = selected.has(dateStr);
            const wd = weekdayShort(dateStr);
            const isSat = wd === "土";
            const isSun = wd === "日";
            const day = Number(dateStr.split("-")[2]);

            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => !isPast && toggleDate(dateStr)}
                disabled={isPast}
                className={`min-h-[44px] border-b border-r border-line flex items-center justify-center transition-colors
                  ${isPast ? "opacity-25 cursor-not-allowed" : "cursor-pointer"}
                  ${isSel ? "bg-brand-blue" : "hover:bg-brand-blue-light"}`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold
                  ${isSel ? "text-white" : isToday ? "bg-brand-blue text-white" : isSat ? "text-brand-blue" : isSun ? "text-red-500" : "text-ink-soft"}`}>
                  {day}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-ink-soft">日付をタップして選択（複数可）</p>

      {/* 時間設定＋提出 */}
      {selected.size > 0 && (
        <div className="mt-4 rounded-xl border border-brand-blue bg-brand-blue-light p-4">
          <p className="mb-3 text-sm font-bold text-brand-blue">
            {selected.size}日を選択中
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold text-brand-blue">開始時間</label>
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-xl border border-brand-blue bg-white px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
              />
            </div>
            <span className="mt-4 text-brand-blue">〜</span>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold text-brand-blue">終了時間</label>
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-xl border border-brand-blue bg-white px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
              />
            </div>
          </div>

          {worker?.is_minor && <p role={nightBlocked ? "alert" : "note"} className={`mt-3 rounded-lg px-3 py-2 text-sm leading-relaxed ${nightBlocked ? "bg-rose-50 text-rose-800" : "bg-white text-ink-soft"}`}>{nightBlocked ? MINOR_NIGHT_SLOT_ERROR : MINOR_NIGHT_NOTICE}</p>}

          {/* 選択日リスト */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sorted.map((d) => {
              const [, m, day] = d.split("-").map(Number);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDate(d)}
                  className="inline-flex min-h-8 items-center rounded-full bg-brand-yellow px-3 text-xs font-bold text-ink hover:bg-rose-100 hover:text-rose-700"
                >
                  {m}/{day} ✕
                </button>
              );
            })}
          </div>

          <form action={action} className="mt-3">
            <input type="hidden" name="worker_id" value={workerId} />
            <input
              type="hidden"
              name="entries"
              value={JSON.stringify(sorted.map((d) => ({ date: d, startTime: start, endTime: end })))}
            />
            <button
              type="submit"
              disabled={pending || nightBlocked}
              className="app-primary w-full"
            >
              {pending ? "提出中…" : `${selected.size}日分のシフト希望を提出`}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
