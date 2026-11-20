import { TopBar } from "@/components/layout/AppHeader";
import { NavCard } from "@/components/ui/NavCard";
import { LegalLinks } from "@/components/legal/LegalLinks";

const STEPS = [
  { title: "登録", description: "名前・勤務先・スキルを登録します。" },
  { title: "勤務希望", description: "働きたい日と時間帯を提出します。" },
  { title: "店長確認", description: "店長が勤務実績を確認・認証します。" },
  { title: "他店舗からスカウト依頼", description: "認証済みの実績を見て、他店舗からスカウトが届きます。" },
];

export default function HomePage() {
  return (
    <div className="app-page">
      <TopBar />
      <header className="mb-6 mt-6">
        <h1 className="app-title">現役バイトの実績を、次の一歩へ。</h1>
        <p className="mt-3 text-base leading-relaxed text-ink-soft">飲食店での勤務実績と店長認証を可視化し、他店舗からのスカウトにつなげるサービスです。</p>
      </header>

      <main className="flex flex-col gap-8">
        <section aria-label="はじめる" className="flex flex-col gap-3">
          <NavCard href="/workers/join-store" title="バイトの方" description="プロフィール登録、シフト希望の提出ができます。" />
          <NavCard href="/managers/shifts" title="店舗の方" description="シフト管理、人材検索、スカウト送信ができます。" />
        </section>

        <section>
          <h2 className="app-section-title">利用の流れ</h2>
          <ol className="app-card mt-3 divide-y divide-line p-0">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex items-start gap-3 px-4 py-3.5">
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-yellow text-sm font-bold tabular-nums text-ink">{index + 1}</span>
                <div className="min-w-0">
                  <p className="text-base font-bold text-ink">{step.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <LegalLinks className="mt-10" />
    </div>
  );
}
