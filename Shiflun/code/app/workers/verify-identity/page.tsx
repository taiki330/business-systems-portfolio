import { AppHeader } from "@/components/layout/AppHeader";
import { IdentityVerificationClient } from "@/components/workers/IdentityVerificationClient";

export default function WorkerVerifyIdentityPage() {
  return (
    <div className="app-page">
      <AppHeader
        title="本人確認"
        description="身分証を提出してください。店長認証（勤務実績）とは別の、本人確認の手続きです。"
        backHref="/workers/mypage" backLabel="プロフィール"
      />
      <main>
        <IdentityVerificationClient />
      </main>
    </div>
  );
}
