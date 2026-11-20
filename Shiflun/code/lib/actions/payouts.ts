"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { Payout } from "@/lib/types/database";

/**
 * docs/legal/02_money-flow.md 案A（無仲介）の暫定実装。
 * Shiflunは資金に触れず、店舗が直接ワーカーへ支払ったことを店舗側が申告する。
 * 支払いレコード自体は migration 015 のトリガーで出勤確定時に自動作成される。
 */
export async function getPayoutsForManager(): Promise<{ payouts: Payout[]; error: string | null }> {
  const supabase = await createServerClient();
  if (!supabase) return { payouts: [], error: null };
  const { data, error } = await supabase
    .from("payouts")
    .select("*, workers(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  return { payouts: (data ?? []) as Payout[], error: error?.message ?? null };
}

export async function getPayoutsForWorker(
  workerId: string,
): Promise<{ payouts: Payout[]; error: string | null }> {
  const supabase = await createServerClient();
  if (!supabase) return { payouts: [], error: null };
  const { data, error } = await supabase
    .from("payouts")
    .select("*")
    .eq("worker_id", workerId)
    .order("created_at", { ascending: false })
    .limit(100);
  return { payouts: (data ?? []) as Payout[], error: error?.message ?? null };
}

export type MarkPayoutPaidState = { error?: string };

export async function markPayoutPaid(
  _prev: MarkPayoutPaidState,
  formData: FormData,
): Promise<MarkPayoutPaidState> {
  const payoutId = String(formData.get("payout_id") ?? "").trim();
  const markedBy = String(formData.get("marked_paid_by") ?? "").trim();

  if (!payoutId) return { error: "対象が不正です。" };
  if (!markedBy) return { error: "支払いを記録した担当者名を入力してください。" };

  const supabase = await createServerClient();
  if (!supabase) return { error: "現在は記録できません。" };

  const { error } = await supabase
    .from("payouts")
    .update({
      status: "paid",
      marked_paid_by: markedBy,
      paid_at: new Date().toISOString(),
    })
    .eq("id", payoutId)
    .eq("status", "pending");

  if (error) return { error: error.message };

  revalidatePath("/managers/payouts");
  revalidatePath("/workers/mypage");
  return {};
}
