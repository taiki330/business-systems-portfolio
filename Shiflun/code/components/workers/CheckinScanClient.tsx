"use client";

import { useActionState, useEffect, useState } from "react";
import { getAvailabilitySlotsByWorkerId } from "@/lib/actions/availability";
import { clockInShift, clockOutShift, ClockInState, ClockOutState } from "@/lib/actions/shifts";
import { getWorkerById } from "@/lib/actions/workers";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { useWorkerId } from "@/lib/hooks/use-worker-id";
import { LoadingMascot } from "@/components/ui/LoadingMascot";
import { Worker, WorkerAvailabilitySlot } from "@/lib/types/database";
import { formatSlotTime } from "@/lib/utils/availability";
import { japanDate } from "@/lib/utils/matching";

export function CheckinScanClient({ storeName }: { storeName: string }) {
  const { workerId, ready } = useWorkerId();
  const [worker, setWorker] = useState<Worker | null>(null);
  const [slots, setSlots] = useState<WorkerAvailabilitySlot[] | null>(null);

  useEffect(() => {
    if (!workerId) return;
    getWorkerById(workerId).then(({ worker }) => setWorker(worker));
    getAvailabilitySlotsByWorkerId(workerId).then(({ slots }) => setSlots(slots));
  }, [workerId]);

  if (!ready) return null;

  if (!workerId) {
    return (
      <div className="rounded-xl border border-brand-yellow bg-brand-yellow-light p-5 text-center">
        <p className="text-sm font-semibold text-brand-yellow-dark">設定でアカウントを選択してください</p>
      </div>
    );
  }

  if (!worker || slots === null) {
    return <LoadingMascot />;
  }

  const today = japanDate();
  const matching = slots.filter(
    (s) =>
      s.work_date === today &&
      (s.status === "assigned" || s.status === "attended") &&
      (s.store_name ? s.store_name === storeName : worker.current_store === storeName),
  );

  if (matching.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-white p-5 text-center">
        <p className="text-sm text-ink-soft">
          {storeName}での本日の勤務予定が見つかりませんでした。店舗が違う場合は正しいQRコードを読み取り直してください。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {matching.map((slot) => (
        <ScanCheckinCard key={slot.id} slot={slot} workerId={workerId} />
      ))}
    </div>
  );
}

function ScanCheckinCard({ slot, workerId }: { slot: WorkerAvailabilitySlot; workerId: string }) {
  const coords = useGeolocation();
  const [inState, clockInAction, inPending] = useActionState<ClockInState, FormData>(clockInShift, {});
  const [outState, clockOutAction, outPending] = useActionState<ClockOutState, FormData>(clockOutShift, {});

  const attended = slot.status === "attended" || inState.success;
  const clockedOut = Boolean(slot.clock_out_at) || outState.success;

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <p className="text-sm font-semibold text-ink">
        {formatSlotTime(slot.start_time)} 〜 {formatSlotTime(slot.end_time)}
      </p>

      {!attended && (
        <form action={clockInAction} className="mt-3">
          <input type="hidden" name="slot_id" value={slot.id} />
          <input type="hidden" name="worker_id" value={workerId} />
          <input type="hidden" name="lat" value={coords?.lat ?? ""} />
          <input type="hidden" name="lng" value={coords?.lng ?? ""} />
          <input type="hidden" name="checkin_method" value="qr" />
          <button
            type="submit"
            disabled={inPending}
            className="app-primary w-full"
          >
            {inPending ? "…" : "出勤打刻"}
          </button>
        </form>
      )}

      {attended && !clockedOut && (
        <>
          <p className="mt-2 text-xs font-semibold text-brand-blue">出勤済み</p>
          <form action={clockOutAction} className="mt-3">
            <input type="hidden" name="slot_id" value={slot.id} />
            <input type="hidden" name="worker_id" value={workerId} />
            <input type="hidden" name="lat" value={coords?.lat ?? ""} />
            <input type="hidden" name="lng" value={coords?.lng ?? ""} />
            <button
              type="submit"
              disabled={outPending}
              className="w-full rounded-xl border border-line bg-white py-3 text-sm font-bold text-ink-soft hover:bg-paper disabled:opacity-60"
            >
              {outPending ? "…" : "退勤打刻"}
            </button>
          </form>
        </>
      )}

      {clockedOut && <p className="mt-2 text-xs font-semibold text-ink-soft">退勤済み・お疲れさまでした</p>}

      {inState.error && <p role="alert" className="mt-2 text-xs text-rose-700">{inState.error}</p>}
      {outState.error && <p role="alert" className="mt-2 text-xs text-rose-700">{outState.error}</p>}
    </div>
  );
}
