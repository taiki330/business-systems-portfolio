import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmailCodeLoginForm } from "@/components/auth/EmailCodeLoginForm";
import { WorkerPasswordLogin } from "@/components/auth/WorkerPasswordLogin";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { safeNext } from "@/lib/utils/safe-next";

export const metadata: Metadata = { title: "ログイン | シフルン" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "/workers/mypage");
  return <div className="app-page">
    <AppHeader title="バイトの方のログイン" description="メールアドレスに届く確認コードでログインします。パスワードは不要です。" />
    <main className="space-y-6">
      <EmailCodeLoginForm next={next} />
      <WorkerPasswordLogin next={next} />
      <p className="text-center text-sm text-ink-soft">店舗の方は<Link href={`/managers/login?next=${encodeURIComponent(next.startsWith("/workers") ? "/managers/settings" : next)}`} className="font-semibold text-brand-blue-dark underline-offset-4 hover:underline">店舗用のログイン</Link>へ</p>
    </main>
    <LegalLinks className="mt-8" />
  </div>;
}
