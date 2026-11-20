"use client";

import { useEffect, useState } from "react";
import { getPayoutsForWorker } from "@/lib/actions/payouts";
import { useWorkerId } from "@/lib/hooks/use-worker-id";
import { LoadingMascot } from "@/components/ui/LoadingMascot";
import { EmptyState } from "@/components/ui/EmptyState";
import { Payout } from "@/lib/types/database";

export function EarningsClient() {
  const { workerId, ready } = useWorkerId();
  const [payouts, setPayouts] = useState<Payout[] | null>(null);

  useEffect(() => {
    if (!workerId) return;
    getPayoutsForWorker(workerId).then(({ payouts }) => setPayouts(payouts));
  }, [workerId]);

  if (!ready) return null;

  if (!workerId) {
    return (
      <div className="rounded-xl border border-brand-yellow bg-brand-yellow-light p-5 text-center">
        <p className="text-sm font-semibold text-brand-yellow-dark">設定でアカウントを選択してください</p>
      </div>
    );
  }

  if (payouts === null) {
    return <LoadingMascot />;
  }

  if (payouts.length === 0) {
    return <EmptyState title="出勤が確定した勤務はまだありません" description="スカウトが承諾されて出勤すると、ここに表示されます。" />;
  }

  const pendingTotal = payouts.filter((p) => p.status === "pending").reduce((sum, p) => sum + p.wage_amount_yen, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-brand-blue bg-brand-blue-light p-4">
        <p className="text-xs font-bold tracking-widest text-brand-blue">未払い合計</p>
        <p className="mt-1 text-2xl font-bold text-brand-blue">{pendingTotal.toLocaleString()}円</p>
        <p className="mt-1 text-xs text-brand-blue">
          店舗から直接お支払いいただく金額です。Shiflunは送金を代行しません。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {payouts.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">{p.store_name ?? "—"}</p>
              <p className="mt-0.5 text-xs text-ink-soft">
                {new Date(p.created_at).toLocaleDateString("ja-JP")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-ink">{p.wage_amount_yen.toLocaleString()}円</p>
              <span
                className={`text-[10px] font-semibold ${p.status === "paid" ? "text-brand-blue" : "text-brand-yellow-dark"}`}
              >
                {p.status === "paid" ? "支払い済み" : "未払い"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
