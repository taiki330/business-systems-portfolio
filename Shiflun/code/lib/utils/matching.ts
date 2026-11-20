/** Shared, deterministic rules for the offer preview, validation, and fair ordering. */
export const SCOUT_FEE_PERCENT = 20;

export function calculateStoreCost(totalYen: number) {
  const feeYen = Math.round(totalYen * SCOUT_FEE_PERCENT / 100);
  return { feePercent: SCOUT_FEE_PERCENT, feeYen, storeTotalYen: totalYen + feeYen };
}

export function japanDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function validWorkDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function timeMinutes(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function calculateOffer(hourlyWage: number, start: string, end: string, breakMinutes = 0) {
  const from = timeMinutes(start);
  const to = timeMinutes(end);
  if (from === null || to === null || to <= from || !Number.isInteger(hourlyWage) || hourlyWage < 1 || hourlyWage > 999999 || !Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes >= to - from) return null;
  const workMinutes = to - from - breakMinutes;
  return { workMinutes, totalYen: Math.round(hourlyWage * workMinutes / 60) };
}

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours ? `${hours}時間` : ""}${rest ? `${rest}分` : ""}` || "0分";
}

export type MatchingFilters = {
  area?: string;
  business_type?: string;
  skill?: string;
  verified?: string;
  min_experience?: string;
};

export function matchesWorker(worker: { preferred_areas?: string[]; business_type: string; skill_tags: string[]; verification_status: string; experience_years: number }, filters: MatchingFilters) {
  const area = (filters.area ?? "").normalize("NFKC").trim().toLowerCase();
  const experience = Number(filters.min_experience || 0);
  return (!area || (worker.preferred_areas ?? []).some((value) => value.normalize("NFKC").toLowerCase().includes(area)))
    && (!filters.business_type || worker.business_type === filters.business_type)
    && (!filters.skill || worker.skill_tags.includes(filters.skill))
    && (filters.verified !== "true" || worker.verification_status === "verified")
    && Number.isFinite(experience) && experience >= 0 && worker.experience_years >= experience;
}

/** Union of overlapping available intervals: duplicate slots never improve the fit. */
export function coverageMinutes(slots: { start_time: string; end_time: string }[], start: string, end: string): number {
  const from = timeMinutes(start);
  const to = timeMinutes(end);
  if (from === null || to === null) return 0;
  const intervals = slots.map((s) => [Math.max(from, timeMinutes(s.start_time) ?? to), Math.min(to, timeMinutes(s.end_time) ?? from)])
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let count = 0;
  let covered = from;
  for (const [a, b] of intervals) {
    count += Math.max(0, b - Math.max(a, covered));
    covered = Math.max(covered, b);
  }
  return count;
}

export const RANKING_RULES = { blockSize: 5, usageCap: 5 } as const;

/** Fit first. Daily rotation; usage can move a candidate at most 3 places within a block.
 * The first position stays in rotation, and counts above the cap add no advantage. */
export function rankWorkers<T extends { worker: { id: string; completed_scout_count?: number }; matchingSlots: { start_time: string; end_time: string }[] }>(results: T[], start?: string, end?: string, day = japanDate()): T[] {
  const groups = new Map<number, T[]>();
  for (const result of results) {
    const fit = start && end ? coverageMinutes(result.matchingSlots, start, end) : 0;
    groups.set(fit, [...(groups.get(fit) ?? []), result]);
  }
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
  return [...groups.entries()].sort(([a], [b]) => b - a).flatMap(([, group]) => {
    const stable = [...group].sort((a, b) => a.worker.id.localeCompare(b.worker.id));
    const rotationDay = stable.length === 2 ? Math.floor(dayNumber / 2) : dayNumber;
    const offset = ((rotationDay % stable.length) + stable.length) % stable.length;
    const rotated = [...stable.slice(offset), ...stable.slice(0, offset)];
    const ordered: T[] = [];
    for (let i = 0; i < rotated.length; i += RANKING_RULES.blockSize) {
      const block = rotated.slice(i, i + RANKING_RULES.blockSize);
      // In a pair, alternate a rotation day with a usage day. Larger blocks
      // keep their first place in rotation and sort the other (at most four) people.
      const reserved = block.length === 2 && dayNumber % 2 !== 0 ? undefined : block.shift();
      block.sort((a, b) => Math.min(b.worker.completed_scout_count ?? 0, RANKING_RULES.usageCap) - Math.min(a.worker.completed_scout_count ?? 0, RANKING_RULES.usageCap));
      ordered.push(...(reserved ? [reserved] : []), ...block);
    }
    return ordered;
  });
}
