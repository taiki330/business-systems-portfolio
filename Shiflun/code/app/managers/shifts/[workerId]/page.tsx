import { AppHeader } from "@/components/layout/AppHeader";
import { ManagerShiftSlotItem } from "@/components/managers/ManagerShiftSlotItem";
import { ManagerWorkerSummary } from "@/components/managers/ManagerWorkerSummary";
import { getAvailabilitySlotsByWorkerId } from "@/lib/actions/availability";
import { getWorkerById } from "@/lib/actions/workers";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type ManagerShiftsPageProps = {
  params: Promise<{ workerId: string }>;
};

export default async function ManagerShiftsPage({
  params,
}: ManagerShiftsPageProps) {
  const { workerId } = await params;
  const { worker, error } = await getWorkerById(workerId);
  const { slots, error: slotsError } =
    await getAvailabilitySlotsByWorkerId(workerId);

  if (error || !worker) {
    notFound();
  }

  const datedSlots = slots.filter((slot) => slot.work_date);

  return (
    <div className="app-page">
      <AppHeader
        title="勤務希望の確認"
        description="バイトの勤務希望を確認し、自店シフトへの採用または他店への開放を行います。"
        backHref="/managers/shifts" backLabel="シフト"
      />

      <main className="flex flex-col gap-4">
        <section className="rounded-xl border border-brand-yellow bg-brand-yellow-light px-4 py-3 text-sm leading-relaxed text-brand-yellow-dark">
          店長確認待ちの希望に対して、採用または他店への開放を選択してください。
        </section>

        <ManagerWorkerSummary worker={worker} />

        {slotsError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {slotsError}
          </div>
        )}

        <section className="rounded-xl border border-line bg-paper p-5">
          <h2 className="text-base font-bold text-ink">勤務希望一覧</h2>

          {datedSlots.length === 0 ? (
            <p className="mt-4 text-sm leading-relaxed text-ink-soft">
              まだ勤務希望が登録されていません。
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {datedSlots.map((slot) => (
                <ManagerShiftSlotItem
                  key={slot.id}
                  slot={slot}
                  workerId={workerId}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
