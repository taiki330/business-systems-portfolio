import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { LegalMarkdown } from "@/components/legal/LegalMarkdown";
import { AgreementActions } from "@/components/legal/AgreementActions";
import { readLegalDocument } from "@/lib/legal/documents";

// 文書はビルド時に読み込む。戻り先（next）などはクライアント側で URL から読む。
export const dynamic = "force-static";
export const metadata: Metadata = { title: "利用規約・プライバシーポリシーの確認 | シフルン" };

export default async function AgreementPage() {
  const [terms, privacy] = await Promise.all([readLegalDocument("terms"), readLegalDocument("privacy")]);
  return <div className="app-page max-w-2xl">
    <AppHeader title="利用規約・プライバシーポリシーの確認" description="シフルンを利用するには、次の2つの文書への同意が必要です。最後までお読みのうえ、ページ下の「同意する」を押してください。" />
    <main className="space-y-6">
      <section aria-labelledby="agreement-terms" className="space-y-3">
        <h2 id="agreement-terms" className="text-lg font-bold">1. 利用規約</h2>
        {terms.draft && <DraftNote />}
        <article className="app-card"><LegalMarkdown source={terms.source} /></article>
      </section>
      <section aria-labelledby="agreement-privacy" className="space-y-3">
        <h2 id="agreement-privacy" className="text-lg font-bold">2. プライバシーポリシー</h2>
        {privacy.draft && <DraftNote />}
        <article className="app-card"><LegalMarkdown source={privacy.source} /></article>
      </section>
      <Suspense fallback={null}><AgreementActions /></Suspense>
    </main>
  </div>;
}

function DraftNote() {
  return <p role="note" className="rounded-xl border border-brand-yellow bg-brand-yellow-light p-4 text-sm font-semibold text-brand-yellow-dark">この文書は確定前の案です。内容は変更される可能性があります。</p>;
}
