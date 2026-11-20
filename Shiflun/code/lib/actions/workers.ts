"use server";

import { createServerClient } from "@/lib/supabase/server";
import { Worker } from "@/lib/types/database";
import { normalizeWorker } from "@/lib/utils/worker";
import { requireStore } from "@/lib/auth/session";
import { withPhotoUrl } from "@/lib/photos";

export async function getWorkers(): Promise<{
  workers: Worker[];
  error: string | null;
}> {
  const supabase = await createServerClient();

  if (!supabase) {
    const { MOCK_WORKERS } = await import("@/lib/mocks/data");
    return { workers: MOCK_WORKERS, error: null };
  }

  const { data, error } = await supabase
    .from("workers")
    .select("*")
    // 退会したワーカー（migration 023）と、利用停止中のワーカー（migration 026）は一覧に出さない。
    .is("deleted_at", null)
    .is("suspended_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return { workers: [], error: error.message };
  }

  const { data: stats, error: statsError } = await supabase.from("worker_scout_stats").select("worker_id, completed_scout_count");
  const counts = new Map((stats ?? []).map((row) => [row.worker_id, Number(row.completed_scout_count)]));
  const rows = await withPhotoUrl(supabase, (data ?? []).map((row) => normalizeWorker(row)));
  return {
    workers: rows.map((row) => ({ ...row, completed_scout_count: counts.get(row.id) })),
    error: statsError ? "勤務実績を読み込めませんでした。" : null,
  };
}

export async function getWorkerById(
  id: string,
): Promise<{ worker: Worker | null; error: string | null }> {
  const supabase = await createServerClient();

  if (!supabase) {
    const { MOCK_WORKERS } = await import("@/lib/mocks/data");
    return { worker: MOCK_WORKERS.find((worker) => worker.id === id) ?? null, error: null };
  }

  const { data, error } = await supabase
    .from("workers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { worker: null, error: error.message };
  }

  const { data: stats, error: statsError } = data
    ? await supabase.from("worker_scout_stats").select("completed_scout_count").eq("worker_id", id).maybeSingle()
    : { data: null, error: null };
  return {
    worker: data ? { ...(await withPhotoUrl(supabase, [normalizeWorker(data)]))[0], completed_scout_count: stats ? Number(stats.completed_scout_count) : undefined } : null,
    error: statsError ? "勤務実績を読み込めませんでした。" : null,
  };
}

/** 店舗のスタッフ管理用: ログイン中のオーナーの店舗を、現在の所属先として登録しているワーカーだけ。 */
export async function getMyStaff(): Promise<{ workers: Worker[]; error: string | null }> {
  if (!(await createServerClient())) {
    const { MOCK_WORKERS } = await import("@/lib/mocks/data");
    return { workers: MOCK_WORKERS, error: null };
  }
  const { supabase, store, error: authError } = await requireStore();
  if (!supabase) return { workers: [], error: authError };
  const { data, error } = await supabase.from("workers").select("*").eq("current_store_id", store.id).order("created_at", { ascending: false });
  return { workers: (data ?? []).map((row) => normalizeWorker(row)), error: error?.message ?? null };
}
