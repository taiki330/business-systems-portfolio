import { ShiftCalendarPicker } from "@/components/workers/ShiftCalendarPicker";
import { AvailabilitySlotList } from "@/components/workers/AvailabilitySlotList";
import { WorkerAvailabilitySlot } from "@/lib/types/database";

type WorkerAvailabilitySectionProps = {
  workerId: string;
  slots: WorkerAvailabilitySlot[];
  managerShiftsUrl: string;
};

export function WorkerAvailabilitySection({
  workerId,
  slots,
}: WorkerAvailabilitySectionProps) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-base font-bold text-ink">シフト希望を提出</h2>
      <p className="mt-1 mb-4 text-sm text-ink-soft">
        カレンダーの日付をタップして時間を設定してください。
      </p>
      <ShiftCalendarPicker workerId={workerId} />

      {slots.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="mb-3 text-sm font-semibold text-ink">提出済み</h3>
          <AvailabilitySlotList workerId={workerId} slots={slots} />
        </div>
      )}
    </section>
  );
}
