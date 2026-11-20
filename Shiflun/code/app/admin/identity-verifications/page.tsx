import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { IdentityVerificationReviewCard } from "@/components/admin/IdentityVerificationReviewCard";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getReviewerStatus } from "@/lib/actions/auth";
import { getPendingIdentityVerifications } from "@/lib/actions/identity-review";
import { getPendingIdentityPurgeCount } from "@/lib/actions/moderation";
import { AdminNav } from "@/components/admin/AdminNav";
import { IdentityPurgeBanner } from "@/components/admin/IdentityPurgeBanner";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "本人確認の審査 | シフルン", robots: { index: false } };

/** 審査担当（2段階認証済み）だけが開ける。データベース側でも同じ条件でしか身分証を読めない。 */
export default async function IdentityVerificationsPage() {
  const status = await getReviewerStatus();
  if (!status.reviewer || !status.aal2) redirect("/admin/login");
  const [{ verifications, error }, purgeCount] = await Promise.all([getPendingIdentityVerifications(), getPendingIdentityPurgeCount()]);

  return (
    <div className="app-page">
      <AppHeader
        title="本人確認の審査"
        description="運営の審査担当者専用です。画像のURLは2分で無効になります。画面を開き直すと再表示できます。"
        backHref=""
      />
      <AdminNav current="identity" />
      <main className="flex flex-col gap-3">
        <IdentityPurgeBanner count={purgeCount} />
        {error && <p role="alert" className="app-error">{error}</p>}
        {verifications.length === 0 ? (
          <EmptyState title="審査待ちの提出はありません" />
        ) : (
          verifications.map((verification) => <IdentityVerificationReviewCard key={verification.id} verification={verification} />)
        )}
        <SignOutButton className="mt-6 text-center" />
      </main>
    </div>
  );
}
