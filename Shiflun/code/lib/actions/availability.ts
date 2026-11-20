"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { WorkerAvailabilitySlot } from "@/lib/types/database";

export type AvailabilityActionState = {
  error?: string;
  success?: boolean;
  createdCount?: number;
};

import {
  isValidDate,
  isValidTime,
  toDbTime,
} from "@/lib/utils/availability";
import { normalizeSlot } from "@/lib/utils/slot";
import { requireWorker } from "@/lib/auth/session";

export async function getAvailabilitySlotsByWorkerId(
  workerId: string,
): Promise<{ slots: WorkerAvailabilitySlot[]; error: string | null }> {
  const supabase = await createServerClient();

  if (!supabase) {
    const { MOCK_SLOTS } = await import("@/lib/mocks/data");
    const slots: WorkerAvailabilitySlot[] = MOCK_SLOTS
      .filter((s) => s.worker_id === workerId)
      .map((s) => {
        const { workers: _w, ...slot } = s;
        return slot;
      });
    return { slots, error: null };
  }

  const { data, error } = await supabase
    .from("worker_availability_slots")
    .select("*")
    .eq("worker_id", workerId)
    .order("work_date", { ascending: true, nullsFirst: false })
    .order("start_time", { ascending: true });

  if (error) {
    return { slots: [], error: error.message };
  }

  return {
    slots: (data ?? []).map((row) => normalizeSlot(row)),
    error: null,
  };
}

export async function createAvailabilitySlot(
  _prevState: AvailabilityActionState,
  formData: FormData,
): Promise<AvailabilityActionState> {
  const workDates = formData
    .getAll("work_dates")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const startTime = String(formData.get("start_time") ?? "").trim();
  const endTime = String(formData.get("end_time") ?? "").trim();

  if (workDates.length === 0) {
    return { error: "勤務希望日を1つ以上選択してください。" };
  }
  for (const workDate of workDates) {
    if (!isValidDate(workDate)) {
      return { error: "勤務希望日を正しく入力してください。" };
    }
  }
  if (!startTime || !isValidTime(startTime)) {
    return { error: "開始時間を正しく入力してください。" };
  }
  if (!endTime || !isValidTime(endTime)) {
    return { error: "終了時間を正しく入力してください。" };
  }
  if (endTime <= startTime) {
    return { error: "終了時間は開始時間より後に設定してください。" };
  }

  // 勤務希望はログイン中のワーカー本人の分だけ登録できる（RLS でも本人以外は拒否される）。
  const { supabase, worker, error: authError } = await requireWorker();
  if (!supabase) return { error: authError };
  const workerId = worker.id;

  const rows = workDates.map((workDate) => ({
    worker_id: workerId,
    work_date: workDate,
    start_time: toDbTime(startTime),
    end_time: toDbTime(endTime),
    slot_type: "available",
    status: "pending",
  }));

  const { error } = await supabase.from("worker_availability_slots").insert(rows);

  if (error) {
    return {
      error: error.message ?? "勤務希望の登録に失敗しました。",
    };
  }

  revalidatePath(`/workers/${workerId}`);
  revalidatePath(`/managers/shifts/${workerId}`);
  return { success: true, createdCount: workDates.length };
}

type ShiftEntry = { date: string; startTime: string; endTime: string };

export async function submitShiftCalendarEntries(
  _prev: AvailabilityActionState,
  formData: FormData,
): Promise<AvailabilityActionState> {
  const entriesRaw = String(formData.get("entries") ?? "[]");

  let entries: ShiftEntry[] = [];
  try { entries = JSON.parse(entriesRaw); } catch { return { error: "データが不正です。" }; }
  if (!Array.isArray(entries) || entries.length === 0) return { error: "日付を1日以上選択してください。" };
  if (entries.length > 62 || entries.some((e) => !isValidDate(e?.date) || !isValidTime(e?.startTime) || !isValidTime(e?.endTime) || e.endTime <= e.startTime)) {
    return { error: "日付と時間を確認してください。" };
  }

  if (!(await createServerClient())) return { success: true, createdCount: entries.length };
  const { supabase, worker, error: authError } = await requireWorker();
  if (!supabase) return { error: authError };
  const workerId = worker.id;

  const rows = entries.map(({ date, startTime, endTime }) => ({
    worker_id: workerId,
    work_date: date,
    start_time: toDbTime(startTime),
    end_time: toDbTime(endTime),
    slot_type: "available",
    status: "pending",
  }));

  const { error } = await supabase.from("worker_availability_slots").insert(rows);
  if (error) return { error: error.message };

  revalidatePath(`/workers/${workerId}`);
  revalidatePath("/managers/shifts");
  return { success: true, createdCount: entries.length };
}

export async function deleteAvailabilitySlot(
  _prevState: AvailabilityActionState,
  formData: FormData,
): Promise<AvailabilityActionState> {
  const slotId = String(formData.get("slot_id") ?? "").trim();

  if (!slotId) {
    return { error: "削除対象が不正です。" };
  }

  const { supabase, worker, error: authError } = await requireWorker();
  if (!supabase) return { error: authError };
  const workerId = worker.id;

  const { error } = await supabase
    .from("worker_availability_slots")
    .delete()
    .eq("id", slotId)
    .eq("worker_id", workerId)
    .eq("status", "pending");

  if (error) {
    return {
      error: error.message ?? "勤務希望の削除に失敗しました。",
    };
  }

  revalidatePath(`/workers/${workerId}`);
  revalidatePath(`/managers/shifts/${workerId}`);
  return { success: true };
}
