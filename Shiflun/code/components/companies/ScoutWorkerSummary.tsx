import { Worker } from "@/lib/types/database";
import { VerificationBadge } from "@/components/workers/VerificationBadge";
import { Photo } from "@/components/ui/Photo";

/** スカウトを送る相手の確認用の表示。 */
export function ScoutWorkerSummary({ worker }: { worker: Worker }) {
  const skillTags = worker.skill_tags.length > 0 ? worker.skill_tags : worker.job_type ? [worker.job_type] : [];
  return (
    <section aria-label="送信先のワーカー" className="app-card flex items-center gap-3">
      <Photo src={worker.photo_url} name={worker.name} className="size-16" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-soft">スカウトを送る相手</p>
        <p className="truncate text-lg font-bold text-ink">{worker.name}</p>
        <p className="mt-0.5 truncate text-sm text-ink-soft">{[worker.business_type, ...skillTags].filter(Boolean).join("・")}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1"><VerificationBadge status={worker.verification_status} size="sm" />{worker.is_minor && <span className="app-pill">18歳未満</span>}</div>
    </section>
  );
}
