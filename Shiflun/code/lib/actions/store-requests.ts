"use server";

import { revalidatePath } from "next/cache";
import { BUSINESS_TYPES, SKILL_TAGS } from "@/lib/constants/options";
import { createServerClient } from "@/lib/supabase/server";
import { getAuth, requireStore } from "@/lib/auth/session";
import { StoreJoinRequest } from "@/lib/types/database";
import { CONSENT_VERSION, validConsentTime } from "@/lib/legal/versions";

export type SubmitJoinRequestState = {
  error?: string;
  success?: boolean;
  workerId?: string;
  warning?: string;
};

function parseSkillTags(formData: FormData): string[] {
  const raw = formData.getAll("skill_tags").map((v) => String(v).trim());
  return [...new Set(raw.filter((t) => (SKILL_TAGS as readonly string[]).includes(t)))];
}

/**
 * Phase 8-B: 店舗所属は店長の事前承認を経ず、本人の自己申告で即時に反映される
 * （弁護士・自治体から、承認制が有料職業紹介の「あっせん」に該当しうると
 * 指摘されたための対応。docs/legal/05_open-issues.md 参照）。
 * 店長は /managers/staff の一覧を見て、見覚えのない人物を通報できる（lib/actions/worker-flags.ts）。
 */
export async function submitJoinRequest(
  _prev: SubmitJoinRequestState,
  formData: FormData,
): Promise<SubmitJoinRequestState> {
  const workerName = String(formData.get("worker_name") ?? "").trim();
  const storeId = String(formData.get("store_id") ?? "").trim();
  const businessType = String(formData.get("business_type") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const skillTags = parseSkillTags(formData);

  if (!workerName) return { error: "名前を入力してください。" };
  // 店舗は自由入力を受け付けない。人材の質を担保するため、
  // Shiflunに登録済みの店舗（stores テーブル）の中からのみ選択できる。
  if (!storeId) return { error: "候補の中から店舗を選択してください。" };
  if (!(BUSINESS_TYPES as readonly string[]).includes(businessType)) {
    return { error: "業態を選択してください。" };
  }
  if (skillTags.length === 0) return { error: "ポジションを1つ以上選択してください。" };

  const experienceYearsRaw = String(formData.get("experience_years") ?? "0").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const experienceYears = Number(experienceYearsRaw);
  if (!Number.isInteger(experienceYears) || experienceYears < 0 || experienceYears > 99) {
    return { error: "経験年数は0〜99の整数で入力してください。" };
  }

  // 未成年（16〜17歳）の場合は親権者同意を必須にする（利用規約第13条）。
  const ageBracket = String(formData.get("age_bracket") ?? "").trim();
  if (ageBracket !== "adult" && ageBracket !== "minor") {
    return { error: "年齢を選択してください。" };
  }
  const isMinor = ageBracket === "minor";
  const guardianName = String(formData.get("guardian_name") ?? "").trim();
  const guardianConsent = formData.get("guardian_consent") === "on";
  if (isMinor && (!guardianName || !guardianConsent)) {
    return { error: "親権者の氏名の入力と同意へのチェックが必要です。" };
  }

  // 同意ページ（/agreement）で「同意する」を押したときの版と日時。現在の版で期限内のものだけ受け付ける。
  const termsAgreedAt = validConsentTime(formData.get("terms_version"), formData.get("terms_agreed_at"));
  if (!termsAgreedAt) {
    return { error: "利用規約とプライバシーポリシーの確認ページで、もう一度「同意する」を押してください。" };
  }

  const { supabase, user } = await getAuth();
  if (!supabase) {
    return { error: "現在は登録を保存できません。データベース接続を確認してください。" };
  }
  if (!user) return { error: "ログインの有効期限が切れました。もう一度ログインしてください。" };

  // 1つのログインで登録できるワーカーは1人（workers.user_id は一意）。
  const { data: existing, error: existingError } = await supabase.from("workers").select("id").eq("user_id", user.id).maybeSingle();
  if (existingError) return { error: existingError.message };
  if (existing) return { error: "このアカウントは登録済みです。マイページからプロフィールを確認してください。" };

  // store_id はクライアントから送られてくる値なので、実在する登録済み店舗かをサーバー側で
  // 検証する（架空の店舗名で自己申告できないようにするため）。
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, name")
    .eq("id", storeId)
    .maybeSingle();

  if (storeError) return { error: storeError.message };
  if (!store) return { error: "店舗が見つかりません。候補の中から選び直してください。" };

  // 所属と業態は本人の自己申告。既存スタッフや店長による登録・承認は不要。
  // ただし所属先の店舗自体は、店舗側が事前にShiflunへ登録した実在の店舗に限る。
  // ワーカーの登録は register_worker だけで行う（migration 026）。公開用のプロフィール（workers）と、
  // 親権者の氏名・規約の同意記録（本人専用の worker_private）を同時に作る。所属店舗の名前はDBが店舗から取る。
  const { data: workerId, error: insertError } = await supabase.rpc("register_worker", {
    p_name: workerName,
    p_store_id: store.id,
    p_business_type: businessType,
    p_skill_tags: skillTags,
    p_experience_years: experienceYears,
    p_bio: bio || null,
    p_is_minor: isMinor,
    p_guardian_name: isMinor ? guardianName : null,
    p_terms_version: CONSENT_VERSION,
    p_terms_agreed_at: termsAgreedAt,
  });

  if (insertError || !workerId) return { error: insertError?.message ?? "登録に失敗しました。" };
  const worker = { id: String(workerId) };

  // 自己申告の記録として store_join_requests にも残す（承認待ちゲートとしては使わない）。
  const { error: feedError } = await supabase.from("store_join_requests").insert({
    worker_id: worker.id,
    store_id: store.id,
    worker_name: workerName,
    store_name: store.name,
    skill_tags: skillTags,
    message: message || null,
    experience_years: experienceYears,
    bio: bio || null,
    status: "approved",
  });

  revalidatePath("/managers/staff");
  revalidatePath("/workers/join-store");
  return {
    success: true,
    workerId: worker.id,
    // 本人の登録は完了済み。履歴だけの失敗で再登録させない。
    warning: feedError
      ? "登録は完了しましたが、最近の所属登録欄への反映に失敗しました。スタッフ一覧には表示されます。再登録は不要です。"
      : undefined,
  };
}

/** ログイン中のオーナーの店舗に、最近自己申告した人の一覧（承認待ちではなく、情報共有用のフィード）。 */
export async function getJoinRequests(): Promise<{
  requests: StoreJoinRequest[];
  error: string | null;
}> {
  const supabase = await createServerClient();
  if (!supabase) {
    const { MOCK_JOIN_REQUESTS } = await import("@/lib/mocks/data");
    return { requests: MOCK_JOIN_REQUESTS, error: null };
  }
  const { supabase: storeClient, store, error: authError } = await requireStore();
  if (!storeClient) return { requests: [], error: authError };

  const { data, error } = await storeClient
    .from("store_join_requests")
    .select("*")
    .eq("store_id", store.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return { requests: [], error: error.message };
  return { requests: (data ?? []) as StoreJoinRequest[], error: null };
}
