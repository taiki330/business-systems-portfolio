import { authorizeActor } from "@/lib/auth/session";
import { Participant, ScoutRequest } from "@/lib/types/database";

export function validParticipant(actor: Participant): boolean {
  return Boolean(actor && ["worker", "store"].includes(actor.role) && typeof actor.id === "string" && /^[0-9a-f-]{36}$/i.test(actor.id));
}

/** ログイン中の本人が当事者のスカウトだけを返す（RLS でも当事者以外は読めない）。 */
export async function participantScout(actor: Participant, scoutId: string) {
  const supabase = validParticipant(actor) ? await authorizeActor(actor) : null;
  if (!supabase) return { supabase: null, scout: null, error: "ログインし直してください。" };
  const { data, error } = await supabase.from("scout_requests").select("*, workers(name)").eq("id", scoutId).eq(actor.role === "worker" ? "worker_id" : "store_id", actor.id).maybeSingle();
  return { supabase, scout: data as ScoutRequest | null, error: error?.message ?? (!data ? "対象のスカウトが見つかりません。" : null) };
}
