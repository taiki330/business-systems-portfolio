"use server";

import { revalidatePath } from "next/cache";
import { BUSINESS_TYPES, SKILL_TAGS } from "@/lib/constants/options";
import { requireWorker } from "@/lib/auth/session";
import { Worker } from "@/lib/types/database";
import { normalizeWorker } from "@/lib/utils/worker";

export type ProfileState = { error?: string; success?: boolean; worker?: Worker };

export async function saveWorkerProfile(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const name = String(form.get("name") ?? "").trim();
  const businessType = String(form.get("business_type") ?? "");
  const bio = String(form.get("bio") ?? "").trim();
  const skills = String(form.get("skills") ?? "").trim();
  const experience = Number(form.get("experience_years"));
  const tags = [...new Set(form.getAll("skill_tags").map(String))];
  const areas = [...new Set(String(form.get("preferred_areas") ?? "").split(/[,、\n]/).map((s) => s.normalize("NFKC").trim()).filter(Boolean))];
  if (!name || name.length > 100) return { error: "名前を100文字以内で入力してください。" };
  if (!(BUSINESS_TYPES as readonly string[]).includes(businessType) || !tags.length || tags.some((s) => !(SKILL_TAGS as readonly string[]).includes(s))) return { error: "業態とポジションを選択してください。" };
  if (!Number.isFinite(experience) || experience < 0 || experience > 99.9 || Math.abs(experience * 10 - Math.round(experience * 10)) > 1e-8) return { error: "経験年数は0〜99.9年で入力してください。" };
  if (bio.length > 1000 || skills.length > 500 || areas.length > 10 || areas.some((a) => a.length > 60)) return { error: "自己紹介は1000文字、スキル補足は500文字、希望エリアは各60文字・10件以内で入力してください。" };
  // 編集できるのはログイン中のワーカー本人のプロフィールだけ。
  const { supabase, worker, error: authError } = await requireWorker();
  if (!supabase) return { error: authError };
  const id = worker.id;
  const { data, error } = await supabase.from("workers").update({ name, business_type: businessType, skill_tags: tags, experience_years: experience, bio: bio || null, skills: skills || null, preferred_areas: areas }).eq("id", id).select("*").single();
  if (error || !data) return { error: error?.message ?? "プロフィールが見つかりません。" };
  revalidatePath("/workers/mypage");
  revalidatePath(`/workers/${id}`);
  revalidatePath(`/companies/workers/${id}`);
  revalidatePath("/companies");
  return { success: true, worker: normalizeWorker(data) };
}
