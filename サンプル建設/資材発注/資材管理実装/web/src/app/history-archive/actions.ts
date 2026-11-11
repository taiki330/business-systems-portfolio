"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function startStockHistoryArchive() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_stock_history_archive");
  const runId = (data as { run_id: string }[] | null)?.[0]?.run_id;
  if (error || !runId) redirect(`/history-archive?error=${encodeURIComponent(error?.message ?? "アーカイブ準備の開始に失敗しました。")}`);
  redirect(`/history-archive?run_id=${encodeURIComponent(runId)}`);
}

export async function purgeOldStockHistory(formData: FormData) {
  await requireAdmin();
  if (String(formData.get("confirmation") ?? "").trim() !== "削除") {
    redirect(`/history-archive?error=${encodeURIComponent("確認欄に「削除」と入力してください。")}`);
  }

  const runId = String(formData.get("run_id") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("purge_old_stock_history", { p_run_id: runId });
  if (error) {
    redirect(`/history-archive?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/history-archive");
  revalidatePath("/stock/ledger");
  revalidatePath("/stock/returns");
  revalidatePath("/stock/over-returns");
  redirect("/history-archive?ok=stock-purged");
}
