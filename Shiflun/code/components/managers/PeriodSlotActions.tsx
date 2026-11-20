"use client";

import { useActionState } from "react";
import { updateShiftRequestStatus, ShiftActionState } from "@/lib/actions/shifts";
import { WorkerAvailabilitySlotWithWorker } from "@/lib/types/database";
import { formatSlotTime } from "@/lib/utils/availability";
import { ShiftStatusBadge } from "@/components/workers/ShiftStatusBadge";

const initialState: ShiftActionState = {};

type PeriodSlotActionsProps = {
  slot: WorkerAvailabilitySlotWithWorker;
  periodId: string;
};

export function PeriodSlotActions({ slot, periodId }: PeriodSlotActionsProps) {
  const [state, formAction, isPending] = useActionState(
    updateShiftRequestStatus,
    initialState,
  );

  return (
    <li className="rounded-xl border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">
            {slot.workers.name}
          </p>
          <p className="text-xs text-ink-soft">
            {slot.workers.current_store} ·{" "}
            {formatSlotTime(slot.start_time)} 〜 {formatSlotTime(slot.end_time)}
          </p>
        </div>
        <ShiftStatusBadge status={slot.status} />
      </div>

      {slot.status === "pending" && (
        <div className="mt-3 flex gap-2">
          {state.error && (
            <p className="w-full text-xs text-rose-600" role="alert">
              {state.error}
            </p>
          )}
          <form action={formAction} className="flex-1">
            <input type="hidden" name="slot_id" value={slot.id} />
            <input type="hidden" name="worker_id" value={slot.worker_id} />
            <input type="hidden" name="status" value="assigned" />
            <input type="hidden" name="period_id" value={periodId} />
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
            <input type="hidden" name="period_id" value={periodId} />
            <button
              type="submit"
              disabled={isPending}
              className="app-primary min-h-9 px-3 py-1.5 text-xs w-full"
            >
              他店開放
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
