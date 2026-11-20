"use client";

import { useActionState } from "react";
import { markPayoutPaid, MarkPayoutPaidState } from "@/lib/actions/payouts";
import { Payout } from "@/lib/types/database";

const initialState: MarkPayoutPaidState = {};

export function PayoutCard({ payout }: { payout: Payout }) {
  const [state, formAction, pending] = useActionState(markPayoutPaid, initialState);
  const paid = payout.status === "paid";

  return (
    <div className={`rounded-xl border p-4 ${paid ? "border-line bg-paper" : "border-brand-yellow bg-brand-yellow-light"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink">{payout.workers?.name ?? "（不明なワーカー）"}</p>
          <p className="mt-0.5 text-xs text-ink-soft">{payout.store_name ?? "—"}</p>
          <p className="mt-2 text-lg font-bold text-ink">{payout.wage_amount_yen.toLocaleString()}円</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            うちShiflun手数料 {payout.service_fee_yen.toLocaleString()}円（店舗負担・別途請求）
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            paid ? "bg-brand-blue-light text-brand-blue" : "bg-brand-yellow-light text-brand-yellow-dark"
          }`}
        >
          {paid ? "支払い済み" : "未払い"}
        </span>
      </div>

      {paid ? (
        <p className="mt-3 text-xs text-ink-soft">
          {payout.marked_paid_by} が記録 · {payout.paid_at ? new Date(payout.paid_at).toLocaleString("ja-JP") : ""}
        </p>
      ) : (
        <form action={formAction} className="mt-3 flex gap-2">
          <input type="hidden" name="payout_id" value={payout.id} />
          <input
            name="marked_paid_by"
            placeholder="記録する担当者名"
            required
            className="flex-1 rounded-lg border border-brand-yellow px-3 py-2 text-xs focus:border-brand-yellow focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {pending ? "…" : "支払い済みにする"}
          </button>
        </form>
      )}
      {state.error && <p className="mt-2 text-xs text-rose-600">{state.error}</p>}
    </div>
  );
}
