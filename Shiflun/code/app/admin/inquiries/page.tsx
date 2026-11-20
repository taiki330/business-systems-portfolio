import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminNav } from "@/components/admin/AdminNav";
import { ResolveForm } from "@/components/admin/ResolveForm";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getReviewerStatus } from "@/lib/actions/auth";
import { getOpenInquiries } from "@/lib/actions/moderation";
import { CONTACT_CATEGORIES } from "@/lib/constants/safety";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "お問い合わせ（運営用） | シフルン", robots: { index: false } };

const when = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** 審査担当（2段階認証済み）だけが開ける。返信はメールで行い、対応したらメモを残して対応済みにする。 */
export default async function InquiriesPage() {
  const status = await getReviewerStatus();
  if (!status.reviewer || !status.aal2) redirect("/admin/login");
  const { inquiries, error } = await getOpenInquiries();

  return <div className="app-page">
    <AppHeader title="お問い合わせ（運営用）" description="フォームから届いたお問い合わせです。返信先のメールアドレスへ返信し、対応したらメモを残して対応済みにします。" backHref="" />
    <AdminNav current="inquiries" />
    <main className="flex flex-col gap-3">
      {error && <p role="alert" className="app-error">{error}</p>}
      {inquiries.length === 0 && !error && <EmptyState title="未対応のお問い合わせはありません" />}
      {inquiries.map((inquiry) => <article key={inquiry.id} className="app-card space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-ink">{CONTACT_CATEGORIES.find((c) => c.value === inquiry.category)?.label ?? inquiry.category}</h2>
          <time className="shrink-0 text-xs text-ink-soft">{when(inquiry.created_at)}</time>
        </div>
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-soft">返信先</dt><dd className="font-semibold text-ink [overflow-wrap:anywhere]">{inquiry.email}</dd>
          <dt className="text-ink-soft">ログイン</dt><dd className="text-ink">{inquiry.user_id ? "ログイン中に送信（本人のメールアドレス）" : "ログインなしで送信（メールアドレスは自己申告）"}</dd>
        </dl>
        <p className="whitespace-pre-wrap rounded-xl bg-paper p-3 text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">{inquiry.body}</p>
        <ResolveForm kind="inquiry" id={inquiry.id} placeholder="例：メールで手順を案内した" />
      </article>)}
      <SignOutButton className="mt-6 text-center" />
    </main>
  </div>;
}
