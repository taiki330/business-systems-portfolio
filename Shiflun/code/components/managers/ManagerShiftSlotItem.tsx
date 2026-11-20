"use client";

import { useActionState } from "react";
import {
  ShiftActionState,
  updateShiftRequestStatus,
} from "@/lib/actions/shifts";
import { WorkerAvailabilitySlot } from "@/lib/types/database";
import { ShiftStatusBadge } from "@/components/workers/ShiftStatusBadge";
import {
  formatSlotTime,
  formatWorkDate,
} from "@/lib/utils/availability";

type ManagerShiftSlotItemProps = {
  slot: WorkerAvailabilitySlot;
  workerId: string;
};

const initialState: ShiftActionState = {};

function ManagerShiftActions({
  slot,
  workerId,
}: {
  slot: WorkerAvailabilitySlot;
  workerId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    updateShiftRequestStatus,
    initialState,
  );

  return (
    <div className="mt-4 flex flex-col gap-2">
      {state.error && (
        <p className="text-xs text-rose-600" role="alert">
          {state.error}
        </p>
      )}
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="slot_id" value={slot.id} />
        <input type="hidden" name="worker_id" value={workerId} />
        <input type="hidden" name="status" value="assigned" />
        <button
          type="submit"
          disabled={isPending}
          className="app-primary flex-1"
        >
          自店舗シフトに採用
        </button>
      </form>
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="slot_id" value={slot.id} />
        <input type="hidden" name="worker_id" value={workerId} />
        <input type="hidden" name="status" value="released" />
        <button
          type="submit"
          disabled={isPending}
          className="app-primary flex-1"
        >
          他店へ開放
        </button>
      </form>
    </div>
  );
}

export function ManagerShiftSlotItem({
  slot,
  workerId,
}: ManagerShiftSlotItemProps) {
  if (!slot.work_date) {
    return null;
  }

  return (
    <li className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            {formatWorkDate(slot.work_date)}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {formatSlotTime(slot.start_time)} 〜 {formatSlotTime(slot.end_time)}
          </p>
        </div>
        <ShiftStatusBadge status={slot.status} />
      </div>

      {slot.status === "pending" && (
        <ManagerShiftActions slot={slot} workerId={workerId} />
      )}

      {slot.reviewed_at && slot.status !== "pending" && (
        <p className="mt-3 text-xs text-ink-soft">
          判定日時:{" "}
          {new Date(slot.reviewed_at).toLocaleString("ja-JP", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </li>
  );
}
