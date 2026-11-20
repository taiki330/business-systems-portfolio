import { AppHeader } from "@/components/layout/AppHeader";
import { ManagerVerifiedPanel } from "@/components/managers/ManagerVerifiedPanel";
import { ManagerVerifyForm } from "@/components/managers/ManagerVerifyForm";
import { ManagerWorkerSummary } from "@/components/managers/ManagerWorkerSummary";
import { getWorkerWithVerification } from "@/lib/actions/verifications";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type ManagerVerifyPageProps = {
  params: Promise<{ workerId: string }>;
};

export default async function ManagerVerifyPage({
  params,
}: ManagerVerifyPageProps) {
  const { workerId } = await params;
  const { worker, verification, error } =
    await getWorkerWithVerification(workerId);

  if (error || !worker) {
    notFound();
  }

  const isVerified = worker.verification_status === "verified";

  return (
    <div className="app-page">
      <AppHeader
        title="店長認証"
        description="バイトから送られたURLから、在籍・経験の認証を行います。"
        backHref="/managers/staff" backLabel="スタッフ"
      />

      <main className="flex flex-col gap-4">
        {!isVerified && (
          <section className="rounded-xl border border-brand-yellow bg-brand-yellow-light px-4 py-3 text-sm leading-relaxed text-brand-yellow-dark">
            以下のバイトが当店で働いていることを確認のうえ、認証情報を入力してください。
          </section>
        )}

        <ManagerWorkerSummary worker={worker} />

        {isVerified && verification ? (
          <ManagerVerifiedPanel verification={verification} />
        ) : (
          <section className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-base font-bold text-ink">
              認証情報の入力
            </h2>
            <div className="mt-4">
              <ManagerVerifyForm workerId={workerId} />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
