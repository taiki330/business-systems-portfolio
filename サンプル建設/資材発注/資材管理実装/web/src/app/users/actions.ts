"use server";

import { requireAdmin } from "@/lib/auth/require-role";
import { toUserFacingMessage } from "@/lib/errors/postgres-error-message";
import { resolveAuthUserByEmail } from "@/lib/users/fetch-users";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppUserRole } from "@/types/app-user";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

function parseRole(raw: string): AppUserRole | null {
  // 新規割り当て可能なロールは admin / center / vendor（internal は legacy のため選択不可）
  if (raw === "admin" || raw === "center" || raw === "vendor") return raw;
  return null;
}

/** 招待メールの redirectTo に使うオリジンを、受信リクエストのヘッダから組み立てる。 */
async function resolveOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function mapUpdateAppUserError(message: string): string {
  if (message.includes("app_user_not_found")) {
    return "対象のユーザーが見つかりません。";
  }
  if (message.includes("permission_denied")) {
    return "権限がありません。";
  }
  if (message.includes("invalid_role")) {
    return "役割の指定が不正です。";
  }
  if (message.includes("site_required")) {
    return "現場アカウントには現場の選択が必要です。";
  }
  if (message.includes("site_not_found")) {
    return "選択した現場が見つかりません。";
  }
  if (message.includes("site_already_has_account")) {
    return "選択した現場には、すでに現場アカウントが発行されています。";
  }
  if (message.includes("center_not_found")) {
    return "選択した地域センターが見つかりません。";
  }
  return message;
}

