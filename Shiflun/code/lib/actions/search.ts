"use server";

import { createServerClient } from "@/lib/supabase/server";
import { WorkerAvailabilitySlot } from "@/lib/types/database";
import { WorkerSearchResult } from "@/lib/types/search";
import { toDbTime } from "@/lib/utils/availability";
import { normalizeSlot } from "@/lib/utils/slot";
import { getWorkers } from "@/lib/actions/workers";
import { matchesWorker, rankWorkers, MatchingFilters, validWorkDate, timeMinutes } from "@/lib/utils/matching";

export async function searchAvailableWorkers(
  workDate: string,
  startTime: string,
  endTime: string,
  filters: MatchingFilters = {},
): Promise<{ results: WorkerSearchResult[]; error: string | null }> {
  if (!validWorkDate(workDate)) {
    return { results: [], error: "勤務日を正しく入力してください。" };
  }
  if (timeMinutes(startTime) === null) {
    return { results: [], error: "開始時間を正しく入力してください。" };
  }
  if (timeMinutes(endTime) === null) {
    return { results: [], error: "終了時間を正しく入力してください。" };
  }
  if (endTime <= startTime) {
    return {
      results: [],
      error: "終了時間は開始時間より後に設定してください。",
    };
  }

  const supabase = await createServerClient();
  if (!supabase) {
    const { MOCK_SLOTS, MOCK_WORKERS } = await import("@/lib/mocks/data");
    const searchStart = toDbTime(startTime);
    const searchEnd = toDbTime(endTime);
    const matchingSlots = MOCK_SLOTS.filter(
      (s) =>
        s.work_date === workDate &&
        s.status === "released" &&
        s.start_time < searchEnd &&
        s.end_time > searchStart,
    );
    const busyIds = new Set(MOCK_SLOTS.filter((s) => s.work_date === workDate && ["assigned", "attended"].includes(s.status) && s.start_time < searchEnd && s.end_time > searchStart).map((s) => s.worker_id));
    const workerIds = [...new Set(matchingSlots.map((s) => s.worker_id))].filter((id) => !busyIds.has(id));
    const results = MOCK_WORKERS.filter((w) => workerIds.includes(w.id)).map(
      (worker) => ({
        worker,
        matchingSlots: matchingSlots.filter((s) => s.worker_id === worker.id),
      }),
    );
    return { results: rankWorkers(results.filter((r) => matchesWorker(r.worker, filters)), startTime, endTime), error: null };
  }

  const searchStart = toDbTime(startTime);
  const searchEnd = toDbTime(endTime);

  const { data: slots, error: slotsError } = await supabase
    .from("worker_availability_slots")
    .select("*")
    .eq("work_date", workDate)
    .eq("status", "released")
    .lt("start_time", searchEnd)
    .gt("end_time", searchStart)
    .order("start_time", { ascending: true });

  if (slotsError) {
    return { results: [], error: slotsError.message };
  }

  const normalizedSlots = (slots ?? []).map((row) => normalizeSlot(row));
  if (normalizedSlots.length === 0) {
    return { results: [], error: null };
  }

  const { data: busySlots, error: busyError } = await supabase.from("worker_availability_slots").select("worker_id").eq("work_date", workDate).in("status", ["assigned", "attended"]).lt("start_time", searchEnd).gt("end_time", searchStart);
  if (busyError) return { results: [], error: busyError.message };
  const busyIds = new Set((busySlots ?? []).map((slot) => slot.worker_id));
  // ブロックした・された相手は検索結果に出さない（migration 023）。スカウトを送ろうとしてもデータベース側で止まる。
  const { data: blockedRows, error: blockedError } = await supabase.rpc("my_blocked_worker_ids");
  if (blockedError) return { results: [], error: blockedError.message };
  const blockedIds = new Set(((blockedRows ?? []) as string[]).map(String));
  const workerIds = [...new Set(normalizedSlots.map((slot) => slot.worker_id))].filter((id) => !busyIds.has(id) && !blockedIds.has(id));

  const { workers, error: workersError } = await getWorkers();

  if (workersError) {
    return { results: [], error: workersError };
  }

  const slotsByWorker = new Map<string, WorkerAvailabilitySlot[]>();
  for (const slot of normalizedSlots) {
    const existing = slotsByWorker.get(slot.worker_id) ?? [];
    existing.push(slot);
    slotsByWorker.set(slot.worker_id, existing);
  }

  const results: WorkerSearchResult[] = workers.filter((worker) => workerIds.includes(worker.id) && matchesWorker(worker, filters)).map((worker) => ({
    worker,
    matchingSlots: slotsByWorker.get(worker.id) ?? [],
  }));

  return { results: rankWorkers(results, startTime, endTime), error: null };
}
