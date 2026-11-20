import { AppHeader } from "@/components/layout/AppHeader";
import { ShiftPeriodForm } from "@/components/managers/ShiftPeriodForm";

export default function NewShiftPeriodPage() {
  return (
    <div className="app-page">
      <AppHeader
        title="シフト期間を作成"
        description="シフトを組む期間を設定します。月単位・2週間単位など自由に設定できます。"
        backHref="/managers/shift-periods"
        backLabel="シフト管理へ"
      />

      <main>
        <section className="rounded-xl border border-line bg-white p-5">
          <ShiftPeriodForm />
        </section>
      </main>
    </div>
  );
}
