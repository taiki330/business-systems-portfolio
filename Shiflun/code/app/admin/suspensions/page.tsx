import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminNav } from "@/components/admin/AdminNav";
import { LiftSuspensionForm } from "@/components/admin/LiftSuspensionForm";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getReviewerStatus } from "@/lib/actions/auth";
import { getActiveSuspensions } from "@/lib/actions/moderation";
import { shortDateTime } from "@/lib/utils/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "利用停止中のアカウント | シフルン", robots: { index: false } };

/** 審査担当（2段階認証済み）だけが開ける。停止の記録は、解除しても残る。 */
export default async function SuspensionsPage() {
  const status = await getReviewerStatus();
  if (!status.reviewer || !status.aal2) redirect("/admin/login");
  const { suspensions, error } = await getActiveSuspensions();

  return <div className="app-page">
    <AppHeader title="利用停止中のアカウント" description="いま利用停止にしているアカウントです。解除すると、またログインできるようになります。" backHref="" />
    <AdminNav current="suspensions" />
    <main className="flex flex-col gap-3">
      {error && <p role="alert" className="app-error">{error}</p>}
      {suspensions.length === 0 && !error && <EmptyState title="利用停止中のアカウントはありません" />}
      {suspensions.map((s) => <article key={s.id} className="app-card space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-base font-bold text-ink [overflow-wrap:anywhere]">{s.workers?.name ?? s.stores?.name ?? "（名前なし）"}</h2>
          <time className="shrink-0 text-xs text-ink-soft">{shortDateTime(s.suspended_at)}</time>
        </div>
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-soft">種類</dt><dd className="text-ink">{[s.worker_id && "ワーカー", s.store_id && "店舗"].filter(Boolean).join("・")}{s.stores?.name && s.workers?.name ? `（店舗：${s.stores.name}）` : ""}</dd>
          <dt className="text-ink-soft">メール</dt><dd className="text-ink [overflow-wrap:anywhere]">{s.email ?? "—"}</dd>
          <dt className="text-ink-soft">停止した人</dt><dd className="text-ink [overflow-wrap:anywhere]">{s.suspended_by}</dd>
        </dl>
        <p className="whitespace-pre-wrap rounded-lg bg-paper p-3 text-sm leading-relaxed text-ink [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-bold text-ink-soft">停止の理由</span>{s.reason}</p>
        <LiftSuspensionForm id={s.id} />
      </article>)}
      <SignOutButton className="mt-6 text-center" />
    </main>
  </div>;
}
