import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { ReportWorkerButton } from "@/components/managers/ReportWorkerButton";
import { SelfReportFeedItem } from "@/components/managers/SelfReportFeedItem";
import { WorkerFlagCard } from "@/components/managers/WorkerFlagCard";
import { VerificationBadge } from "@/components/workers/VerificationBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getMyStaff } from "@/lib/actions/workers";
import { getJoinRequests } from "@/lib/actions/store-requests";
import { getOpenWorkerFlags } from "@/lib/actions/worker-flags";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const [{ workers }, { requests }, { flags }] = await Promise.all([
    getMyStaff(),
    getJoinRequests(),
    getOpenWorkerFlags(),
  ]);

  const recentSelfReports = requests.slice(0, 5);

  return (
    <div className="app-page">
      <AppHeader
        title="スタッフ管理"
        description="店舗所属は自己申告制です。見覚えのない人がいたら通報してください。"
        backHref="/managers/more" backLabel="その他"
      />

      <main className="flex flex-col gap-6">
        {/* クイックリンク */}
        <section className="flex flex-wrap gap-2">
          <Link
            href="/managers/checkin-qr"
            className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink-soft hover:bg-paper"
          >
            出勤QRコード発行
          </Link>
          <Link
            href="/managers/payouts"
            className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink-soft hover:bg-paper"
          >
            支払い状況
          </Link>
        </section>

        {/* 通報（対応が必要） */}
        {flags.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-bold text-rose-700">
              通報 <span className="ml-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs">{flags.length}</span>
            </h2>
            <div className="flex flex-col gap-3">
              {flags.map((flag) => (
                <WorkerFlagCard key={flag.id} flag={flag} />
              ))}
            </div>
          </section>
        )}

        {/* 最近自己申告した人 */}
        {recentSelfReports.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-bold text-ink-soft">最近自己申告した人</h2>
            <div className="flex flex-col gap-3">
              {recentSelfReports.map((req) => (
                <SelfReportFeedItem key={req.id} req={req} />
              ))}
            </div>
          </section>
        )}

        {/* スタッフ一覧 */}
        <section>
          <h2 className="mb-3 text-sm font-bold text-ink-soft">
            登録スタッフ <span className="text-ink">{workers.length} 人</span>
          </h2>
          {workers.length === 0 ? (
            <EmptyState title="まだスタッフが登録されていません" />
          ) : (
            <ul className="flex flex-col gap-3">
              {workers.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-col gap-2 rounded-xl border border-line bg-white px-4 py-3.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-chip text-sm font-bold text-ink-soft">
                        {w.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-ink">{w.name}{w.is_minor && <span className="app-pill ml-2">18歳未満</span>}</p>
                        <p className="mt-0.5 text-xs text-ink-soft">
                          {w.skill_tags.join("・")}
                        </p>
                      </div>
                    </div>
                    <VerificationBadge status={w.verification_status} size="sm" />
                  </div>
                  <div className="flex justify-end">
                    <ReportWorkerButton workerId={w.id} storeName={w.current_store} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
