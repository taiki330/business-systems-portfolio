import { Worker } from "@/lib/types/database";

type ManagerWorkerSummaryProps = {
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

export function ManagerWorkerSummary({ worker }: ManagerWorkerSummaryProps) {
  const skillTags = displaySkillTags(worker);

  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-sm font-semibold text-ink-soft">認証対象のバイト</h2>

      <dl className="mt-4 space-y-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            名前
          </dt>
          <dd className="mt-1 text-lg font-bold text-ink">{worker.name}</dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            勤務先
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {worker.current_store}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            業態
          </dt>
          <dd className="mt-1">
            <span className="rounded-full bg-chip px-3 py-1 text-sm font-medium text-ink-soft">
              {worker.business_type}
            </span>
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            スキルタグ
          </dt>
          <dd className="mt-2 flex flex-wrap gap-2">
            {skillTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-brand-blue-light px-3 py-1 text-sm font-medium text-brand-blue"
              >
                {tag}
              </span>
            ))}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            経験年数
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {worker.experience_years} 年
          </dd>
        </div>
      </dl>
    </section>
  );
}
