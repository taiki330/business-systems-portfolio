import type { Metadata } from "next";
import { AppHeader } from "@/components/layout/AppHeader";
import { ContactForm } from "@/components/contact/ContactForm";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { getAuth } from "@/lib/auth/session";
import { CONTACT_CATEGORIES } from "@/lib/constants/safety";
import { ContactCategory } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "お問い合わせ | シフルン" };

/** ログインしていなくても開ける（ログインできない人の問い合わせ先でもあるため）。 */
export default async function ContactPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const { user } = await getAuth();
  const defaultCategory = CONTACT_CATEGORIES.find((c) => c.value === category)?.value as ContactCategory | undefined;
  return <div className="app-page">
    <AppHeader title="お問い合わせ" description="ご質問や不具合の報告、退会・データ削除のご依頼を受け付けています。運営からメールで返信します。" />
    <main className="space-y-4">
      <ContactForm signedInEmail={user?.email ?? null} defaultCategory={defaultCategory} />
    </main>
    <LegalLinks className="mt-8" />
  </div>;
}
