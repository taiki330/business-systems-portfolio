"use client";

import { useCallback } from "react";
import { useCurrentWorker } from "@/lib/hooks/use-current-worker";
import { usePollingData } from "@/lib/hooks/use-polling-data";
import { ScoutInbox } from "@/components/workers/ScoutInbox";
import { getScoutsByWorkerId } from "@/lib/actions/scouts";
import { Worker } from "@/lib/types/database";
import { AccountRequired } from "@/components/ui/AccountRequired";
import { LoadingMascot } from "@/components/ui/LoadingMascot";

export function ScoutsPageClient() {
  const { worker, ready } = useCurrentWorker();
  if (!ready) return null;
  return worker ? <WorkerScoutFeed key={worker.id} worker={worker} /> : <AccountRequired role="worker" />;
}

function WorkerScoutFeed({ worker }: { worker: Worker }) {
  const load = useCallback(() => getScoutsByWorkerId(worker.id), [worker.id]);
  const { data, error } = usePollingData(load);
  return <div className="space-y-4">
    {error && <p role="alert" className="app-error">{error}</p>}
    {!data && !error && <LoadingMascot label="スカウトを読み込み中…" />}
    {data && <ScoutInbox scouts={data.scouts} photos={data.photos} />}
  </div>;
}
