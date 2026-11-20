"use server";

import { authorizeActor } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { validParticipant } from "@/lib/supabase/participant";
import { AppNotification, Participant } from "@/lib/types/database";

/** ログイン中の本人の立場なら Supabase クライアントを返す。モック表示（DB未接続）のときは null。 */
async function client(actor: Participant) {
  if (!isSupabaseConfigured() || process.env.DEMO_MOCK === "true") return { supabase: null, error: null };
  const supabase = validParticipant(actor) ? await authorizeActor(actor) : null;
  return { supabase, error: supabase ? null : "ログインし直してください。" };
}

export async function getNotifications(actor: Participant): Promise<{ notifications: AppNotification[]; unread: number; error: string | null }> {
  const { supabase, error } = await client(actor);
  if (!supabase) return { notifications: [], unread: 0, error };
  const field = actor.role === "worker" ? "recipient_worker_id" : "recipient_store_id";
  const [list, count] = await Promise.all([
    supabase.from("app_notifications").select("*").eq(field, actor.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("app_notifications").select("id", { count: "exact", head: true }).eq(field, actor.id).is("read_at", null),
  ]);
  return { notifications: (list.data ?? []) as AppNotification[], unread: count.count ?? 0, error: list.error?.message ?? count.error?.message ?? null };
}

export async function readNotifications(actor: Participant, ids: string[]): Promise<{ error: string | null }> {
  const { supabase } = await client(actor);
  if (!supabase || !Array.isArray(ids) || ids.length > 100) return { error: "通知を更新できませんでした。" };
  if (!ids.length) return { error: null };
  const { error } = await supabase.from("app_notifications").update({ read_at: new Date().toISOString() }).eq(actor.role === "worker" ? "recipient_worker_id" : "recipient_store_id", actor.id).in("id", ids).is("read_at", null);
  return { error: error?.message ?? null };
}

export async function readChatNotifications(actor: Participant, scoutId: string, messageIds: string[]): Promise<void> {
  if (!Array.isArray(messageIds) || !messageIds.length || messageIds.length > 100) return;
  const { supabase } = await client(actor);
  if (!supabase) return;
  await supabase.from("app_notifications").update({ read_at: new Date().toISOString() }).eq(actor.role === "worker" ? "recipient_worker_id" : "recipient_store_id", actor.id).eq("scout_id", scoutId).in("message_id", messageIds).is("read_at", null);
}

/** 下のバーのチャットバッジ用: 未読のメッセージ数。 */
export async function getChatUnreadCount(actor: Participant): Promise<{ unread: number; error: string | null }> {
  const { supabase } = await client(actor);
  if (!supabase) return { unread: 0, error: null };
  const { count, error } = await supabase.from("app_notifications").select("id", { count: "exact", head: true }).eq(actor.role === "worker" ? "recipient_worker_id" : "recipient_store_id", actor.id).in("kind", ["message", "staff_message"]).is("read_at", null);
  return { unread: count ?? 0, error: error?.message ?? null };
}
