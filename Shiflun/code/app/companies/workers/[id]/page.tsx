import { AppHeader } from "@/components/layout/AppHeader";
import { CompanyVerificationBlock } from "@/components/companies/CompanyVerificationBlock";
import { ScoutLinkButton } from "@/components/companies/ScoutLinkButton";
import { WorkerProfileSummary } from "@/components/workers/WorkerProfileSummary";
import { getWorkerWithVerification } from "@/lib/actions/verifications";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CompanyWorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { worker, verification, error } = await getWorkerWithVerification(id);
  if (error || !worker) notFound();

  return (
    <div className="app-page">
      <AppHeader title="ワーカーの詳細" backHref="/companies" backLabel="ワーカーを探す" />
      <main className="flex flex-col gap-4">
        <WorkerProfileSummary worker={worker} />
        <CompanyVerificationBlock worker={worker} verification={verification} />
        <ScoutLinkButton workerId={worker.id} />
      </main>
    </div>
  );
}
