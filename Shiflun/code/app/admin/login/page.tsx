import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { ReviewerSignIn } from "@/components/admin/ReviewerSignIn";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getReviewerStatus } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "審査担当のログイン | シフルン", robots: { index: false } };

export default async function ReviewerLoginPage() {
  const status = await getReviewerStatus();
  if (status.reviewer && status.aal2) redirect("/admin/identity-verifications");
  // 審査の権限がないアカウントでログイン中なら、いったんパスワードから入り直してもらう。
  const step = status.signedIn && status.reviewer ? "mfa" : "password";
  return <div className="app-page">
    <AppHeader title="審査担当のログイン" description="運営の審査担当者専用です。パスワードと、認証アプリの2段階認証でログインします。" backHref="" />
    <main className="space-y-4">
      {status.signedIn && !status.reviewer && <p role="alert" className="app-error">今ログインしているアカウントには審査の権限がありません。審査担当のアカウントでログインし直してください。</p>}
      <ReviewerSignIn step={step} hasFactor={status.hasFactor} />
      {status.signedIn && <SignOutButton className="text-center" />}
    </main>
  </div>;
}
