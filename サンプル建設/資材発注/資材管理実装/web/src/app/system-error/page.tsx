import Link from "next/link";

export default function SystemErrorPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center px-6 py-12">
      <section className="w-full rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-xl font-semibold text-zinc-900">一時的にデータを確認できません</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-700">
          アカウント情報の読み込みに失敗しました。権限がないという意味ではありません。少し時間をおいて再読み込みしてください。
        </p>
        <Link href="/" className="mt-5 inline-flex rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
          再読み込み
        </Link>
      </section>
    </main>
  );
}
