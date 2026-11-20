"use server";

import { SupabaseClient } from "@supabase/supabase-js";
import { authorizeActor } from "@/lib/auth/session";
import { participantScout, validParticipant } from "@/lib/supabase/participant";
import { ChatReportReason, Participant } from "@/lib/types/database";
import { CHAT_REPORT_REASONS } from "@/lib/constants/safety";

/** 会話の種類。scout: 承諾済みスカウトの会話（threadId = scout_id）/ staff: 所属スタッフと店長（threadId = worker_id）。 */
export type ThreadKind = "scout" | "staff";

const UUID = /^[0-9a-f-]{36}$/i;
type Pair = { supabase: SupabaseClient; workerId: string; storeId: string; scoutId: string | null };

/** ログイン中の本人が当事者の会話について、相手との組み合わせ（ワーカーと店舗）を求める。 */
async function resolvePair(actor: Participant, kind: ThreadKind, threadId: string): Promise<{ pair: Pair | null; error: string | null }> {
  if (!validParticipant(actor) || typeof threadId !== "string" || !UUID.test(threadId)) return { pair: null, error: "ログインし直してください。" };
  if (kind === "scout") {
    const { supabase, scout, error } = await participantScout(actor, threadId);
    if (!supabase || !scout || !scout.store_id) return { pair: null, error: error ?? "対象の会話が見つかりません。" };
    return { pair: { supabase, workerId: scout.worker_id, storeId: scout.store_id, scoutId: scout.id }, error: null };
  }
  if (kind !== "staff") return { pair: null, error: "対象の会話が見つかりません。" };
  const supabase = await authorizeActor(actor);
  if (!supabase) return { pair: null, error: "ログインし直してください。" };
  if (actor.role === "store") return { pair: { supabase, workerId: threadId, storeId: actor.id, scoutId: null }, error: null };
  if (actor.id !== threadId) return { pair: null, error: "自分の会話だけを操作できます。" };
  const { data: worker } = await supabase.from("workers").select("current_store_id").eq("id", actor.id).maybeSingle();
  if (!worker?.current_store_id) return { pair: null, error: "所属店舗が登録されていません。" };
  return { pair: { supabase, workerId: actor.id, storeId: worker.current_store_id, scoutId: null }, error: null };
}

/** 自分がこの相手をブロックしているか（相手からブロックされているかは分からない）。 */
export async function getBlockState(actor: Participant, kind: ThreadKind, threadId: string): Promise<{ blocked: boolean; error: string | null }> {
  const { pair, error } = await resolvePair(actor, kind, threadId);
  if (!pair) return { blocked: false, error };
  const { data, error: readError } = await pair.supabase.from("chat_blocks").select("id").eq("worker_id", pair.workerId).eq("store_id", pair.storeId).eq("blocked_by", actor.role).maybeSingle();
  return { blocked: Boolean(data), error: readError ? "ブロックの状態を読み込めませんでした。" : null };
}

/** 相手をブロックする・解除する。ブロック中は、お互いにメッセージを送れず、店舗からのスカウトも届かない。 */
export async function setBlock(actor: Participant, kind: ThreadKind, threadId: string, blocked: boolean): Promise<{ blocked: boolean; error: string | null }> {
  const { pair, error } = await resolvePair(actor, kind, threadId);
  if (!pair) return { blocked: false, error };
  const key = { worker_id: pair.workerId, store_id: pair.storeId, blocked_by: actor.role };
  const { error: saveError } = blocked
    ? await pair.supabase.from("chat_blocks").upsert(key, { onConflict: "worker_id,store_id,blocked_by", ignoreDuplicates: true })
    : await pair.supabase.from("chat_blocks").delete().eq("worker_id", key.worker_id).eq("store_id", key.store_id).eq("blocked_by", key.blocked_by);
  if (saveError) return { blocked: !blocked, error: blocked ? "ブロックできませんでした。時間をおいてお試しください。" : "ブロックを解除できませんでした。時間をおいてお試しください。" };
  return { blocked, error: null };
}

/** 会話の相手（または特定のメッセージ）を運営に通報する。通報したことは相手には伝わらない。 */
export async function reportChat(actor: Participant, kind: ThreadKind, threadId: string, input: { messageId?: string | null; reason: ChatReportReason; detail?: string }): Promise<{ success: boolean; error: string | null }> {
  if (!input || !CHAT_REPORT_REASONS.some((r) => r.value === input.reason)) return { success: false, error: "通報の理由を選んでください。" };
  const detail = typeof input.detail === "string" ? input.detail.trim() : "";
  if (detail.length > 1000) return { success: false, error: "詳細は1000文字以内で入力してください。" };
  const messageId = input.messageId ?? null;
  if (messageId !== null && (typeof messageId !== "string" || !UUID.test(messageId))) return { success: false, error: "メッセージが見つかりません。" };
  const { pair, error } = await resolvePair(actor, kind, threadId);
  if (!pair) return { success: false, error };
  const { error: reportError } = await pair.supabase.rpc("report_chat", {
    p_reporter_role: actor.role, p_kind: kind, p_scout_id: pair.scoutId, p_worker_id: pair.workerId, p_store_id: pair.storeId,
    p_message_id: messageId, p_reason: input.reason, p_detail: detail || null,
  });
  if (reportError) return { success: false, error: /上限|自分のメッセージ|見つかりません/.test(reportError.message) ? reportError.message : "通報を送れませんでした。時間をおいてお試しください。" };
  return { success: true, error: null };
}
