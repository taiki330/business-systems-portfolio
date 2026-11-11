import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

/**
 * 招待メール等の Supabase 認証リンク(token_hash + type)を受け取り、セッションに交換する。
 * inviteUserByEmail は PKCE 非対応のため code ではなく token_hash 方式を使う。
 * Supabase ダッシュボード側で「Invite user」メールテンプレートのリンクを
 * `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite` に変更しておく必要がある
 * (デフォルトテンプレートのままだと Supabase 側の /verify を経由し、この画面には届かない)。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}/auth/set-password`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      "招待リンクが無効か、有効期限が切れています。管理者に再発行を依頼してください。",
    )}`,
  );
}
