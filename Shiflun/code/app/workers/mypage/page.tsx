import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { WorkerProfileClient } from "@/components/workers/WorkerProfileClient";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { DeleteAccountSection } from "@/components/account/DeleteAccountSection";

export const dynamic = "force-dynamic";

export default function WorkerMypagePage() {
  return (
    <div className="app-page">
      <AppHeader title="プロフィール" description="経験や希望勤務地を確認・編集できます。" />
      <main className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Link
            href="/workers/earnings"
            className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink-soft hover:bg-paper"
          >
            収入状況
          </Link>
          <Link
            href="/workers/verify-identity"
            className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink-soft hover:bg-paper"
          >
            本人確認
          </Link>
        </div>
        <WorkerProfileClient />
        <DeleteAccountSection className="mt-4" />
      </main>
      <LegalLinks className="mt-8" />
    </div>
  );
}
