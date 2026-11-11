import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/components/auth/SetPasswordForm";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ error?: string }>;

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans">
      <main className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">
          パスワードを設定
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          招待を受けたアカウントの初回パスワードを設定してください。
        </p>

        <div className="mt-8">
          <SetPasswordForm
            errorMessage={error ? decodeURIComponent(error) : undefined}
          />
        </div>
      </main>
    </div>
  );
}
