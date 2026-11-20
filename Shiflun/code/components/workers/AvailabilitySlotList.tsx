"use client";

import { useActionState } from "react";
import {
  AvailabilityActionState,
  deleteAvailabilitySlot,
} from "@/lib/actions/availability";
import { WorkerAvailabilitySlot } from "@/lib/types/database";
import { ShiftStatusBadge } from "@/components/workers/ShiftStatusBadge";
import {
  formatSlotTime,
  formatWorkDate,
} from "@/lib/utils/availability";

type AvailabilitySlotListProps = {
  workerId: string;
  slots: WorkerAvailabilitySlot[];
};

const initialState: AvailabilityActionState = {};

function DeleteSlotButton({
  slotId,
  workerId,
}: {
  slotId: string;
  workerId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    deleteAvailabilitySlot,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="slot_id" value={slotId} />
      <input type="hidden" name="worker_id" value={workerId} />
      {state.error && (
        <p className="mb-1 text-xs text-rose-600">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-60"
      >
        {isPending ? "削除中..." : "削除"}
      </button>
    </form>
  );
}

export function AvailabilitySlotList({
  workerId,
  slots,
}: AvailabilitySlotListProps) {
  const datedSlots = slots.filter((slot) => slot.work_date);

  if (datedSlots.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">
        まだ勤務希望が登録されていません。
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {datedSlots.map((slot) => (
        <li
          key={slot.id}
          className="flex items-start justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-ink">
                {formatWorkDate(slot.work_date!)}
              </p>
              <ShiftStatusBadge status={slot.status} />
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {formatSlotTime(slot.start_time)} 〜 {formatSlotTime(slot.end_time)}
            </p>
          </div>
          {slot.status === "pending" && (
            <DeleteSlotButton slotId={slot.id} workerId={workerId} />
          )}
        </li>
      ))}
    </ul>
  );
}