export async function createAppUser(formData: FormData) {
  await requireAdmin();

  const email = String(formData.get("email") ?? "").trim();
  const role = parseRole(String(formData.get("role") ?? ""));
  const displayName = String(formData.get("display_name") ?? "").trim();
  const siteIds = Array.from(new Set(formData.getAll("site_ids").map(String).map((v) => v.trim()).filter(Boolean)));
  const centerId = String(formData.get("center_id") ?? "").trim();
  const issueMethod = String(formData.get("issue_method") ?? "");

  if (!email) {
    redirect(`/users/new?error=${encodeURIComponent("メールアドレスを入力してください。")}`);
  }
  if (!role) {
    redirect(`/users/new?error=${encodeURIComponent("役割を選択してください。")}`);
  }
  if (role === "vendor" && siteIds.length === 0) {
    redirect(
      `/users/new?error=${encodeURIComponent(
        "現場アカウントには現場を1つ以上選択してください。",
      )}`,
    );
  }
  if (issueMethod !== "invite" && issueMethod !== "link") {
    redirect(`/users/new?error=${encodeURIComponent("発行方法を選択してください。")}`);
  }

  const supabase = await createClient();
  if (role === "vendor") {
    const [{ data: selectedSites, error: siteError }, { data: users, error: usersError }] =
      await Promise.all([
        supabase.from("sites").select("id, name").in("id", siteIds),
        supabase.rpc("list_app_users"),
      ]);

    if (siteError || (selectedSites ?? []).length !== siteIds.length) {
      redirect(
        `/users/new?error=${encodeURIComponent("選択した現場が見つかりません。")}`,
      );
    }
    if (usersError) {
      redirect(
        `/users/new?error=${encodeURIComponent("現場アカウントの重複確認に失敗しました。")}`,
      );
    }
    if (
      (users ?? []).some(
        (user: { role?: string; site_ids?: string[] | null; site_id?: string | null }) =>
          user.role === "vendor" &&
          (user.site_ids ?? (user.site_id ? [user.site_id] : [])).some((id) => siteIds.includes(id)),
      )
    ) {
      redirect(
        `/users/new?error=${encodeURIComponent(
          "選択した現場には、すでに現場アカウントが発行されています。",
        )}`,
      );
    }
  }

  const admin = createAdminClient();
  let userId: string;
  let generatedLink: string | null = null;

  if (issueMethod === "link") {
    // メールは送らず、招待リンクだけをその場で生成する(email 送信 API を
    // 呼ばないため、Supabase のメール送信レート制限を消費しない)。
    // action_link は Supabase 自身の /verify を経由する形式なので使わず、
    // hashed_token + redirect_to から自前の /auth/callback 向けリンクを組み立てる。
    const origin = await resolveOrigin();
    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo: `${origin}/auth/callback` },
      });

    if (linkError) {
      const alreadyRegistered =
        linkError.code === "email_exists" ||
        /already registered|already exists/i.test(linkError.message);

      if (!alreadyRegistered) {
        redirect(
          `/users/new?error=${encodeURIComponent(
            `招待リンクの発行に失敗しました: ${linkError.message}`,
          )}`,
        );
      }

      const { user, error: resolveError } = await resolveAuthUserByEmail(email);
      if (resolveError) {
        redirect(`/users/new?error=${encodeURIComponent(resolveError.message)}`);
      }
      if (!user) {
        redirect(
          `/users/new?error=${encodeURIComponent(
            "既に発行済みのメールアドレスですが、ユーザー情報を取得できませんでした。",
          )}`,
        );
      }
      userId = user.id;
    } else {
      userId = linkData.user.id;
      generatedLink = `${linkData.properties.redirect_to}?token_hash=${linkData.properties.hashed_token}&type=invite`;
    }
  } else {
    // まず新規 Auth アカウントの発行(招待メール送信)を試みる。
    // 既に同じメールアドレスで発行済みの場合は email_exists で失敗するので、
    // その場合のみ既存ユーザーの検索・紐付けにフォールバックする。
    const origin = await resolveOrigin();
    const { data: inviteData, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/auth/callback`,
      });

    if (inviteError) {
      const alreadyRegistered =
        inviteError.code === "email_exists" ||
        /already registered|already exists/i.test(inviteError.message);

      if (!alreadyRegistered) {
        redirect(
          `/users/new?error=${encodeURIComponent(
            `招待メールの送信に失敗しました: ${inviteError.message}`,
          )}`,
        );
      }

      const { user, error: resolveError } = await resolveAuthUserByEmail(email);
      if (resolveError) {
        redirect(`/users/new?error=${encodeURIComponent(resolveError.message)}`);
      }
      if (!user) {
        redirect(
          `/users/new?error=${encodeURIComponent(
            "既に発行済みのメールアドレスですが、ユーザー情報を取得できませんでした。",
          )}`,
        );
      }
      userId = user.id;
    } else {
      userId = inviteData.user.id;
    }
  }

  const { error } = await supabase.rpc("configure_app_user_by_admin", {
    p_id: userId,
    p_role: role,
    p_display_name: displayName || null,
    p_site_ids: role === "vendor" ? siteIds : [],
    // 未選択（空文字）なら null を渡す。DB 側（configure_app_user_by_admin）が
    // role=center かつ p_center_id が null のとき関西へフォールバックする。P4
    p_center_id: role === "center" ? centerId || null : null,
  });

  if (error) {
    const message = error.message.includes("app_users_one_vendor_per_site_idx")
      ? "選択した現場には、すでに現場アカウントが発行されています。"
      : toUserFacingMessage(error);
    redirect(`/users/new?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/users");

  if (generatedLink) {
    redirect(
      `/users?ok=link_generated&link=${encodeURIComponent(generatedLink)}`,
    );
  }

  redirect("/users?ok=created");
}

export async function updateAppUser(id: string, formData: FormData) {
  const currentUser = await requireAdmin();

  if (!id) {
    redirect(`/users?error=${encodeURIComponent("ユーザー ID が不正です。")}`);
  }

  const displayName = String(formData.get("display_name") ?? "").trim();
  const role = parseRole(String(formData.get("role") ?? ""));
  const siteIds = Array.from(new Set(formData.getAll("site_ids").map(String).map((v) => v.trim()).filter(Boolean)));
  const centerId = String(formData.get("center_id") ?? "").trim();

  const isSelf = id === currentUser.id;

  if (isSelf) {
    // 自分自身の role / site_id は Server Action 層でも変更を許可しない（三層防御の第2層）。
    // DB 層のトリガー（prevent_self_role_change）が最終防衛だが、ここでも早期に弾く。
    const supabase = await createClient();
    const { error, count } = await supabase
      .from("app_users")
      .update({ display_name: displayName || null }, { count: "exact" })
      .eq("id", id);

    if (error) {
      redirect(`/users/${id}/edit?error=${encodeURIComponent(toUserFacingMessage(error))}`);
    }
    if (!count) {
      redirect(
        `/users/${id}/edit?error=${encodeURIComponent(
          "更新できませんでした。対象ユーザーが見つからないか、権限がありません。",
        )}`,
      );
    }

    revalidatePath("/users");
    redirect("/users?ok=updated");
  }

  if (!role) {
    redirect(`/users/${id}/edit?error=${encodeURIComponent("役割を選択してください。")}`);
  }
  if (role === "vendor" && siteIds.length === 0) {
    redirect(
      `/users/${id}/edit?error=${encodeURIComponent(
        "現場アカウントには現場を1つ以上選択してください。",
      )}`,
    );
  }

  // 他人ユーザーの更新は、クライアント直接 UPDATE ではなく SECURITY DEFINER 関数経由にする。
  // current_app_role() が app_users 自身を参照する自己参照 RLS のため、
  // 他人の行を対象にした直接 UPDATE は 0 件になる不具合が確認された（実機の生SQL検証で確認済み）。
  const supabase = await createClient();
  const { error } = await supabase.rpc("configure_app_user_by_admin", {
    p_id: id,
    p_display_name: displayName || null,
    p_role: role,
    p_site_ids: role === "vendor" ? siteIds : [],
    p_center_id: role === "center" ? centerId || null : null,
  });

  if (error) {
    redirect(
      `/users/${id}/edit?error=${encodeURIComponent(mapUpdateAppUserError(error.message))}`,
    );
  }

  revalidatePath("/users");
  redirect("/users?ok=updated");
}

/**
 * Supabase Auth と app_users のアカウントを完全に削除する。
 * app_users は auth.users を親に ON DELETE CASCADE で紐付いているため、
 * 現場紐付けも同時に失効する。業務履歴の操作者情報は FK の設定に従い保持する。
 */
export async function deleteAppUser(id: string) {
  const currentUser = await requireAdmin();

  if (!id) {
    redirect(`/users?error=${encodeURIComponent("アカウントIDが不正です。")}`);
  }
  if (id === currentUser.id) {
    redirect(`/users?error=${encodeURIComponent("自分自身のアカウントは削除できません。別の事務アカウントで操作してください。")}`);
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    redirect(`/users?error=${encodeURIComponent(`アカウントを削除できませんでした: ${error.message}`)}`);
  }

  revalidatePath("/users");
  redirect("/users?ok=deleted");
}
