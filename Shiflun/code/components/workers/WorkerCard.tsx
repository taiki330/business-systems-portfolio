import Link from "next/link";
import { Worker } from "@/lib/types/database";
import { VerificationBadge } from "@/components/workers/VerificationBadge";

type WorkerCardProps = {
  worker: Worker;
};

function displaySkillTags(worker: Worker): string[] {
  if (worker.skill_tags.length > 0) {
    return worker.skill_tags;
  }
  if (worker.job_type) {
    return [worker.job_type];
  }
  return [];
}

export function WorkerCard({ worker }: WorkerCardProps) {
  const skillTags = displaySkillTags(worker);

  return (
    <Link
      href={`/companies/workers/${worker.id}`}
      className="block rounded-xl transition-colors hover:bg-paper active:bg-chip"
    >
      <article className="rounded-xl border border-line bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-ink">
              {worker.name}
            </h2>
            <p className="mt-1 text-sm font-medium text-ink-soft">
              {worker.current_store}
            </p>
          </div>
          <VerificationBadge status={worker.verification_status} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-chip px-3 py-1 text-xs font-medium text-ink-soft">
            {worker.business_type}
          </span>
          {skillTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-brand-blue-light px-3 py-1 text-xs font-medium text-brand-blue"
            >
              {tag}
            </span>
          ))}
          <span className="rounded-full bg-brand-blue-light px-3 py-1 text-xs font-medium text-brand-blue">
            経験 {worker.experience_years} 年
          </span>
        </div>

        {worker.skills && (
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            <span className="font-medium text-ink-soft">その他スキル：</span>
            {worker.skills}
          </p>
        )}

        {worker.bio && (
          <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-soft">
            {worker.bio}
          </p>
        )}

        <p className="mt-4 text-right text-xs font-medium text-ink-soft">
          詳細を見る
        </p>
      </article>
    </Link>
  );
}
