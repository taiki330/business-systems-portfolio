"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { Store } from "@/lib/types/database";
import { CONSENT_VERSION, validConsentTime } from "@/lib/legal/versions";
import { getAuth, getCurrentStore } from "@/lib/auth/session";

export type StoreSettingsState = { error?: string; success?: boolean; storeId?: string };

export async function getStores(): Promise<{ stores: Store[]; error: string | null }> {
  const supabase = await createServerClient();
  if (!supabase) {
    const { MOCK_STORES } = await import("@/lib/mocks/data");
    return { stores: MOCK_STORES, error: null };
  }
  // 退会した店舗（migration 023）と、利用停止中の店舗（migration 026）は、所属先の候補に出さない。
  const { data, error } = await supabase.from("stores").select("*, companies(name)").is("deleted_at", null).is("suspended_at", null).order("name");
  return { stores: (data ?? []) as Store[], error: error?.message ?? null };
}

/** ログイン機能が無い現状、店舗は一覧を見せず自分の端末のIDに紐づく1件だけを返す */
export async function getStore(id: string): Promise<{ store: Store | null; error: string | null }> {
  if (!id) return { store: null, error: null };
  const supabase = await createServerClient();
  if (!supabase) {
    const { MOCK_STORES } = await import("@/lib/mocks/data");
    return { store: MOCK_STORES.find((s) => s.id === id) ?? null, error: null };
  }
  const { data, error } = await supabase.from("stores").select("*, companies(name)").eq("id", id).maybeSingle();
  return { store: (data as Store) ?? null, error: error?.message ?? null };
}

export async function saveStoreSettings(_prev: StoreSettingsState, form: FormData): Promise<StoreSettingsState> {
  const name = String(form.get("name") ?? "").trim();
  const company = String(form.get("company_name") ?? "").trim();
  const area = String(form.get("area") ?? "").trim();
  const wage = Number(form.get("hourly_wage"));
  if (!area || area.length > 100 || !Number.isInteger(wage) || wage < 1 || wage > 999999) return { error: "勤務地と時給（1〜999999円の整数）を確認してください。" };
  const { supabase, user } = await getAuth();
  if (!supabase) return { error: "現在は保存できません。しばらくしてからお試しください。" };
  if (!user) return { error: "ログインの有効期限が切れました。もう一度ログインしてください。" };
  // 更新するのは、ログイン中のオーナーの店舗（画面から送られた店舗IDは使わない）。1つのログインで1店舗まで。
  const current = await getCurrentStore();
  let storeId = current?.id;
  if (current) {
    const { data, error } = await supabase.from("stores").update({ area, hourly_wage: wage }).eq("id", current.id).select("id").single();
    if (error || !data) return { error: error?.message ?? "店舗が見つかりません。" };
  } else {
    if (!name || name.length > 100 || !company || company.length > 100) return { error: "企業名と店舗名を100文字以内で入力してください。" };
    // 新規登録は、同意ページ（/agreement）で「同意する」を押したときの版と日時が必要。
    const termsAgreedAt = validConsentTime(form.get("terms_version"), form.get("terms_agreed_at"));
    if (!termsAgreedAt) return { error: "利用規約とプライバシーポリシーの確認ページで、もう一度「同意する」を押してください。" };
    const { data, error } = await supabase.rpc("create_scouting_store", { p_company_name: company, p_store_name: name, p_area: area, p_hourly_wage: wage, p_terms_version: CONSENT_VERSION, p_terms_agreed_at: termsAgreedAt });
    if (error || !data) return { error: error?.message ?? "店舗の保存に失敗しました。" };
    storeId = String(data);
  }
  revalidatePath("/managers/settings");
  revalidatePath("/companies", "layout");
  return { success: true, storeId };
}
