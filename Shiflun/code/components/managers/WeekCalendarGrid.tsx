"use client";

import { useActionState } from "react";
import { WorkerAvailabilitySlotWithWorker } from "@/lib/types/database";
import { updateShiftRequestStatus, ShiftActionState } from "@/lib/actions/shifts";
import { ShiftStatusBadge } from "@/components/workers/ShiftStatusBadge";
import { formatSlotTime } from "@/lib/utils/availability";
import { weekdayShort } from "@/lib/utils/calendar";

type WeekCalendarGridProps = {
  weekDays: string[];
  slots: WorkerAvailabilitySlotWithWorker[];
};

const initialState: ShiftActionState = {};

function SlotCard({ slot }: { slot: WorkerAvailabilitySlotWithWorker }) {
  const [state, formAction, isPending] = useActionState(
    updateShiftRequestStatus,
    initialState,
  );

  return (
    <div className="rounded-lg border border-line bg-white p-2">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-ink">
            {slot.workers.name}
          </p>
          <p className="text-[10px] text-ink-soft">
            {formatSlotTime(slot.start_time)}〜{formatSlotTime(slot.end_time)}
          </p>
        </div>
        <ShiftStatusBadge status={slot.status} />
      </div>

      {slot.status === "pending" && (
        <div className="mt-2 flex gap-1">
          {state.error && (
            <p className="w-full text-[10px] text-rose-600">{state.error}</p>
          )}
          <form action={formAction} className="flex-1">
            <input type="hidden" name="slot_id" value={slot.id} />
            <input type="hidden" name="worker_id" value={slot.worker_id} />
            <input type="hidden" name="status" value="assigned" />
            <button
              type="submit"
              disabled={isPending}
              className="app-primary min-h-9 px-3 py-1.5 text-xs w-full"
            >
              採用
            </button>
          </form>
          <form action={formAction} className="flex-1">
            <input type="hidden" name="slot_id" value={slot.id} />
            <input type="hidden" name="worker_id" value={slot.worker_id} />
            <input type="hidden" name="status" value="released" />
            <button
              type="submit"
              disabled={isPending}
              className="app-primary min-h-9 px-3 py-1.5 text-xs w-full"
            >
              開放
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function WeekCalendarGrid({ weekDays, slots }: WeekCalendarGridProps) {
  const today = new Date().toISOString().slice(0, 10);

  const slotsByDate = slots.reduce<
    Record<string, WorkerAvailabilitySlotWithWorker[]>
  >((acc, slot) => {
    if (!slot.work_date) return acc;
    acc[slot.work_date] = acc[slot.work_date] ?? [];
    acc[slot.work_date].push(slot);
    return acc;
  }, {});

  return (
    <div className="overflow-x-auto">
    <div className="grid gap-px bg-chip" style={{ gridTemplateColumns: `repeat(7, minmax(120px, 1fr))` }}>
      {weekDays.map((dateStr) => {
        const wd = weekdayShort(dateStr);
        const day = Number(dateStr.split("-")[2]);
        const month = Number(dateStr.split("-")[1]);
        const isToday = dateStr === today;
        const isSat = wd === "土";
        const isSun = wd === "日";
        const daySlots = (slotsByDate[dateStr] ?? []).sort(
          (a, b) => a.start_time.localeCompare(b.start_time),
        );

        return (
          <div key={dateStr} className="flex flex-col bg-white">
            <div
              className={`sticky top-0 z-10 border-b border-line py-2 text-center ${
                isToday ? "bg-brand-blue-light" : "bg-white"
              }`}
            >
              <p
                className={`text-[10px] font-medium ${
                  isSat ? "text-brand-blue" : isSun ? "text-red-500" : "text-ink-soft"
                }`}
              >
                {wd}
              </p>
              <p
                className={`text-sm font-bold ${
                  isToday
                    ? "text-brand-blue"
                    : isSat
                    ? "text-brand-blue"
                    : isSun
                    ? "text-red-600"
                    : "text-ink"
                }`}
              >
                {month}/{day}
              </p>
            </div>

            <div className="flex flex-1 flex-col gap-1.5 p-1.5">
              {daySlots.length === 0 ? (
                <p className="py-2 text-center text-[10px] text-slate-300">—</p>
              ) : (
                daySlots.map((slot) => (
                  <SlotCard key={slot.id} slot={slot} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}
