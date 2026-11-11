"use server";

import { sanitizeNext } from "@/lib/auth/sanitize-next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

function loginRedirectWithNext(rawNext: string | null, message: string): never {
  const params = new URLSearchParams();
  params.set("error", message);
  if (rawNext) params.set("next", rawNext);
  redirect(`/login?${params.toString()}`);
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const rawNext = formData.get("next");
  const nextRaw =
    typeof rawNext === "string" && rawNext.length > 0 ? rawNext : null;

  if (!email || !password) {
    loginRedirectWithNext(
      nextRaw,
      "メールアドレスとパスワードを入力してください。",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    loginRedirectWithNext(
      nextRaw,
      "ログインに失敗しました。メールアドレスとパスワードを確認してください。",
    );
  }

  const safeNext = sanitizeNext(nextRaw);
  redirect(safeNext ?? "/");
}
