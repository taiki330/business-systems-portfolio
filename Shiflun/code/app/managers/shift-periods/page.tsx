import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { ShiftPeriodCard } from "@/components/managers/ShiftPeriodCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { getShiftPeriods } from "@/lib/actions/shift-periods";

export const dynamic = "force-dynamic";

export default async function ShiftPeriodsPage() {
  const { periods, error } = await getShiftPeriods();

  return (
    <div className="app-page">
      <AppHeader
        title="シフト管理"
        description="シフト期間を作成してバイトの希望を集め、アサインを管理します。"
        backHref="/managers/more" backLabel="その他"
      />

      <main className="flex flex-col gap-4">
        <div className="flex justify-end">
          <Link
            href="/managers/shift-periods/new"
            className="app-secondary"
          >
            新しい募集期間を作成
          </Link>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {error}
          </div>
        )}

        {periods.length === 0 && !error ? (
          <EmptyState title="まだシフト期間がありません" description="「新しいシフト期間を作成」から始めましょう。" />
        ) : (
          <ul className="flex flex-col gap-3">
            {periods.map((period) => (
              <li key={period.id}>
                <ShiftPeriodCard period={period} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
