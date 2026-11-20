import { AppHeader } from "@/components/layout/AppHeader";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { getWorkerById } from "@/lib/actions/workers";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type ScoutSuccessPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ScoutSuccessPage({
  params,
}: ScoutSuccessPageProps) {
  const { id } = await params;
  const { worker, error } = await getWorkerById(id);

  if (error || !worker) {
    notFound();
  }

  return (
    <div className="app-page">
      <AppHeader
        title="送信完了"
        description="スカウトの送信が完了しました。"
        backHref={`/companies/workers/${id}`}
        backLabel="人材詳細へ"
      />

      <main className="flex flex-col gap-4">
        <section className="rounded-xl border border-brand-blue bg-brand-blue-light p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-blue-light text-3xl text-brand-blue">
            ✓
          </div>
          <h2 className="mt-5 text-xl font-bold text-ink">
            スカウトを送信しました
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            {worker.name} さんへスカウトが送信されました。
          </p>
        </section>

        <PrimaryButton href="/managers/scouts">
          送ったスカウトを確認する
        </PrimaryButton>
        <PrimaryButton href="/companies" variant="secondary">
          人材一覧へ戻る
        </PrimaryButton>
      </main>
    </div>
  );
}
