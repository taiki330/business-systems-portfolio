import { AppHeader } from "@/components/layout/AppHeader";
import { ScoutsPageClient } from "@/components/workers/ScoutsPageClient";

export const dynamic = "force-dynamic";

export default function WorkerScoutsPage() {
  return (
    <div className="app-page">
      <AppHeader title="届いたスカウト" />
      <main>
        <ScoutsPageClient />
      </main>
    </div>
  );
}
