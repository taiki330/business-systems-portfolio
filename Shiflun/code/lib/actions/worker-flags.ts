"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireStore } from "@/lib/auth/session";
import { WorkerFlag } from "@/lib/types/database";

export type ReportWorkerState = {
  error?: string;
  success?: boolean;
};

/**
 * 店長が「この人に見覚えがない（自店で働いていない）」と通報するアクション。
 * 店舗所属が自己申告制になったことの事後チェック機能（Phase 8-B）。
 */
export async function reportWorker(
  _prev: ReportWorkerState,
  formData: FormData,
): Promise<ReportWorkerState> {
  const workerId = String(formData.get("worker_id") ?? "").trim();
  const reporterName = String(formData.get("reporter_name") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!workerId) return { error: "対象が不正です。" };
  if (!reporterName) return { error: "通報者（店長）の名前を入力してください。" };
  if (!reason) return { error: "通報理由を入力してください。" };

  if (!(await createServerClient())) return { success: true };
  // 通報できるのは、ログイン中のオーナーの店舗に所属しているスタッフについてだけ。
  const { supabase, store, error: authError } = await requireStore();
  if (!supabase) return { error: authError };

  const { error } = await supabase.from("worker_flags").insert({
    worker_id: workerId,
    store_id: store.id,
    store_name: store.name,
    reporter_name: reporterName,
    reason,
    status: "open",
  });

  if (error) return { error: error.message };

  revalidatePath("/managers/staff");
  return { success: true };
}

export async function getOpenWorkerFlags(): Promise<{
  flags: (WorkerFlag & { workers: { id: string; name: string; current_store: string } | null })[];
  error: string | null;
}> {
  const supabase = await createServerClient();
  if (!supabase) return { flags: [], error: null };

  const { data, error } = await supabase
    .from("worker_flags")
    .select("*, workers(id, name, current_store)")
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (error) return { flags: [], error: error.message };
  return {
    flags: (data ?? []) as (WorkerFlag & {
      workers: { id: string; name: string; current_store: string } | null;
    })[],
    error: null,
  };
}

export type ResolveWorkerFlagState = { error?: string };

export async function resolveWorkerFlag(
  _prev: ResolveWorkerFlagState,
  formData: FormData,
): Promise<ResolveWorkerFlagState> {
  const flagId = String(formData.get("flag_id") ?? "").trim();
  const resolution = String(formData.get("resolution") ?? "").trim() as
    | "resolved"
    | "dismissed";

  if (!flagId || !["resolved", "dismissed"].includes(resolution)) {
    return { error: "不正なリクエストです。" };
  }

  const supabase = await createServerClient();
  if (!supabase) {
    revalidatePath("/managers/staff");
    return {};
  }

  const { error } = await supabase
    .from("worker_flags")
    .update({ status: resolution, resolved_at: new Date().toISOString() })
    .eq("id", flagId)
    .eq("status", "open");

  if (error) return { error: error.message };

  revalidatePath("/managers/staff");
  return {};
}
