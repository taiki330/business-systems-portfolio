"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function revalidateSiteProductPaths(siteId: string) {
  revalidatePath(`/sites/${siteId}/products`);
}

function parseDisplayOrder(raw: string): {
  value: number | null;
  error: string | null;
} {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, error: null };
  const n = Number(trimmed);
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    return { value: null, error: "並び順は数値で入力してください。" };
  }
  if (!Number.isInteger(n)) {
    return { value: null, error: "並び順は整数で入力してください。" };
  }
  return { value: n, error: null };
}

function parsePartialLotOverride(value: FormDataEntryValue | null): boolean | null {
  if (value === null || value === "inherit") return null;
  if (value === "allow") return true;
  if (value === "disallow") return false;
  return null;
}

/**
 * site_products へ 1 行追加。
 * docs/11 §3 / §6-1。補助マスタなので軽い検証のみ。
 * UNIQUE(site_id, product_id) は DB 側で担保（006_site_products.sql）。
 */
export async function createSiteProduct(siteId: string, formData: FormData) {
  await requireAdmin();

  if (!siteId) {
    redirect(`/sites?error=${encodeURIComponent("現場 ID が不正です。")}`);
  }

  const productId = String(formData.get("product_id") ?? "").trim();
  const orderRaw = String(formData.get("display_order") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const allowPartialLotOverride = parsePartialLotOverride(
    formData.get("allow_partial_lot_override"),
  );

  if (!productId) {
    redirect(
      `/sites/${siteId}/products?error=${encodeURIComponent(
        "商品を選択してください。",
      )}`,
    );
  }

  const parsed = parseDisplayOrder(orderRaw);
  if (parsed.error) {
    redirect(
      `/sites/${siteId}/products?error=${encodeURIComponent(parsed.error)}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("site_products").insert({
    site_id: siteId,
    product_id: productId,
    display_order: parsed.value,
    note: note || null,
    allow_partial_lot_override: allowPartialLotOverride,
  });

  if (error) {
    redirect(
      `/sites/${siteId}/products?error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidateSiteProductPaths(siteId);
  redirect(`/sites/${siteId}/products?ok=created`);
}

/**
 * 並び順とメモを 1 行ずつ更新。
 * 商品差し替えは行わない（補助マスタとしては削除→再追加で十分）。
 */
export async function updateSiteProduct(
  siteId: string,
  id: string,
  formData: FormData,
) {
  await requireAdmin();

  if (!siteId || !id) {
    redirect(`/sites?error=${encodeURIComponent("ID が不正です。")}`);
  }

  const orderRaw = String(formData.get("display_order") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const allowPartialLotOverride = parsePartialLotOverride(
    formData.get("allow_partial_lot_override"),
  );

  const parsed = parseDisplayOrder(orderRaw);
  if (parsed.error) {
    redirect(
      `/sites/${siteId}/products?error=${encodeURIComponent(parsed.error)}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_products")
    .update({
      display_order: parsed.value,
      note: note || null,
      allow_partial_lot_override: allowPartialLotOverride,
    })
    .eq("id", id)
    .eq("site_id", siteId);

  if (error) {
    redirect(
      `/sites/${siteId}/products?error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidateSiteProductPaths(siteId);
  redirect(`/sites/${siteId}/products?ok=updated`);
}

export async function deleteSiteProduct(siteId: string, id: string) {
  await requireAdmin();

  if (!siteId || !id) {
    redirect(`/sites?error=${encodeURIComponent("ID が不正です。")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_products")
    .delete()
    .eq("id", id)
    .eq("site_id", siteId);

  if (error) {
    redirect(
      `/sites/${siteId}/products?error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidateSiteProductPaths(siteId);
  redirect(`/sites/${siteId}/products?ok=deleted`);
}
