import { ReactNode } from "react";
import { Worker } from "@/lib/types/database";
import { VerificationBadge } from "@/components/workers/VerificationBadge";
import { Photo } from "@/components/ui/Photo";

function displaySkillTags(worker: Worker): string[] {
  if (worker.skill_tags.length > 0) return worker.skill_tags;
  return worker.job_type ? [worker.job_type] : [];
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex gap-3 py-3 text-sm">
    <dt className="w-24 shrink-0 text-ink-soft">{label}</dt>
    <dd className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]">{children}</dd>
  </div>;
}

/** ワーカーのプロフィール（写真・名前・経験など）。 */
export function WorkerProfileSummary({ worker }: { worker: Worker }) {
  const skillTags = displaySkillTags(worker);
  return (
    <section className="app-card">
      <div className="flex items-center gap-4">
        <Photo src={worker.photo_url} name={worker.name} className="size-24" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold leading-snug text-ink [overflow-wrap:anywhere]">{worker.name}</h2>
          <p className="mt-0.5 text-sm text-ink-soft [overflow-wrap:anywhere]">{worker.current_store}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5"><VerificationBadge status={worker.verification_status} />{worker.is_minor && <span className="app-pill">18歳未満</span>}</div>
          {worker.is_minor && <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">午後10時から翌午前5時の勤務はお願いできません。</p>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 divide-x divide-line rounded-lg bg-paper py-3 text-center">
        <div><p className="text-xs text-ink-soft">経験</p><p className="text-2xl font-black tabular-nums text-ink">{worker.experience_years}<span className="ml-0.5 text-sm font-bold">年</span></p></div>
        <div><p className="text-xs text-ink-soft">シフルンで働いた回数</p><p className="text-2xl font-black tabular-nums text-ink">{worker.completed_scout_count ?? "—"}<span className="ml-0.5 text-sm font-bold">回</span></p></div>
      </div>

      <dl className="mt-2 divide-y divide-line">
        <Row label="業態">{worker.business_type}</Row>
        <Row label="ポジション">{skillTags.length ? <span className="flex flex-wrap gap-1.5">{skillTags.map((tag) => <span key={tag} className="app-tag">{tag}</span>)}</span> : "未設定"}</Row>
        <Row label="希望エリア">{worker.preferred_areas?.length ? worker.preferred_areas.join("・") : "未設定"}</Row>
        {worker.skills && <Row label="スキルの補足">{worker.skills}</Row>}
        <Row label="自己紹介">{worker.bio ? <span className="whitespace-pre-wrap leading-relaxed">{worker.bio}</span> : "未入力"}</Row>
      </dl>
    </section>
  );
}
