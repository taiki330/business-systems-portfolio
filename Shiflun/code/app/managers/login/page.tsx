import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { StoreAuthForms } from "@/components/auth/StoreAuthForms";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { safeNext } from "@/lib/utils/safe-next";

export const metadata: Metadata = { title: "店舗の方のログイン | シフルン" };

export default async function StoreLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "/managers/settings");
  return <div className="app-page">
    <AppHeader title="店舗の方のログイン" description="店長・店舗の担当者の方は、メールアドレスとパスワードでログインします。はじめての方は「新規登録」からどうぞ。" />
    <main className="space-y-6">
      <StoreAuthForms next={next} />
      <p className="text-center text-sm text-ink-soft">バイトの方は<Link href="/login" className="font-semibold text-brand-blue underline-offset-4 hover:underline">こちらからログイン</Link></p>
    </main>
    <LegalLinks className="mt-8" />
  </div>;
}
