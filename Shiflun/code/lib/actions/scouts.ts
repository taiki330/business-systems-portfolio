"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireStore, requireWorker } from "@/lib/auth/session";
import { ScoutRequest } from "@/lib/types/database";
import { storePhotoUrls, workerPhotoUrls } from "@/lib/photos";
import { calculateOffer, japanDate, validWorkDate, SCOUT_FEE_PERCENT } from "@/lib/utils/matching";

/** photos は「店舗ID → 店舗写真のURL」。 */
export async function getScoutsByWorkerId(workerId: string): Promise<{ scouts: ScoutRequest[]; photos: Record<string, string>; error: string | null }> {
  const supabase = await createServerClient();
  if (!supabase) {
    const { MOCK_SCOUT_REQUESTS } = await import("@/lib/mocks/data");
    return { scouts: MOCK_SCOUT_REQUESTS.filter((s) => s.worker_id === workerId), photos: {}, error: null };
  }
  const { data, error } = await supabase.from("scout_requests").select("*").eq("worker_id", workerId).order("created_at", { ascending: false });
  const scouts = (data ?? []) as ScoutRequest[];
  return { scouts, photos: await storePhotoUrls(supabase, scouts.map((s) => s.store_id)), error: error?.message ?? null };
}

export type StoreScout = ScoutRequest & { workers: { name: string } | null };
/** photos は「ワーカーID → プロフィール写真のURL」。 */
export async function getScoutsByStoreId(storeId: string): Promise<{ scouts: StoreScout[]; photos: Record<string, string>; error: string | null }> {
  const supabase = await createServerClient();
  if (!supabase) return { scouts: [], photos: {}, error: null };
  const { data, error } = await supabase.from("scout_requests").select("*, workers(name)").eq("store_id", storeId).order("created_at", { ascending: false });
  const scouts = (data ?? []) as StoreScout[];
  return { scouts, photos: await workerPhotoUrls(supabase, scouts.map((s) => s.worker_id)), error: error?.message ?? null };
}

export type ScoutStatusState = { error?: string; status?: "accepted" | "rejected" };

export async function updateScoutStatus(_prev: ScoutStatusState, formData: FormData): Promise<ScoutStatusState> {
  const scoutId = String(formData.get("scout_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!scoutId || (status !== "accepted" && status !== "rejected")) return { error: "返信内容を確認してください。" };
  // 返信できるのはログイン中のワーカー本人だけ（respond_to_scout もログイン中の本人かを確かめる）。
  const { supabase, worker, error: authError } = await requireWorker();
  if (!supabase) return { error: authError };
  const { error } = await supabase.rpc("respond_to_scout", { p_scout_id: scoutId, p_worker_id: worker.id, p_status: status });
  if (error) return { error: error.message };
  for (const path of ["/workers/scouts", "/workers/shifts", "/workers/mypage", "/managers/scouts", "/companies"]) revalidatePath(path);
  return { status };
}

export type CreateScoutRequestState = { error?: string };

export async function createScoutRequest(_prev: CreateScoutRequestState, form: FormData): Promise<CreateScoutRequestState> {
  const workerId = String(form.get("worker_id") ?? "").trim();
  const date = String(form.get("preferred_work_date") ?? "");
  const start = String(form.get("preferred_start_time") ?? "");
  const end = String(form.get("preferred_end_time") ?? "");
  const breakMinutes = Number(form.get("break_minutes") ?? 0);
  const expectedWage = Number(form.get("expected_hourly_wage"));
  const expectedFee = Number(form.get("expected_fee_percent"));
  const message = String(form.get("message") ?? "").trim();
  if (!workerId) return { error: "スカウトを送る相手を確認してください。" };
  if (expectedFee !== SCOUT_FEE_PERCENT) return { error: "手数料を確認するため、画面を更新して再度ご確認ください。" };
  if (!validWorkDate(date) || date < japanDate()) return { error: "今日以降の勤務日を選択してください。" };
  if (!message || message.length > 2000) return { error: "メッセージは1〜2000文字で入力してください。" };
  // 送信元は、ログイン中のオーナーの店舗に限る（画面から送られた店舗IDは使わない）。
  const { supabase, store, error: authError } = await requireStore();
  if (!supabase) return { error: authError };
  const storeId = store.id;
  const wage = Number(store.hourly_wage);
  if (wage !== expectedWage) return { error: "店舗の時給が変更されました。画面を更新して提示額をご確認ください。" };
  const offer = calculateOffer(wage, start, end, breakMinutes);
  if (!offer) return { error: "店舗の時給、同日内の勤務時間、休憩時間を確認してください。" };
  const company = store.companies as unknown as { name: string } | null;
  // The DB trigger independently checks the current store rate and snapshots the amount.
  const { error } = await supabase.from("scout_requests").insert({ worker_id: workerId, store_id: storeId, company_name: company?.name ?? "", store_name: store.name, preferred_work_date: date, preferred_start_time: `${start}:00`, preferred_end_time: `${end}:00`, offered_hourly_wage: wage, break_minutes: breakMinutes, work_minutes: offer.workMinutes, offered_total_yen: offer.totalYen, service_fee_percent: SCOUT_FEE_PERCENT, message });
  if (error) return { error: error.message };
  revalidatePath("/managers/scouts");
  revalidatePath("/workers/scouts");
  redirect(`/companies/workers/${workerId}/scout/success`);
}
