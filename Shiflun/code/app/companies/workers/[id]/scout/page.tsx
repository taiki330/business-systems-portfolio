import { AppHeader } from "@/components/layout/AppHeader";
import { ScoutForm } from "@/components/companies/ScoutForm";
import { ScoutWorkerSummary } from "@/components/companies/ScoutWorkerSummary";
import { getWorkerById } from "@/lib/actions/workers";
import { parseScoutPrefill } from "@/lib/types/search";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type ScoutPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    work_date?: string;
    start_time?: string;
    end_time?: string;
  }>;
};

export default async function ScoutPage({ params, searchParams }: ScoutPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const { worker, error } = await getWorkerById(id);

  if (error || !worker) {
    notFound();
  }

  const prefill = parseScoutPrefill(
    query.work_date,
    query.start_time,
    query.end_time,
  );

  return (
    <div className="app-page">
      <AppHeader
        title="スカウト送信"
        description="ワーカーへ勤務依頼のスカウトを送ります。"
        backHref={`/companies/workers/${id}`}
        backLabel="人材詳細へ"
      />

      <main className="flex flex-col gap-4">
        <ScoutWorkerSummary worker={worker} />

        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="text-base font-bold text-ink">依頼内容</h2>
          {prefill && (
            <p className="mt-2 text-sm text-ink-soft">
              検索条件が自動入力されています。必要に応じて編集してから送信してください。
            </p>
          )}
          <div className="mt-4">
            <ScoutForm workerId={worker.id} isMinor={Boolean(worker.is_minor)} defaultValues={prefill ?? undefined} />
          </div>
        </section>
      </main>
    </div>
  );
}
