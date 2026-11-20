import { AppHeader } from "@/components/layout/AppHeader";
import { ShiftPageClient } from "@/components/workers/ShiftPageClient";

export const dynamic = "force-dynamic";

export default function WorkerShiftsPage() {
  return (
    <div className="app-page">
      <AppHeader title="勤務希望" description="働ける日と時間を登録します。" />
      <main>
        <ShiftPageClient />
      </main>
    </div>
  );
}
