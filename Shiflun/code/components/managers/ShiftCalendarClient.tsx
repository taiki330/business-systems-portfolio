"use client";

import { TopBar } from "@/components/layout/AppHeader";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/Icons";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { MonthCalendarGrid } from "@/components/managers/MonthCalendarGrid";
import { WeekCalendarGrid } from "@/components/managers/WeekCalendarGrid";
import { WorkerAvailabilitySlotWithWorker } from "@/lib/types/database";
import {
  addMonths,
  addWeeks,
  formatMonthLabel,
  formatWeekLabel,
  getWeekDays,
  monthStart,
} from "@/lib/utils/calendar";

type View = "month" | "week";

type ShiftCalendarClientProps = {
  slots: WorkerAvailabilitySlotWithWorker[];
  initialView: View;
  initialDate: string;
};

export function ShiftCalendarClient({
  slots,
  initialView,
  initialDate,
}: ShiftCalendarClientProps) {
  const router = useRouter();
  const [view, setView] = useState<View>(initialView);
  const [date, setDate] = useState(initialDate);
  const touchStartX = useRef<number | null>(null);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 120) navigate(diff > 0 ? 1 : -1);
    touchStartX.current = null;
  }

  const weekDays = getWeekDays(date);

  function navigate(delta: number) {
    const newDate =
      view === "month" ? addMonths(date, delta) : addWeeks(date, delta);
    setDate(newDate);
    router.replace(
      `/managers/shifts?view=${view}&date=${newDate}`,
      { scroll: false },
    );
  }

  function switchView(next: View) {
    setView(next);
    const newDate = next === "month" ? monthStart(date) : date;
    router.replace(
      `/managers/shifts?view=${next}&date=${newDate}`,
      { scroll: false },
    );
  }

  function handleDayClick(clickedDate: string) {
    setView("week");
    setDate(clickedDate);
    router.replace(
      `/managers/shifts?view=week&date=${clickedDate}`,
      { scroll: false },
    );
  }

  const label =
    view === "month"
      ? formatMonthLabel(date)
      : formatWeekLabel(weekDays);

  const visibleSlots =
    view === "week"
      ? slots.filter(
          (s) => s.work_date && weekDays.includes(s.work_date),
        )
      : slots;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      {/* 見出しと、月・週の切り替え */}
      <div className="px-4">
        <TopBar />
        <div className="mt-5 flex items-center justify-between gap-3">
          <h1 className="app-title">シフト</h1>
          <div role="group" aria-label="表示の切り替え" className="flex rounded-lg border border-line bg-white p-1">
            {(["month", "week"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => switchView(v)}
                className={`min-h-9 rounded-md px-4 text-sm text-ink ${view === v ? "bg-brand-yellow font-bold" : "font-medium hover:bg-paper"}`}>
                {v === "month" ? "月" : "週"}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-2 mt-3 flex items-center justify-between">
          <button type="button" aria-label={view === "month" ? "前の月" : "前の週"} onClick={() => navigate(-1)} className="flex size-11 items-center justify-center rounded-lg text-ink hover:bg-chip">
            <ChevronLeftIcon className="size-6" />
          </button>
          <p aria-live="polite" className="text-lg font-bold tabular-nums text-ink">{label}</p>
          <button type="button" aria-label={view === "month" ? "次の月" : "次の週"} onClick={() => navigate(1)} className="flex size-11 items-center justify-center rounded-lg text-ink hover:bg-chip">
            <ChevronRightIcon className="size-6" />
          </button>
        </div>
      </div>

      {/* カレンダー本体 */}
      <div
        className="flex-1 overflow-auto"
        onTouchStart={view === "week" ? handleTouchStart : undefined}
        onTouchEnd={view === "week" ? handleTouchEnd : undefined}
      >
        {view === "month" ? (
          <MonthCalendarGrid
            baseDate={date}
            slots={visibleSlots}
            onDayClick={handleDayClick}
          />
        ) : (
          <WeekCalendarGrid weekDays={weekDays} slots={visibleSlots} />
        )}
      </div>
    </div>
  );
}
