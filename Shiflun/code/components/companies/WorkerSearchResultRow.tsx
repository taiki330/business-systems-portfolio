import Link from "next/link";
import { SearchParams, WorkerSearchResult } from "@/lib/types/search";
import { timeMinutes } from "@/lib/utils/matching";
import { buildScoutUrl } from "@/lib/utils/scout-url";
import { Photo } from "@/components/ui/Photo";
import { CheckBadgeIcon } from "@/components/ui/Icons";

type WorkerSearchResultRowProps = {
  result: WorkerSearchResult;
  /** 日時検索が成立している場合のみ渡す。未指定なら人物一覧として表示する */
  searchParams?: SearchParams;
};

function skillSummary(result: WorkerSearchResult): string {
  const { worker } = result;
  const skills = worker.skill_tags.length > 0 ? worker.skill_tags : worker.job_type ? [worker.job_type] : [];
  const shown = skills.slice(0, 3);
  const rest = skills.length - shown.length;
  return shown.join("・") + (rest > 0 ? ` 他${rest}` : "") || worker.business_type;
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 探している時間の中で空いている時間帯を、重なりをまとめて返す（表示用）。 */
function availableLabel(slots: { start_time: string; end_time: string }[], search: SearchParams): string | null {
  const from = timeMinutes(search.start_time);
  const to = timeMinutes(search.end_time);
  if (from === null || to === null || to <= from) return null;
  const clipped = slots
    .map((s): [number, number] => [Math.max(from, timeMinutes(s.start_time.slice(0, 5)) ?? to), Math.min(to, timeMinutes(s.end_time.slice(0, 5)) ?? from)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of clipped) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  if (!merged.length) return null;
  return `${merged.map(([a, b]) => `${clock(a)}〜${clock(b)}`).join("、")} 空き`;
}

/** 人材探しの結果1件：写真・名前・空き時間・できること・スカウトのボタン。 */
export function WorkerSearchResultRow({ result, searchParams }: WorkerSearchResultRowProps) {
  const { worker, matchingSlots } = result;
  const detailHref = `/companies/workers/${worker.id}`;
  const verified = worker.verification_status === "verified";
  const available = searchParams ? availableLabel(matchingSlots, searchParams) : null;
  const facts = [
    worker.experience_years > 0 ? `経験${worker.experience_years}年` : "未経験",
    typeof worker.completed_scout_count === "number" ? `Shiflun ${worker.completed_scout_count}回` : null,
  ].filter(Boolean).join("・");

  return (
    <li className="app-card p-3">
      <div className="relative flex gap-3">
        <Photo src={worker.photo_url} name={worker.name} className="size-24" />
        <div className="min-w-0 flex-1 py-0.5">
          <h3 className="flex min-w-0 items-center gap-2">
            <Link href={detailHref} className="truncate text-lg font-bold leading-snug text-ink after:absolute after:inset-0">{worker.name}</Link>
            {verified && <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-brand-blue"><CheckBadgeIcon className="size-4" />店長認証</span>}
          </h3>
          {worker.is_minor && <p className="mt-1"><span className="app-pill">18歳未満</span><span className="ml-2 text-xs text-ink-soft">22時以降は不可</span></p>}
          {available && <p className="app-highlight mt-1.5 tabular-nums">{available}</p>}
          <p className="mt-1.5 truncate text-sm text-ink">{skillSummary(result)}</p>
          <p className="mt-0.5 truncate text-sm text-ink-soft">{facts}</p>
        </div>
      </div>
      <Link href={searchParams ? buildScoutUrl(worker.id, searchParams) : `/companies/workers/${worker.id}/scout`} aria-label={`${worker.name}さんをスカウト`} className="app-primary mt-3 w-full">
        スカウト
      </Link>
    </li>
  );
}
