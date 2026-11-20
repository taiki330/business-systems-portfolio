"use server";

import { revalidatePath } from "next/cache";
import { ShiftRequestStatus } from "@/lib/types/database";
import { japanDate } from "@/lib/utils/matching";
import { requireStore, requireWorker } from "@/lib/auth/session";

export type ClockInState = { error?: string; success?: boolean };

const CHECKIN_METHODS = ["self_report", "gps", "qr"] as const;

function parseLatLng(formData: FormData): { lat: number | null; lng: number | null } {
  const latRaw = formData.get("lat");
  const lngRaw = formData.get("lng");
  const lat = latRaw === null || latRaw === "" ? null : Number(latRaw);
  const lng = lngRaw === null || lngRaw === "" ? null : Number(lngRaw);
  return {
    lat: lat !== null && Number.isFinite(lat) ? lat : null,
    lng: lng !== null && Number.isFinite(lng) ? lng : null,
  };
}

function parseCheckinMethod(formData: FormData): (typeof CHECKIN_METHODS)[number] {
  const raw = String(formData.get("checkin_method") ?? "self_report").trim();
  return (CHECKIN_METHODS as readonly string[]).includes(raw)
    ? (raw as (typeof CHECKIN_METHODS)[number])
    : "self_report";
}

export async function clockInShift(
  _prev: ClockInState,
  formData: FormData,
): Promise<ClockInState> {
  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { error: "情報が不正です。" };

  // 打刻はログイン中のワーカー本人のシフトだけ（データベースでも当日の確定シフトに限っている）。
  const { supabase, worker, error: authError } = await requireWorker();
  if (!supabase) return { error: authError };
  const workerId = worker.id;

  const { lat, lng } = parseLatLng(formData);
  const checkinMethod = parseCheckinMethod(formData);

  const { data, error } = await supabase
    .from("worker_availability_slots")
    .update({
      status: "attended",
      clock_in_at: new Date().toISOString(),
      clock_in_lat: lat,
      clock_in_lng: lng,
      checkin_method: checkinMethod,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", slotId)
    .eq("worker_id", workerId)
    .eq("status", "assigned")
    .eq("work_date", japanDate())
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "本日の未打刻の勤務が見つかりません。画面を更新してください。" };

  revalidatePath("/workers/shifts");
  revalidatePath("/workers/mypage");
  revalidatePath("/companies");
  return { success: true };
}

export type ClockOutState = { error?: string; success?: boolean };

export async function clockOutShift(
  _prev: ClockOutState,
  formData: FormData,
): Promise<ClockOutState> {
  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { error: "情報が不正です。" };

  const { supabase, worker, error: authError } = await requireWorker();
  if (!supabase) return { error: authError };
  const workerId = worker.id;

  const { lat, lng } = parseLatLng(formData);

  const { data, error } = await supabase
    .from("worker_availability_slots")
    .update({
      clock_out_at: new Date().toISOString(),
      clock_out_lat: lat,
      clock_out_lng: lng,
    })
    .eq("id", slotId)
    .eq("worker_id", workerId)
    .eq("status", "attended")
    .is("clock_out_at", null)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "退勤打刻の対象が見つかりません。画面を更新してください。" };

  revalidatePath("/workers/shifts");
  revalidatePath("/workers/mypage");
  return { success: true };
}

export type ShiftActionState = {
  error?: string;
  success?: boolean;
};

const MANAGER_STATUSES: ShiftRequestStatus[] = ["assigned", "released"];

export async function updateShiftRequestStatus(
  _prevState: ShiftActionState,
  formData: FormData,
): Promise<ShiftActionState> {
  const slotId = String(formData.get("slot_id") ?? "").trim();
  const workerId = String(formData.get("worker_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as ShiftRequestStatus;

  if (!slotId || !workerId) {
    return { error: "更新対象が不正です。" };
  }
  if (!MANAGER_STATUSES.includes(status)) {
    return { error: "不正な操作です。" };
  }

  // 確定・公開できるのは、自店のスタッフの勤務希望だけ（RLS とトリガーでも同じ制限をしている）。
  const { supabase, store, error: authError } = await requireStore();
  if (!supabase) return { error: authError };
  const { data: staff } = await supabase.from("workers").select("id").eq("id", workerId).eq("current_store_id", store.id).maybeSingle();
  if (!staff) return { error: "自店のスタッフの勤務希望だけを処理できます。" };

  const { data: slot, error: fetchError } = await supabase
    .from("worker_availability_slots")
    .select("id, worker_id, status")
    .eq("id", slotId)
    .eq("worker_id", workerId)
    .maybeSingle();

  if (fetchError) {
    return { error: fetchError.message };
  }
  if (!slot) {
    return { error: "勤務希望が見つかりません。" };
  }
  if (slot.status !== "pending") {
    return { error: "この勤務希望はすでに処理済みです。" };
  }

  const { error: updateError } = await supabase
    .from("worker_availability_slots")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", slotId)
    .eq("worker_id", workerId)
    .eq("status", "pending");

  if (updateError) {
    return {
      error: updateError.message ?? "勤務希望の更新に失敗しました。",
    };
  }

  revalidatePath(`/managers/shifts`);
  revalidatePath(`/managers/shifts/${workerId}`);
  revalidatePath(`/workers/${workerId}`);

  const periodId = String(formData.get("period_id") ?? "").trim();
  if (periodId) {
    revalidatePath(`/managers/shift-periods/${periodId}`);
  }

  return { success: true };
}
