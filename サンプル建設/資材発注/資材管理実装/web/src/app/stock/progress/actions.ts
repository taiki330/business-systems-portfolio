"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { isSiteProgressKind } from "@/types/site-progress";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const NEW_PATH = "/stock/progress/new";

function backToNew(message: string): never {
  redirect(`${NEW_PATH}?error=${encodeURIComponent(message)}`);
}

function mapError(message: string): string {
  if (message.includes("site_not_found")) return "対象の現場が見つかりません。";
  if (message.includes("invalid_progress_kind")) return "区分の指定が不正です。";
  if (message.includes("future_date_not_allowed")) {
    return "未来の日付は記録できません。";
  }
  if (message.includes("permission_denied")) {
    return "進捗を記録する権限がありません（事務のみ）。";
  }
  return `記録に失敗しました: ${message}`;
}

/**
 * 現場進捗を記録する（事務のみ）。
 *
 * 記録と同時にその時点の資材別確定値が RPC 内で保存されるため、
 * 完了後はその記録の詳細（＝レポート）へ遷移してすぐ確認できる。
 */
export async function recordSiteProgress(formData: FormData) {
  await requireAdmin();

  const siteId = String(formData.get("site_id") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const occurredOn = String(formData.get("occurred_on") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!siteId) backToNew("現場を選択してください。");
  if (!isSiteProgressKind(kind)) backToNew("区分を選択してください。");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_site_progress", {
    p_site_id: siteId,
    p_kind: kind,
    p_occurred_on: occurredOn || null,
    p_note: note || null,
  });

  if (error) backToNew(mapError(error.message));

  revalidatePath("/stock/progress");
  revalidatePath("/stock/outstanding");
  redirect(`/stock/progress/${data as string}`);
}
