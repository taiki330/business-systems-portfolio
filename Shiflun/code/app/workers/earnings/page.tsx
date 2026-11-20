import { AppHeader } from "@/components/layout/AppHeader";
import { EarningsClient } from "@/components/workers/EarningsClient";

export default function WorkerEarningsPage() {
  return (
    <div className="app-page">
      <AppHeader
        title="収入状況"
        description="出勤が確定した勤務の金額です。支払いは店舗から直接行われます。"
        backHref="/workers/mypage" backLabel="プロフィール"
      />
      <main>
        <EarningsClient />
      </main>
    </div>
  );
}
