"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("password_confirm") ?? "");

  if (password.length < 8) {
    redirect(
      `/auth/set-password?error=${encodeURIComponent(
        "パスワードは8文字以上で入力してください。",
      )}`,
    );
  }
  if (password !== passwordConfirm) {
    redirect(
      `/auth/set-password?error=${encodeURIComponent(
        "確認用パスワードが一致しません。",
      )}`,
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(
      `/auth/set-password?error=${encodeURIComponent(
        "パスワードの設定に失敗しました。もう一度お試しください。",
      )}`,
    );
  }

  redirect("/");
}
