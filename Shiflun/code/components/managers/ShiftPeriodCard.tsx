import Link from "next/link";
import { ShiftPeriod } from "@/lib/types/database";

const STATUS_LABEL: Record<ShiftPeriod["status"], string> = {
  open: "募集中",
  closed: "締切済み",
  draft: "下書き",
};

const STATUS_CLASS: Record<ShiftPeriod["status"], string> = {
  open: "bg-brand-blue-light text-brand-blue",
  closed: "bg-chip text-ink-soft",
  draft: "bg-brand-yellow-light text-brand-yellow-dark",
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

type ShiftPeriodCardProps = {
  period: ShiftPeriod;
};

export function ShiftPeriodCard({ period }: ShiftPeriodCardProps) {
  return (
    <Link
      href={`/managers/shift-periods/${period.id}`}
      className="block rounded-xl border border-line bg-white p-5 transition-colors hover:border-line hover:bg-paper"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-ink">
            {period.title}
          </p>
          <p className="mt-0.5 text-sm text-ink-soft">{period.store_name}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[period.status]}`}
        >
          {STATUS_LABEL[period.status]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
        <span>
          {formatDate(period.start_date)} 〜 {formatDate(period.end_date)}
        </span>
        {period.submission_deadline && (
          <span className="text-brand-yellow-dark">
            締切: {formatDate(period.submission_deadline)}
          </span>
        )}
      </div>
    </Link>
  );
}
