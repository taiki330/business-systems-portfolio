import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { LegalMarkdown } from "@/components/legal/LegalMarkdown";
import { readLegalDocument } from "@/lib/legal/documents";
import { LegalDocumentKey } from "@/lib/legal/versions";

const TITLES: Record<LegalDocumentKey, string> = { terms: "利用規約", privacy: "プライバシーポリシー" };

export async function LegalPage({ doc }: { doc: LegalDocumentKey }) {
  const { source, draft } = await readLegalDocument(doc);
  const other: LegalDocumentKey = doc === "terms" ? "privacy" : "terms";
  return <div className="mx-auto w-full max-w-2xl px-4 py-8">
    <AppHeader title={TITLES[doc]} />
    <main className="space-y-4">
      {draft && <p role="note" className="rounded-xl border border-brand-yellow bg-brand-yellow-light p-4 text-sm font-semibold text-brand-yellow-dark">この文書は確定前の案です。内容は変更される可能性があります。</p>}
      <article className="app-card"><LegalMarkdown source={source} /></article>
      <p className="text-center text-sm"><Link href={`/${other}`} className="font-semibold text-brand-blue underline-offset-4 hover:underline">{TITLES[other]}を読む</Link></p>
    </main>
  </div>;
}
