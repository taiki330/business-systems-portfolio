"use server";

import { Participant, ChatMessage, ScoutRequest } from "@/lib/types/database";
import { participantScout } from "@/lib/supabase/participant";

export async function getConversation(actor: Participant, scoutId: string, cursor?: { before?: number; after?: number }): Promise<{ scout: ScoutRequest | null; messages: ChatMessage[]; hasMore: boolean; error: string | null }> {
  const { supabase, scout, error } = await participantScout(actor, scoutId);
  if (error || !supabase || !scout) return { scout, messages: [], hasMore: false, error };
  if (scout.status !== "accepted" || !scout.store_id) return { scout, messages: [], hasMore: false, error: "チャットはスカウトを承諾すると開きます。" };
  if (cursor && Object.values(cursor).some((v) => !Number.isSafeInteger(v) || v < 0)) return { scout, messages: [], hasMore: false, error: "読み込み位置が不正です。" };
  let query = supabase.from("scout_messages").select("*").eq("scout_id", scoutId);
  if (cursor?.before !== undefined) query = query.lt("sequence", cursor.before);
  if (cursor?.after !== undefined) query = query.gt("sequence", cursor.after);
  const ascending = cursor?.after !== undefined;
  const { data, error: messageError } = await query.order("sequence", { ascending }).limit(51);
  const page = (data ?? []).slice(0, 50) as ChatMessage[];
  return { scout, messages: ascending ? page : page.reverse(), hasMore: (data?.length ?? 0) > 50, error: messageError?.message ?? null };
}

export async function sendChatMessage(actor: Participant, scoutId: string, body: string, clientMessageId: string): Promise<{ message: ChatMessage | null; error: string | null }> {
  if (typeof body !== "string" || !body.trim() || body.trim().length > 2000 || !/^[0-9a-f-]{36}$/i.test(clientMessageId)) return { message: null, error: "メッセージは1〜2000文字で入力してください。" };
  const { supabase, scout, error } = await participantScout(actor, scoutId);
  if (error || !supabase || !scout) return { message: null, error };
  if (scout.status !== "accepted" || !scout.store_id) return { message: null, error: "チャットはスカウトを承諾すると開きます。" };
  const { error: saveError } = await supabase.from("scout_messages").upsert({ scout_id: scoutId, sender_role: actor.role, sender_id: actor.id, body: body.trim(), client_message_id: clientMessageId }, { onConflict: "scout_id,sender_role,client_message_id", ignoreDuplicates: true });
  if (saveError) return { message: null, error: saveError.message };
  const { data, error: readError } = await supabase.from("scout_messages").select("*").eq("scout_id", scoutId).eq("sender_role", actor.role).eq("sender_id", actor.id).eq("client_message_id", clientMessageId).single();
  return { message: data as ChatMessage | null, error: readError?.message ?? null };
}
