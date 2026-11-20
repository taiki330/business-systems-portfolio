"use client";

import { useEffect, useState } from "react";
import { getAvailabilitySlotsByWorkerId } from "@/lib/actions/availability";
import { WorkerAvailabilitySlot } from "@/lib/types/database";
import { ShiftStatusBadge } from "@/components/workers/ShiftStatusBadge";
import { formatSlotTime } from "@/lib/utils/availability";
import { shortDate } from "@/lib/utils/format";
import { japanDate } from "@/lib/utils/matching";

/** 提出した勤務希望と、決まった勤務の一覧。 */
export function WorkerShiftList({ workerId }: { workerId: string }) {
  const [slots, setSlots] = useState<WorkerAvailabilitySlot[] | null>(null);

  useEffect(() => {
    getAvailabilitySlotsByWorkerId(workerId).then(({ slots }) => setSlots(slots));
  }, [workerId]);

  if (slots === null) return null;

  const today = japanDate();
  const upcoming = slots.filter((s) => s.work_date && s.work_date >= today).sort((a, b) => (a.work_date ?? "").localeCompare(b.work_date ?? ""));
  const past = slots.filter((s) => s.work_date && s.work_date < today).sort((a, b) => (b.work_date ?? "").localeCompare(a.work_date ?? "")).slice(0, 5);

  if (upcoming.length === 0 && past.length === 0) return <p className="py-2 text-center text-sm text-ink-soft">提出済みの勤務希望はまだありません。</p>;

  return (
    <section aria-labelledby="submitted_heading">
      <h2 id="submitted_heading" className="app-section-title">提出済みの希望と予定</h2>
      {upcoming.length > 0 && <SlotGroup label="これから" slots={upcoming} />}
      {past.length > 0 && <SlotGroup label="過去（直近5件）" slots={past} muted />}
    </section>
  );
}

function SlotGroup({ label, slots, muted = false }: { label: string; slots: WorkerAvailabilitySlot[]; muted?: boolean }) {
  return <div className="mt-3">
    <h3 className="mb-2 text-sm font-medium text-ink-soft">{label}</h3>
    <ul className="app-card divide-y divide-line p-0">
      {slots.map((slot) => (
        <li key={slot.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className={`text-base font-bold tabular-nums ${muted ? "text-ink-soft" : "text-ink"}`}>{shortDate(slot.work_date!)}　{formatSlotTime(slot.start_time)}〜{formatSlotTime(slot.end_time)}</p>
            {slot.store_name && <p className="mt-0.5 truncate text-sm text-ink-soft">{slot.store_name}</p>}
          </div>
          <ShiftStatusBadge status={slot.status} />
        </li>
      ))}
    </ul>
  </div>;
}
