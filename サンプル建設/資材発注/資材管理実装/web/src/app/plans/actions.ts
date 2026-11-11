"use server";

import { getActorId } from "@/lib/auth/get-actor-id";
import { requireAdmin } from "@/lib/auth/require-role";
import { toUserFacingMessage } from "@/lib/errors/postgres-error-message";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function mapPlanError(error: Parameters<typeof toUserFacingMessage>[0]): string {
  if (error.message.includes("quantity_must_be_integer")) {
    return "数量は整数で入力してください。";
  }
  return toUserFacingMessage(error);
}

/**
 * 現場×商品ごとの予定数量（Phase 3-7）。
 *
 * 予定数量は admin のみが登録・編集できる。
 * 超過は警告・確認対象であり、ここでの登録内容が出庫を止めることはない。
 */

export async function updateSiteProductPlan(id: string, formData: FormData) {
  await requireAdmin();

  const plannedQuantity = Number(formData.get("planned_quantity"));
  const note = String(formData.get("note") ?? "").trim();

  if (Number.isNaN(plannedQuantity) || plannedQuantity < 0) {
    redirect(
      `/plans/${id}/edit?error=${encodeURIComponent("予定数量は 0 以上の数値を入力してください。")}`,
    );
  }

  const supabase = await createClient();
  const actorId = await getActorId();

  const { error } = await supabase
    .from("site_product_plans")
    .update({
      planned_quantity: plannedQuantity,
      note: note || null,
      updated_by: actorId,
    })
    .eq("id", id);

  if (error) {
    redirect(
      `/plans/${id}/edit?error=${encodeURIComponent(mapPlanError(error))}`,
    );
  }

  revalidatePath("/plans");
  redirect("/plans?ok=updated");
}

export async function deleteSiteProductPlan(id: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_product_plans")
    .delete()
    .eq("id", id);

  if (error) {
    redirect(`/plans?error=${encodeURIComponent(toUserFacingMessage(error))}`);
  }

  revalidatePath("/plans");
  redirect("/plans?ok=deleted");
}

/**
 * 現場を1つ選び、複数商品の予定数量をまとめて登録・更新する（D-20260805-01 #7）。
 *
 * ヒアリングで「現場ごとに1件ずつ登録するのが面倒」という課題が出たため、
 * 出庫依頼画面と同じ「一覧に数量を入力していく」方式にする。
 * 入力欄は `plan_quantity_<productId>` の name で届く。
 *
 * - 数量が入力された商品だけを upsert する（空欄は現状維持）。
 * - 0 を明示的に入力した場合は 0 として登録する（予定なしを表す）。
 */
export async function saveSiteProductPlans(formData: FormData) {
  await requireAdmin();

  const siteId = String(formData.get("site_id") ?? "").trim();
  if (!siteId) {
    redirect(`/plans/new?error=${encodeURIComponent("現場を選択してください。")}`);
  }

  const rows: {
    site_id: string;
    product_id: string;
    planned_quantity: number;
    updated_by: string | null;
  }[] = [];

  const actorId = await getActorId();

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("plan_quantity_")) continue;
    const raw = String(value).trim();
    if (raw === "") continue;

    const quantity = Number(raw);
    if (!Number.isFinite(quantity) || quantity < 0) {
      redirect(
        `/plans/new?site_id=${encodeURIComponent(siteId)}&error=${encodeURIComponent(
          "予定数量は 0 以上の数値を入力してください。",
        )}`,
      );
    }

    rows.push({
      site_id: siteId,
      product_id: key.slice("plan_quantity_".length),
      planned_quantity: quantity,
      updated_by: actorId,
    });
  }

  if (rows.length === 0) {
    redirect(
      `/plans/new?site_id=${encodeURIComponent(siteId)}&error=${encodeURIComponent(
        "数量を1件以上入力してください。",
      )}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_product_plans")
    .upsert(rows, { onConflict: "site_id,product_id" });

  if (error) {
    redirect(
      `/plans/new?site_id=${encodeURIComponent(siteId)}&error=${encodeURIComponent(
        mapPlanError(error),
      )}`,
    );
  }

  revalidatePath("/plans");
  redirect("/plans?ok=created");
}

type CsvPlanImportRow = {
  product_id: string;
  quantity: number;
};

/** CSVで確認した予定数量を、選択した現場へ反映する。CSVにない既存行は削除しない。 */
export async function importSiteProductPlansFromCsv(formData: FormData) {
  await requireAdmin();

  const siteId = String(formData.get("site_id") ?? "").trim();
  const payloadRaw = String(formData.get("rows_json") ?? "").trim();
  const returnPath = `/plans/import?site_id=${encodeURIComponent(siteId)}`;

  if (!siteId || !payloadRaw) {
    redirect(`${returnPath}&error=${encodeURIComponent("現場とCSVの資材を選択してください。")}`);
  }

  let inputRows: unknown;
  try {
    inputRows = JSON.parse(payloadRaw);
  } catch {
    redirect(`${returnPath}&error=${encodeURIComponent("CSVの内容を読み取れませんでした。もう一度ファイルを選択してください。")}`);
  }

  if (!Array.isArray(inputRows) || inputRows.length === 0) {
    redirect(`${returnPath}&error=${encodeURIComponent("反映する資材を1件以上選択してください。")}`);
  }

  const quantitiesByProductId = new Map<string, number>();
  for (const input of inputRows) {
    const row = input as Partial<CsvPlanImportRow>;
    const productId = typeof row.product_id === "string" ? row.product_id.trim() : "";
    const quantity = Number(row.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 0) {
      redirect(`${returnPath}&error=${encodeURIComponent("商品または数量の指定が正しくありません。数量は0以上の整数で入力してください。")}`);
    }
    quantitiesByProductId.set(productId, (quantitiesByProductId.get(productId) ?? 0) + quantity);
  }

  const supabase = await createClient();
  const [{ data: site, error: siteError }, { data: products, error: productError }] = await Promise.all([
    supabase.from("sites").select("id").eq("id", siteId).maybeSingle(),
    supabase.from("products").select("id").in("id", Array.from(quantitiesByProductId.keys())),
  ]);

  if (siteError || !site) {
    redirect(`${returnPath}&error=${encodeURIComponent("選択した現場が見つかりません。")}`);
  }
  if (productError || (products ?? []).length !== quantitiesByProductId.size) {
    redirect(`${returnPath}&error=${encodeURIComponent("選択した商品に無効なものがあります。CSVを読み込み直して確認してください。")}`);
  }

  const actorId = await getActorId();
  const rows = Array.from(quantitiesByProductId, ([productId, quantity]) => ({
    site_id: siteId,
    product_id: productId,
    planned_quantity: quantity,
    updated_by: actorId,
  }));
  const { error } = await supabase.from("site_product_plans").upsert(rows, {
    onConflict: "site_id,product_id",
  });

  if (error) {
    redirect(`${returnPath}&error=${encodeURIComponent(mapPlanError(error))}`);
  }

  revalidatePath("/plans");
  revalidatePath("/plans/new");
  revalidatePath("/stock/sites");
  redirect("/plans?ok=csv_imported");
}
