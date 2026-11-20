"use server";

import { authorizeActor } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { validParticipant } from "@/lib/supabase/participant";
import { Participant } from "@/lib/types/database";
import { CONSENT_VERSION, validConsentTime } from "@/lib/legal/versions";

/**
 * 登録済みのアカウントが同意ページで「同意する」を押したときに、同意した版と日時を記録する。
 * 規約の改定後や、同意機能の導入前に登録したアカウントの再同意に使う。
 */
export async function recordConsent(actor: Participant, version: string, agreedAt: string): Promise<{ error: string | null }> {
  const time = validConsentTime(version, agreedAt);
  if (!time) return { error: "同意の記録が古いか、規約が更新されています。もう一度内容を確認してください。" };
  if (!isSupabaseConfigured() || process.env.DEMO_MOCK === "true") return { error: null };
  const supabase = validParticipant(actor) ? await authorizeActor(actor) : null;
  if (!supabase) return { error: "ログインし直してください。" };
  // ワーカーの同意記録は本人専用の worker_private、店舗は stores に保存する（migration 026）。
  const worker = actor.role === "worker";
  const { data, error } = await supabase.from(worker ? "worker_private" : "stores")
    .update({ terms_version: CONSENT_VERSION, terms_agreed_at: time }).eq(worker ? "worker_id" : "id", actor.id).select(worker ? "worker_id" : "id").maybeSingle();
  if (error) return { error: error.message };
  return { error: data ? null : "アカウントが見つかりません。" };
}
