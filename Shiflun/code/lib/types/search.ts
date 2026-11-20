import { Worker, WorkerAvailabilitySlot } from "@/lib/types/database";

export type WorkerSearchResult = {
  worker: Worker;
  matchingSlots: WorkerAvailabilitySlot[];
};

export type SearchParams = {
  work_date: string;
  start_time: string;
  end_time: string;
};

export type ParsedSearchParams =
  | { ok: true; params: SearchParams }
  | { ok: false; error: string };

export function parseSearchParams(
  workDate: string | undefined,
  startTime: string | undefined,
  endTime: string | undefined,
): ParsedSearchParams | null {
  const work_date = (workDate ?? "").trim();
  const start_time = (startTime ?? "").trim();
  const end_time = (endTime ?? "").trim();

  if (!work_date && !start_time && !end_time) {
    return null;
  }

  if (!work_date) {
    return { ok: false, error: "勤務日を入力してください。" };
  }
  if (!start_time) {
    return { ok: false, error: "開始時間を入力してください。" };
  }
  if (!end_time) {
    return { ok: false, error: "終了時間を入力してください。" };
  }

  return { ok: true, params: { work_date, start_time, end_time } };
}

export type ScoutPrefillParams = {
  preferred_work_date: string;
  preferred_start_time: string;
  preferred_end_time: string;
};

export function parseScoutPrefill(
  workDate: string | undefined,
  startTime: string | undefined,
  endTime: string | undefined,
): ScoutPrefillParams | null {
  const parsed = parseSearchParams(workDate, startTime, endTime);
  if (!parsed?.ok) {
    return null;
  }

  return {
    preferred_work_date: parsed.params.work_date,
    preferred_start_time: parsed.params.start_time,
    preferred_end_time: parsed.params.end_time,
  };
}
