import { AppHeader } from "@/components/layout/AppHeader";
import { ManagerVerifiedPanel } from "@/components/managers/ManagerVerifiedPanel";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { ManagerVerificationUrlBox } from "@/components/workers/ManagerVerificationUrlBox";
import { WorkerAvailabilitySection } from "@/components/workers/WorkerAvailabilitySection";
import { WorkerProfileSummary } from "@/components/workers/WorkerProfileSummary";
import { getAvailabilitySlotsByWorkerId } from "@/lib/actions/availability";
import { getWorkerWithVerification } from "@/lib/actions/verifications";
import {
  buildManagerShiftsUrl,
  buildManagerVerifyUrl,
  getSiteOrigin,
} from "@/lib/utils/site-url";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type WorkerProfilePageProps = {
  params: Promise<{ id: string }>;
};

export default async function WorkerProfilePage({
  params,
}: WorkerProfilePageProps) {
  const { id } = await params;
  const { worker, verification, error } = await getWorkerWithVerification(id);
  const { slots, error: slotsError } = await getAvailabilitySlotsByWorkerId(id);

  if (error || !worker) {
    notFound();
  }

  const origin = await getSiteOrigin();
  const verifyUrl = buildManagerVerifyUrl(origin, worker.id);
  const managerShiftsUrl = buildManagerShiftsUrl(origin, worker.id);
  const isVerified = worker.verification_status === "verified";

  return (
    <div className="app-page">
      <AppHeader
        title="あなたのプロフィール"
        description="登録内容の確認と、店長認証URLの共有ができます。"
        backHref="/" backLabel="トップ"
      />

      <main className="flex flex-col gap-4">
        {!isVerified && (
          <section className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink-soft">
            現在は<strong className="font-semibold text-ink">未認証</strong>
            です。店長に下のURLを送って認証を受けてください。
          </section>
        )}

        <WorkerProfileSummary worker={worker} />

        {!isVerified ? (
          <ManagerVerificationUrlBox verifyUrl={verifyUrl} />
        ) : verification ? (
          <ManagerVerifiedPanel
            verification={verification}
            title="店長認証が完了しています"
            description="企業の人材一覧で「店長認証済み」バッジが表示されます。"
          />
        ) : (
          <section className="rounded-xl border border-brand-blue bg-brand-blue-light p-5 text-sm leading-relaxed text-brand-blue">
            店長認証が完了しています。
          </section>
        )}

        <WorkerAvailabilitySection
          workerId={worker.id}
          slots={slots}
          managerShiftsUrl={managerShiftsUrl}
        />

        {slotsError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {slotsError}
          </div>
        )}

        <PrimaryButton href="/companies" variant="secondary">
          人材一覧を見る
        </PrimaryButton>
      </main>
    </div>
  );
}
