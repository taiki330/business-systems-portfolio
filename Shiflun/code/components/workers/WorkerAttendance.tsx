"use client";

import { useActionState, useEffect, useState } from "react";
import { getAvailabilitySlotsByWorkerId } from "@/lib/actions/availability";
import { clockInShift, clockOutShift, ClockInState, ClockOutState } from "@/lib/actions/shifts";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { WorkerAvailabilitySlot } from "@/lib/types/database";
import { formatSlotTime } from "@/lib/utils/availability";
import { japanDate } from "@/lib/utils/matching";
import { QrCheckinButton } from "@/components/native/QrCheckinButton";

/** 今日の確定シフトと、出勤・退勤の打刻。今日のシフトがなければ何も出さない。 */
export function WorkerAttendance({ workerId }: { workerId: string }) {
  const [todaySlots, setTodaySlots] = useState<WorkerAvailabilitySlot[] | null>(null);

  useEffect(() => {
    getAvailabilitySlotsByWorkerId(workerId).then(({ slots }) => {
      setTodaySlots(slots.filter((s) => s.work_date === japanDate() && (s.status === "assigned" || s.status === "attended")));
    });
  }, [workerId]);

  if (!todaySlots || todaySlots.length === 0) return null;

  return (
    <section aria-labelledby="today_shift_heading" className="rounded-xl border border-brand-yellow bg-brand-yellow-light p-4">
      <h2 id="today_shift_heading" className="app-section-title">今日のシフト</h2>
      <div className="mt-3 flex flex-col gap-3">
        {todaySlots.map((slot) => <ClockInCard key={slot.id} slot={slot} workerId={workerId} />)}
      </div>
    </section>
  );
}

function ClockInCard({ slot, workerId }: { slot: WorkerAvailabilitySlot; workerId: string }) {
  const coords = useGeolocation();
  const [inState, clockInAction, inPending] = useActionState<ClockInState, FormData>(clockInShift, {});
  const [outState, clockOutAction, outPending] = useActionState<ClockOutState, FormData>(clockOutShift, {});

  const attended = slot.status === "attended" || inState.success;
  const clockedOut = Boolean(slot.clock_out_at) || outState.success;

  return (
    <div className="rounded-lg bg-white p-3">
      {slot.store_name && <p className="text-sm font-bold text-ink [overflow-wrap:anywhere]">{slot.store_name}</p>}
      <p className="text-2xl font-black tabular-nums text-ink">{formatSlotTime(slot.start_time)}〜{formatSlotTime(slot.end_time)}</p>
      <p className="mt-1 text-sm text-ink-soft">
        {!attended && <>出勤したら打刻してください。{coords && "位置情報を記録します。"}</>}
        {attended && !clockedOut && "出勤済みです。退勤するときに打刻してください。"}
        {clockedOut && "退勤済みです。お疲れさまでした。"}
      </p>

      {!attended && (
        <form action={clockInAction} className="mt-3">
          <input type="hidden" name="slot_id" value={slot.id} />
          <input type="hidden" name="worker_id" value={workerId} />
          <input type="hidden" name="lat" value={coords?.lat ?? ""} />
          <input type="hidden" name="lng" value={coords?.lng ?? ""} />
          <input type="hidden" name="checkin_method" value={coords ? "gps" : "self_report"} />
          <button type="submit" disabled={inPending} className="app-primary w-full">{inPending ? "打刻中…" : "出勤を打刻する"}</button>
        </form>
      )}
      {!clockedOut && <QrCheckinButton className="mt-2" />}

      {attended && !clockedOut && (
        <form action={clockOutAction} className="mt-3">
          <input type="hidden" name="slot_id" value={slot.id} />
          <input type="hidden" name="worker_id" value={workerId} />
          <input type="hidden" name="lat" value={coords?.lat ?? ""} />
          <input type="hidden" name="lng" value={coords?.lng ?? ""} />
          <button type="submit" disabled={outPending} className="app-secondary w-full">{outPending ? "打刻中…" : "退勤を打刻する"}</button>
        </form>
      )}

      {inState.error && <p role="alert" className="app-error mt-2">{inState.error}</p>}
      {outState.error && <p role="alert" className="app-error mt-2">{outState.error}</p>}
    </div>
  );
}
