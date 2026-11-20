import { Suspense } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { WorkerSearchResultRow } from "@/components/companies/WorkerSearchResultRow";
import { WorkerFilterForm } from "@/components/companies/WorkerFilterForm";
import { getWorkers } from "@/lib/actions/workers";
import { searchAvailableWorkers } from "@/lib/actions/search";
import { parseSearchParams, WorkerSearchResult } from "@/lib/types/search";
import { matchesWorker, rankWorkers, MatchingFilters } from "@/lib/utils/matching";

export const dynamic = "force-dynamic";
type Params = MatchingFilters & { work_date?: string; start_time?: string; end_time?: string };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const parsed = parseSearchParams(params.work_date, params.start_time, params.end_time);
  const validationError = parsed && !parsed.ok ? parsed.error : null;
  let results: WorkerSearchResult[];
  let error: string | null = validationError;
  if (parsed?.ok) {
    const response = await searchAvailableWorkers(parsed.params.work_date, parsed.params.start_time, parsed.params.end_time, params);
    results = response.results;
    error = response.error;
  } else if (!validationError) {
    const response = await getWorkers();
    results = rankWorkers(response.workers.filter((w) => matchesWorker(w, params)).map((worker) => ({ worker, matchingSlots: [] })));
    error = response.error;
  } else results = [];

  const availabilitySearch = parsed?.ok ? parsed.params : undefined;

  return <div className="app-page">
    <AppHeader title="ワーカーを探す" />
    <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-chip" />}><WorkerFilterForm /></Suspense>

    <main className="mt-2">
      {error && <p role="alert" className="app-error mb-3">{error}</p>}
      {!validationError && <section aria-labelledby="search_results_heading">
        <h2 id="search_results_heading" className="pb-3 text-lg font-bold text-ink">
          {results.length > 0
            ? <><span className="tabular-nums">{results.length}</span>人が見つかりました</>
            : availabilitySearch ? "空いている人はいませんでした" : "登録中のワーカーはいません"}
        </h2>
        {!availabilitySearch && results.length > 0 && <p className="-mt-2 pb-3 text-sm text-ink-soft">日付を選ぶと、その日に空いている人だけに絞れます。</p>}
        {results.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {results.map((result) => <WorkerSearchResultRow key={result.worker.id} result={result} searchParams={availabilitySearch} />)}
          </ul>
        ) : !error && (
          <p className="app-card text-sm leading-relaxed text-ink-soft">日付や時間、エリアを広げてみてください。</p>
        )}
      </section>}
    </main>
  </div>;
}
