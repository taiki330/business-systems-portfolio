"use client";

import { useCurrentWorker } from "@/lib/hooks/use-current-worker";
import { ShiftCalendarPicker } from "@/components/workers/ShiftCalendarPicker";
import { WorkerAttendance } from "@/components/workers/WorkerAttendance";
import { WorkerShiftList } from "@/components/workers/WorkerShiftList";
import { WorkerSetupPrompt } from "@/components/workers/WorkerSetupPrompt";

export function ShiftPageClient() {
  const { worker, ready } = useCurrentWorker();
  if (!ready) return null;
  if (!worker) return <WorkerSetupPrompt />;

  return (
    <div className="flex flex-col gap-5">
      <WorkerAttendance workerId={worker.id} />
      <section aria-labelledby="wish_heading">
        <h2 id="wish_heading" className="app-section-title">働ける日を選ぶ</h2>
        <p className="mt-1 text-sm text-ink-soft">日付を押して、時間を登録します。</p>
        <div className="app-card mt-3"><ShiftCalendarPicker workerId={worker.id} /></div>
      </section>
      <WorkerShiftList workerId={worker.id} />
    </div>
  );
}
