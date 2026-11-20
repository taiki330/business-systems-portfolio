import { notFound } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { PeriodSlotActions } from "@/components/managers/PeriodSlotActions";
import { CloseShiftPeriodButton } from "@/components/managers/CloseShiftPeriodButton";
import {
  getShiftPeriodById,
  getSlotsByPeriod,
} from "@/lib/actions/shift-periods";
import { generateDateRange } from "@/lib/utils/date-range";
import { formatWorkDate } from "@/lib/utils/availability";
import { WorkerAvailabilitySlotWithWorker } from "@/lib/types/database";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ periodId: string }>;
};

const STATUS_ORDER = { pending: 0, assigned: 1, released: 2, cancelled: 3, attended: 4 };

export default async function ShiftPeriodDetailPage({ params }: PageProps) {
  const { periodId } = await params;
  const { period, error: periodError } = await getShiftPeriodById(periodId);

  if (periodError || !period) {
    notFound();
  }

  const { slots, error: slotsError } = await getSlotsByPeriod(
    period.start_date,
    period.end_date,
  );

  const slotsByDate = slots.reduce<
    Record<string, WorkerAvailabilitySlotWithWorker[]>
  >((acc, slot) => {
    const date = slot.work_date ?? "";
    if (!date) return acc;
    acc[date] = acc[date] ?? [];
    acc[date].push(slot);
    return acc;
  }, {});

  const allDates = generateDateRange(period.start_date, period.end_date);

  const totalPending = slots.filter((s) => s.status === "pending").length;
  const totalAssigned = slots.filter((s) => s.status === "assigned").length;
  const totalReleased = slots.filter((s) => s.status === "released").length;

  const formatDate = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  return (
    <div className="app-page">
      <AppHeader
        title={period.title}
        backHref="/managers/shift-periods"
        backLabel="シフト管理へ"
      />

      <main className="flex flex-col gap-4">
        {/* 期間サマリー */}
        <section className="rounded-xl border border-line bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-ink-soft">
              <span className="font-medium text-ink">{period.store_name}</span>
              <span className="mx-2 text-slate-300">|</span>
              {formatDate(period.start_date)} 〜 {formatDate(period.end_date)}
              {period.submission_deadline && (
                <span className="ml-2 text-brand-yellow-dark">
                  締切: {formatDate(period.submission_deadline)}
                </span>
              )}
            </div>
            {period.status === "open" && (
              <CloseShiftPeriodButton periodId={period.id} />
            )}
            {period.status === "closed" && (
              <span className="rounded-full bg-chip px-2.5 py-1 text-xs font-semibold text-ink-soft">
                締切済み
              </span>
            )}
          </div>

          <div className="mt-3 flex gap-4 text-sm">
            <span className="text-ink-soft">
              確認待ち:{" "}
              <strong className="text-brand-yellow-dark">{totalPending}</strong>
            </span>
            <span className="text-ink-soft">
              採用: <strong className="text-brand-blue">{totalAssigned}</strong>
            </span>
            <span className="text-ink-soft">
              他店開放:{" "}
              <strong className="text-brand-blue">{totalReleased}</strong>
            </span>
          </div>
        </section>

        {slotsError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {slotsError}
          </div>
        )}

        {/* 日付ごとのカレンダー */}
        <section className="flex flex-col gap-3">
          {allDates.map((date) => {
            const daySlots = (slotsByDate[date] ?? []).sort(
              (a, b) =>
                STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
                a.start_time.localeCompare(b.start_time),
            );

            return (
              <div
                key={date}
                className="rounded-xl border border-line bg-paper p-4"
              >
                <h2 className="text-sm font-bold text-ink">
                  {formatWorkDate(date)}
                </h2>

                {daySlots.length === 0 ? (
                  <p className="mt-2 text-xs text-ink-soft">希望なし</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {daySlots.map((slot) => (
                      <PeriodSlotActions
                        key={slot.id}
                        slot={slot}
                        periodId={periodId}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
