"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireStore } from "@/lib/auth/session";
import { ShiftPeriod, WorkerAvailabilitySlotWithWorker } from "@/lib/types/database";
import { normalizeSlot } from "@/lib/utils/slot";
import { MOCK_SHIFT_PERIODS, MOCK_SLOTS } from "@/lib/mocks/data";

export type ShiftPeriodActionState = {
  error?: string;
  success?: boolean;
};

export async function createShiftPeriod(
  _prevState: ShiftPeriodActionState,
  formData: FormData,
): Promise<ShiftPeriodActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const startDate = String(formData.get("start_date") ?? "").trim();
  const endDate = String(formData.get("end_date") ?? "").trim();
  const submissionDeadline = String(formData.get("submission_deadline") ?? "").trim();

  if (!title) return { error: "シフト名を入力してください。" };
  if (!startDate) return { error: "開始日を入力してください。" };
  if (!endDate) return { error: "終了日を入力してください。" };
  if (endDate < startDate) return { error: "終了日は開始日以降に設定してください。" };
  if (submissionDeadline && submissionDeadline > endDate) {
    return { error: "希望締切日は終了日以前に設定してください。" };
  }

  // シフト期間は、ログイン中のオーナーの店舗のものとして作る。
  const { supabase, store, error: authError } = await requireStore();
  if (!supabase) return { error: authError };

  const { data, error } = await supabase
    .from("shift_periods")
    .insert({
      store_id: store.id,
      store_name: store.name,
      title,
      start_date: startDate,
      end_date: endDate,
      submission_deadline: submissionDeadline || null,
      status: "open",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "シフト期間の作成に失敗しました。" };
  }

  revalidatePath("/managers/shift-periods");
  redirect(`/managers/shift-periods/${data.id}`);
}

export async function getShiftPeriods(
  storeName?: string,
): Promise<{ periods: ShiftPeriod[]; error: string | null }> {
  const supabase = await createServerClient();
  if (!supabase) {
    const mock = storeName
      ? MOCK_SHIFT_PERIODS.filter((p) => p.store_name === storeName)
      : MOCK_SHIFT_PERIODS;
    return { periods: mock, error: null };
  }

  let query = supabase
    .from("shift_periods")
    .select("*")
    .order("start_date", { ascending: false });

  if (storeName) {
    query = query.eq("store_name", storeName);
  }

  const { data, error } = await query;
  if (error) return { periods: [], error: error.message };
  return { periods: (data ?? []) as ShiftPeriod[], error: null };
}

export async function getShiftPeriodById(
  id: string,
): Promise<{ period: ShiftPeriod | null; error: string | null }> {
  const supabase = await createServerClient();
  if (!supabase) {
    const mock = MOCK_SHIFT_PERIODS.find((p) => p.id === id) ?? null;
    return { period: mock, error: null };
  }

  const { data, error } = await supabase
    .from("shift_periods")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return { period: null, error: error.message };
  return { period: data as ShiftPeriod | null, error: null };
}

export async function getSlotsByPeriod(
  startDate: string,
  endDate: string,
): Promise<{ slots: WorkerAvailabilitySlotWithWorker[]; error: string | null }> {
  const supabase = await createServerClient();
  if (!supabase) {
    const mock = MOCK_SLOTS.filter(
      (s) => s.work_date && s.work_date >= startDate && s.work_date <= endDate,
    );
    return { slots: mock, error: null };
  }

  // 店舗のシフト表には、自店のスタッフのシフトと、自店のスカウトで決まったシフトだけを出す
  // （RLS は人材検索のため、他店のスタッフが公開したシフトも読めるようにしている）。
  const { supabase: storeClient, store, error: authError } = await requireStore();
  if (!storeClient) return { slots: [], error: authError };
  const { data: staff, error: staffError } = await storeClient.from("workers").select("id").eq("current_store_id", store.id);
  if (staffError) return { slots: [], error: staffError.message };
  const staffIds = (staff ?? []).map((w) => w.id);
  const scope = staffIds.length ? `store_id.eq.${store.id},worker_id.in.(${staffIds.join(",")})` : `store_id.eq.${store.id}`;

  const { data, error } = await storeClient
    .from("worker_availability_slots")
    .select("*, workers(id, name, current_store)")
    .or(scope)
    .gte("work_date", startDate)
    .lte("work_date", endDate)
    .order("work_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) return { slots: [], error: error.message };

  const slots = (data ?? []).map((row) => ({
    ...normalizeSlot(row),
    workers: row.workers as WorkerAvailabilitySlotWithWorker["workers"],
  }));

  return { slots, error: null };
}

export async function closeShiftPeriod(
  _prevState: ShiftPeriodActionState,
  formData: FormData,
): Promise<ShiftPeriodActionState> {
  const periodId = String(formData.get("period_id") ?? "").trim();
  if (!periodId) return { error: "不正な操作です。" };

  const supabase = await createServerClient();
  if (!supabase) {
    return { error: "データベースに接続できません。" };
  }

  const { error } = await supabase
    .from("shift_periods")
    .update({ status: "closed" })
    .eq("id", periodId);

  if (error) return { error: error.message };

  revalidatePath(`/managers/shift-periods/${periodId}`);
  revalidatePath("/managers/shift-periods");
  return { success: true };
}
