import { cache } from "react";
import { SupabaseClient, User } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { Participant, ParticipantRole, Store, Worker } from "@/lib/types/database";
import { normalizeWorker } from "@/lib/utils/worker";
import { withPhotoUrl } from "@/lib/photos";

export type AuthContext = { supabase: SupabaseClient | null; user: User | null };

/**
 * ログイン中の利用者。Cookie の内容をそのまま信じず、Supabase Auth に問い合わせて確かめる（getUser）。
 * 同じリクエストの中では1回だけ問い合わせる。
 */
export const getAuth = cache(async (): Promise<AuthContext> => {
  const supabase = await createServerClient();
  if (!supabase) return { supabase: null, user: null };
  const { data, error } = await supabase.auth.getUser();
  return { supabase, user: error ? null : data.user };
});

/** ログイン中の利用者のワーカープロフィール（未登録なら null）。 */
export const getCurrentWorker = cache(async (): Promise<Worker | null> => {
  const { supabase, user } = await getAuth();
  if (!supabase || !user) return null;
  const { data } = await supabase.from("workers").select("*").eq("user_id", user.id).maybeSingle();
  if (!data) return null;
  // 規約の同意記録は本人専用の worker_private にある（migration 026）。読めないとき（未適用のDB）は undefined のままにして、再同意を求めない。
  const { data: priv, error } = await supabase.from("worker_private").select("terms_version, terms_agreed_at").eq("worker_id", data.id).maybeSingle();
  const worker = { ...normalizeWorker(data), ...(error ? {} : { terms_version: priv?.terms_version ?? null, terms_agreed_at: priv?.terms_agreed_at ?? null }) };
  return (await withPhotoUrl(supabase, [worker]))[0];
});

/** ログイン中の利用者がオーナーの店舗（未登録なら null）。1つのログインで1店舗まで（migration 022）。 */
export const getCurrentStore = cache(async (): Promise<Store | null> => {
  const { supabase, user } = await getAuth();
  if (!supabase || !user) return null;
  const { data } = await supabase.from("stores").select("*, companies(name)").eq("owner_user_id", user.id).maybeSingle();
  return data ? (await withPhotoUrl(supabase, [data as Store]))[0] : null;
});

/** ログイン中の利用者の、指定した立場（ワーカー / 店舗）での ID。 */
export async function currentActorId(role: ParticipantRole): Promise<string | null> {
  return role === "worker" ? (await getCurrentWorker())?.id ?? null : (await getCurrentStore())?.id ?? null;
}

/**
 * 画面から渡された立場（actor）が、ログイン中の利用者本人のものかを確かめる。
 * 本人のものなら Supabase クライアントを返す（データベース側でも RLS が同じ範囲に制限している）。
 */
export async function authorizeActor(actor: Participant): Promise<SupabaseClient | null> {
  if (!actor || (actor.role !== "worker" && actor.role !== "store") || typeof actor.id !== "string") return null;
  const { supabase } = await getAuth();
  if (!supabase) return null;
  return (await currentActorId(actor.role)) === actor.id ? supabase : null;
}

const SIGN_IN_AGAIN = "ログインの有効期限が切れました。もう一度ログインしてください。";

/**
 * ワーカー本人の操作に使う。ログイン中のワーカーと、その権限の Supabase クライアントを返す。
 * 画面から送られた worker_id は使わない（本人以外のIDを送られても、本人の操作として扱う）。
 */
export async function requireWorker(): Promise<{ supabase: SupabaseClient; worker: Worker; error: null } | { supabase: null; worker: null; error: string }> {
  const { supabase, user } = await getAuth();
  if (!supabase) return { supabase: null, worker: null, error: "現在は保存できません。データベースの設定を確認してください。" };
  if (!user) return { supabase: null, worker: null, error: SIGN_IN_AGAIN };
  const worker = await getCurrentWorker();
  if (!worker) return { supabase: null, worker: null, error: "先に、働いている店舗の登録（プロフィール登録）をしてください。" };
  return { supabase, worker, error: null };
}

/** 店舗の操作に使う。ログイン中のオーナーの店舗と、その権限の Supabase クライアントを返す。 */
export async function requireStore(): Promise<{ supabase: SupabaseClient; store: Store; error: null } | { supabase: null; store: null; error: string }> {
  const { supabase, user } = await getAuth();
  if (!supabase) return { supabase: null, store: null, error: "現在は保存できません。データベースの設定を確認してください。" };
  if (!user) return { supabase: null, store: null, error: SIGN_IN_AGAIN };
  const store = await getCurrentStore();
  if (!store) return { supabase: null, store: null, error: "先に、店舗の登録（店舗・時給設定）をしてください。" };
  return { supabase, store, error: null };
}
