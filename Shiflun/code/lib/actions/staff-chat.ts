"use server";

import { authorizeActor } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { validParticipant } from "@/lib/supabase/participant";
import { ChatThread, Participant, StaffMessage, ThreadMessage } from "@/lib/types/database";

type Cursor = { before?: number; after?: number };
type StaffThread = { workerId: string; workerName: string; storeId: string; storeName: string };

const UUID = /^[0-9a-f-]{36}$/i;
const CHAT_KINDS = ["message", "staff_message"];

// Worker: only their own thread with their current store. Store: only workers currently affiliated with it.
// actor はログイン中の本人の立場に限る（authorizeActor）。データベース側でも RLS が同じ範囲に制限している。
async function staffThread(actor: Participant, workerId: string) {
  const supabase = validParticipant(actor) ? await authorizeActor(actor) : null;
  if (!supabase || typeof workerId !== "string" || !UUID.test(workerId)) return { supabase: null, thread: null, error: "ログインし直してください。" };
  if (actor.role === "worker" && actor.id !== workerId) return { supabase: null, thread: null, error: "自分の会話だけを表示できます。" };
  const { data: worker, error } = await supabase.from("workers").select("id, name, current_store_id").eq("id", workerId).maybeSingle();
  if (error) return { supabase: null, thread: null, error: error.message };
  if (!worker) return { supabase: null, thread: null, error: "スタッフが見つかりません。" };
  if (!worker.current_store_id) return { supabase: null, thread: null, error: "所属店舗が登録されていません。プロフィールから所属店舗を登録してください。" };
  if (actor.role === "store" && worker.current_store_id !== actor.id) return { supabase: null, thread: null, error: "このスタッフは選択中の店舗に所属していません。" };
  const { data: store } = await supabase.from("stores").select("name").eq("id", worker.current_store_id).maybeSingle();
  const thread: StaffThread = { workerId: worker.id, workerName: worker.name, storeId: worker.current_store_id, storeName: store?.name ?? "所属店舗" };
  return { supabase, thread, error: null };
}

export async function getStaffConversation(actor: Participant, workerId: string, cursor?: Cursor): Promise<{ thread: StaffThread | null; messages: StaffMessage[]; hasMore: boolean; error: string | null }> {
  const { supabase, thread, error } = await staffThread(actor, workerId);
  if (error || !supabase || !thread) return { thread, messages: [], hasMore: false, error };
  if (cursor && Object.values(cursor).some((v) => !Number.isSafeInteger(v) || v < 0)) return { thread, messages: [], hasMore: false, error: "読み込み位置が不正です。" };
  let query = supabase.from("staff_messages").select("*").eq("worker_id", thread.workerId).eq("store_id", thread.storeId);
  if (cursor?.before !== undefined) query = query.lt("sequence", cursor.before);
  if (cursor?.after !== undefined) query = query.gt("sequence", cursor.after);
  const ascending = cursor?.after !== undefined;
  const { data, error: messageError } = await query.order("sequence", { ascending }).limit(51);
  const page = (data ?? []).slice(0, 50) as StaffMessage[];
  return { thread, messages: ascending ? page : page.reverse(), hasMore: (data?.length ?? 0) > 50, error: messageError?.message ?? null };
}

export async function sendStaffMessage(actor: Participant, workerId: string, body: string, clientMessageId: string): Promise<{ message: StaffMessage | null; error: string | null }> {
  if (typeof body !== "string" || !body.trim() || body.trim().length > 2000 || typeof clientMessageId !== "string" || !UUID.test(clientMessageId)) return { message: null, error: "メッセージは1〜2000文字で入力してください。" };
  const { supabase, thread, error } = await staffThread(actor, workerId);
  if (error || !supabase || !thread) return { message: null, error };
  const key = { worker_id: thread.workerId, store_id: thread.storeId, sender_role: actor.role, client_message_id: clientMessageId };
  const { error: saveError } = await supabase.from("staff_messages").upsert({ ...key, body: body.trim() }, { onConflict: "worker_id,store_id,sender_role,client_message_id", ignoreDuplicates: true });
  if (saveError) return { message: null, error: saveError.message };
  const { data, error: readError } = await supabase.from("staff_messages").select("*").eq("worker_id", key.worker_id).eq("store_id", key.store_id).eq("sender_role", key.sender_role).eq("client_message_id", clientMessageId).single();
  return { message: data as StaffMessage | null, error: readError?.message ?? null };
}

export async function readStaffNotifications(actor: Participant, workerId: string, messageIds: string[]): Promise<void> {
  if (typeof workerId !== "string" || !UUID.test(workerId) || !Array.isArray(messageIds) || !messageIds.length || messageIds.length > 100) return;
  const supabase = validParticipant(actor) ? await authorizeActor(actor) : null;
  if (!supabase) return;
  await supabase.from("app_notifications").update({ read_at: new Date().toISOString() }).eq(actor.role === "worker" ? "recipient_worker_id" : "recipient_store_id", actor.id).eq("staff_worker_id", workerId).in("staff_message_id", messageIds).is("read_at", null);
}

