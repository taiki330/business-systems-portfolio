import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { sanitizeNext } from "@/lib/auth/sanitize-next";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ error?: string; next?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error, next: rawNext } = await searchParams;
  const safeNext = sanitizeNext(rawNext ?? null);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(safeNext ?? "/");
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans">
      <main className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">ログイン</h1>
        <p className="mt-2 text-sm text-zinc-600">
          資材管理システム（社内ユーザー向け）
        </p>

        <div className="mt-8">
          <LoginForm
            errorMessage={error ? decodeURIComponent(error) : undefined}
            next={safeNext ?? rawNext ?? null}
          />
        </div>

        <p className="mt-6 text-xs text-zinc-500">
          アカウントの発行は管理者にお問い合わせください。
        </p>
      </main>
    </div>
  );
}
