import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { PayoutCard } from "@/components/managers/PayoutCard";
import { getPayoutsForManager } from "@/lib/actions/payouts";

export const dynamic = "force-dynamic";

export default async function ManagerPayoutsPage() {
  const { payouts, error } = await getPayoutsForManager();
  const pending = payouts.filter((p) => p.status === "pending");
  const paid = payouts.filter((p) => p.status === "paid");

  return (
    <div className="app-page">
      <AppHeader
        title="支払い状況"
        description="出勤が確定した勤務の支払い額です。振込は店舗側で直接行い、完了したらここで「支払い済み」にしてください。Shiflunは送金を代行しません。"
        backHref="/managers/more" backLabel="その他"
      />
      <main className="flex flex-col gap-6">
        {error && <p role="alert" className="app-error">{error}</p>}

        <section>
          <h2 className="mb-3 text-sm font-bold text-brand-yellow-dark">
            未払い <span className="ml-1 rounded-full bg-brand-yellow-light px-2 py-0.5 text-xs">{pending.length}</span>
          </h2>
          {pending.length === 0 ? (
            <EmptyState title="未払いの記録はありません" />
          ) : (
            <div className="flex flex-col gap-3">
              {pending.map((p) => <PayoutCard key={p.id} payout={p} />)}
            </div>
          )}
        </section>

        {paid.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-bold text-ink-soft">支払い済み</h2>
            <div className="flex flex-col gap-3">
              {paid.map((p) => <PayoutCard key={p.id} payout={p} />)}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
