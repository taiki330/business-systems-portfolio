import { AppHeader } from "@/components/layout/AppHeader";
import { ScoutDetailClient } from "@/components/workers/ScoutDetailClient";

export const dynamic = "force-dynamic";

export default async function WorkerScoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="app-page">
      <AppHeader title="勤務条件" backHref="/workers/scouts" backLabel="届いたスカウト" />
      <main>
        <ScoutDetailClient scoutId={id} />
      </main>
    </div>
  );
}
