import { ManagerVerification, Worker } from "@/lib/types/database";
import { formatVerificationDate } from "@/components/managers/ManagerVerificationDetails";
import { CheckBadgeIcon } from "@/components/ui/Icons";

/** 勤務先の店長による認証の内容（他の店舗が、スカウト前に確認するための表示）。 */
export function CompanyVerificationBlock({ worker, verification }: { worker: Worker; verification: ManagerVerification | null }) {
  if (worker.verification_status === "verified" && verification) {
    return (
      <section className="app-card">
        <h2 className="flex items-center gap-1.5 text-base font-bold text-brand-blue"><CheckBadgeIcon className="size-5" />店長認証済み</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">勤務先の店長が、在籍と経験を確認しています。</p>
        <p className="mt-3 whitespace-pre-wrap rounded-lg bg-paper p-3 text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">{verification.manager_comment}</p>
        <p className="mt-2 text-xs text-ink-soft [overflow-wrap:anywhere]">{verification.store_name}　{verification.manager_name}　{formatVerificationDate(verification.created_at)}</p>
      </section>
    );
  }
  return (
    <section className="app-card">
      <h2 className="text-base font-bold text-ink">店長認証はまだありません</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">勤務先の店長による在籍確認が済んでいないワーカーです。</p>
    </section>
  );
}
