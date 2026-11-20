import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminNav } from "@/components/admin/AdminNav";
import { ResolveForm } from "@/components/admin/ResolveForm";
import { SuspendForm } from "@/components/admin/SuspendForm";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getReviewerStatus } from "@/lib/actions/auth";
import { getOpenChatReports } from "@/lib/actions/moderation";
import { CHAT_REPORT_REASONS } from "@/lib/constants/safety";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "チャットの通報 | シフルン", robots: { index: false } };

const when = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** 審査担当（2段階認証済み）だけが開ける。データベース側でも同じ条件でしか通報を読めない。 */
export default async function ChatReportsPage() {
  const status = await getReviewerStatus();
  if (!status.reviewer || !status.aal2) redirect("/admin/login");
  const { reports, error } = await getOpenChatReports();

  return <div className="app-page">
    <AppHeader title="チャットの通報" description="利用者から届いた通報です。内容を確認し、対応したらメモを残して対応済みにします。" backHref="" />
    <AdminNav current="reports" />
    <main className="flex flex-col gap-3">
      {error && <p role="alert" className="app-error">{error}</p>}
      {reports.length === 0 && !error && <EmptyState title="未対応の通報はありません" />}
      {reports.map((report) => {
        const reporter = report.reporter_role === "worker" ? "ワーカー" : "店舗";
        return <article key={report.id} className="app-card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-bold text-ink">{CHAT_REPORT_REASONS.find((r) => r.value === report.reason)?.label ?? report.reason}</h2>
            <time className="shrink-0 text-xs text-ink-soft">{when(report.created_at)}</time>
          </div>
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-soft">通報した側</dt><dd className="font-semibold text-ink">{reporter}</dd>
            <dt className="text-ink-soft">ワーカー</dt><dd className="text-ink [overflow-wrap:anywhere]">{report.workers?.name ?? "（不明）"}</dd>
            <dt className="text-ink-soft">店舗</dt><dd className="text-ink [overflow-wrap:anywhere]">{report.stores?.name ?? "（不明）"}</dd>
            <dt className="text-ink-soft">会話</dt><dd className="text-ink">{report.kind === "scout" ? "スカウトのチャット" : "所属スタッフと店長のチャット"}</dd>
          </dl>
          {report.message_body
            ? <blockquote className="rounded-xl bg-paper p-3 text-sm leading-relaxed text-ink [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-semibold text-ink-soft">通報されたメッセージ（{reporter === "ワーカー" ? "店舗" : "ワーカー"}が送信{report.message_sent_at ? `・${when(report.message_sent_at)}` : ""}）</span><span className="whitespace-pre-wrap">{report.message_body}</span></blockquote>
            : <p className="text-sm text-ink-soft">メッセージを選ばずに、やり取り全体が通報されています。</p>}
          {report.detail && <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-semibold text-ink-soft">通報者の説明</span>{report.detail}</p>}
          <SuspendForm
            reportId={report.id}
            target={report.reporter_role === "worker"
              ? { kind: "store", id: report.store_id, name: report.stores?.name ?? "（不明）" }
              : { kind: "worker", id: report.worker_id, name: report.workers?.name ?? "（不明）" }}
          />
          <ResolveForm kind="report" id={report.id} placeholder="例：内容を確認し、相手に注意の連絡をした" />
        </article>;
      })}
      <SignOutButton className="mt-6 text-center" />
    </main>
  </div>;
}
