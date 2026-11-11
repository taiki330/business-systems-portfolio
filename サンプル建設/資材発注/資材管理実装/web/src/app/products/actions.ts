"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { toUserFacingMessage } from "@/lib/errors/postgres-error-message";
import { createClient } from "@/lib/supabase/server";
import type { ProductFormData } from "@/types/product";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function parseFormData(formData: FormData): ProductFormData {
  return {
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    unit: String(formData.get("unit") ?? "").trim(),
    category_id: String(formData.get("category_id") ?? "").trim(),
    lot_size: String(formData.get("lot_size") ?? "").trim(),
    weight_kg: String(formData.get("weight_kg") ?? "").trim(),
  };
}

function validate(data: ProductFormData): string | null {
  if (!data.name) return "名称は必須です。";
  if (data.lot_size) {
    const n = Number(data.lot_size);
    if (!Number.isFinite(n) || n <= 0) {
      return "セット数は 0 より大きい数値を入力してください（空欄可）。";
    }
  }
  if (data.weight_kg) {
    const n = Number(data.weight_kg);
    if (!Number.isFinite(n) || n < 0) {
      return "重量は 0 以上の数値を入力してください（空欄可）。";
    }
  }
  return null;
}

function parseLotSize(raw: string): number | null {
  return raw ? Number(raw) : null;
}

function parseWeightKg(raw: string): number | null {
  return raw ? Number(raw) : null;
}

export async function createProduct(formData: FormData) {
  await requireAdmin();

  const data = parseFormData(formData);
  const errorMessage = validate(data);
  if (errorMessage) {
    redirect(`/products/new?error=${encodeURIComponent(errorMessage)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert({
    code: data.code || null,
    name: data.name,
    unit: data.unit || null,
    category_id: data.category_id || null,
    lot_size: parseLotSize(data.lot_size),
    weight_kg: parseWeightKg(data.weight_kg),
  });

  if (error) {
    redirect(`/products/new?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/products");
  redirect("/products");
}

export async function updateProduct(id: string, formData: FormData) {
  await requireAdmin();

  const data = parseFormData(formData);
  const errorMessage = validate(data);
  if (errorMessage) {
    redirect(`/products/${id}/edit?error=${encodeURIComponent(errorMessage)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      code: data.code || null,
      name: data.name,
      unit: data.unit || null,
      category_id: data.category_id || null,
      lot_size: parseLotSize(data.lot_size),
      weight_kg: parseWeightKg(data.weight_kg),
    })
    .eq("id", id);

  if (error) {
    redirect(`/products/${id}/edit?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/products");
  redirect("/products");
}

export async function deleteProduct(id: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);

  if (error) {
    redirect(`/products?error=${encodeURIComponent(toUserFacingMessage(error))}`);
  }

  revalidatePath("/products");
  redirect("/products");
}