const preview = (m: ThreadMessage): ThreadMessage => ({ id: m.id, sequence: m.sequence, sender_role: m.sender_role, body: m.body, created_at: m.created_at });

/** Newest-first rows → the latest message of each conversation. */
function latestBy<T extends ThreadMessage>(messages: T[] | null, key: (m: T) => string) {
  const latest = new Map<string, ThreadMessage>();
  for (const m of messages ?? []) if (!latest.has(key(m))) latest.set(key(m), preview(m));
  return latest;
}

/** チャットタブの一覧: 所属先との会話と、承諾済みスカウトの会話。 */
export async function getChatInbox(actor: Participant): Promise<{ threads: ChatThread[]; error: string | null }> {
  if (!isSupabaseConfigured() || process.env.DEMO_MOCK === "true") return { threads: [], error: null };
  const supabase = validParticipant(actor) ? await authorizeActor(actor) : null;
  if (!supabase) return { threads: [], error: "ログインし直してください。" };
  const recipient = actor.role === "worker" ? "recipient_worker_id" : "recipient_store_id";
  const { data: unreadRows, error: unreadError } = await supabase.from("app_notifications").select("scout_id, staff_worker_id").eq(recipient, actor.id).in("kind", CHAT_KINDS).is("read_at", null).limit(1000);
  const unread = new Map<string, number>();
  for (const n of unreadRows ?? []) { const k = n.staff_worker_id ? `staff:${n.staff_worker_id}` : `scout:${n.scout_id}`; unread.set(k, (unread.get(k) ?? 0) + 1); }
  const threads: ChatThread[] = [];

  if (actor.role === "worker") {
    const { data: worker, error } = await supabase.from("workers").select("id, current_store_id").eq("id", actor.id).maybeSingle();
    if (error || !worker) return { threads: [], error: error?.message ?? "プロフィールが見つかりません。" };
    if (worker.current_store_id) {
      const [{ data: store }, { data: last }] = await Promise.all([
        supabase.from("stores").select("name").eq("id", worker.current_store_id).maybeSingle(),
        supabase.from("staff_messages").select("*").eq("worker_id", worker.id).eq("store_id", worker.current_store_id).order("sequence", { ascending: false }).limit(1),
      ]);
      threads.push({ kind: "staff", id: worker.id, title: store?.name ?? "所属店舗", subtitle: "所属先の店長 · シフトの相談", lastMessage: last?.[0] ? preview(last[0] as StaffMessage) : null, unread: unread.get(`staff:${worker.id}`) ?? 0 });
    }
  } else {
    const [{ data: staff, error }, { data: messages }] = await Promise.all([
      supabase.from("workers").select("id, name").eq("current_store_id", actor.id).order("name").limit(200),
      supabase.from("staff_messages").select("*").eq("store_id", actor.id).order("sequence", { ascending: false }).limit(500),
    ]);
    if (error) return { threads: [], error: error.message };
    const latest = latestBy(messages as StaffMessage[] | null, (m) => m.worker_id);
    for (const w of staff ?? []) threads.push({ kind: "staff", id: w.id, title: `${w.name}さん`, subtitle: "所属スタッフ", lastMessage: latest.get(w.id) ?? null, unread: unread.get(`staff:${w.id}`) ?? 0 });
  }

  const { data: scouts, error: scoutError } = await supabase.from("scout_requests").select("id, store_name, preferred_work_date, workers(name)").eq(actor.role === "worker" ? "worker_id" : "store_id", actor.id).eq("status", "accepted").order("preferred_work_date", { ascending: false }).limit(50);
  if (scouts?.length) {
    const { data: messages } = await supabase.from("scout_messages").select("*").in("scout_id", scouts.map((s) => s.id)).order("sequence", { ascending: false }).limit(500);
    const latest = latestBy(messages as (ThreadMessage & { scout_id: string })[] | null, (m) => m.scout_id);
    for (const s of scouts) {
      const workerName = (s.workers as { name?: string } | null)?.name;
      threads.push({ kind: "scout", id: s.id, title: actor.role === "worker" ? s.store_name ?? "スカウト先の店舗" : `${workerName ?? "ワーカー"}さん`, subtitle: `スカウト · ${s.preferred_work_date ?? "日付未定"} 勤務`, lastMessage: latest.get(s.id) ?? null, unread: unread.get(`scout:${s.id}`) ?? 0 });
    }
  }

  // 新しいやり取りがある会話を上に。まだ会話のないスタッフはその後ろに並べる。
  threads.sort((a, b) => (b.lastMessage ? Date.parse(b.lastMessage.created_at) : 0) - (a.lastMessage ? Date.parse(a.lastMessage.created_at) : 0));
  return { threads, error: unreadError?.message ?? scoutError?.message ?? null };
}
