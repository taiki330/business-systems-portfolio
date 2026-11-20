import { calculateStoreCost, durationLabel } from "@/lib/utils/matching";

/** 店舗が支払う予定額（ワーカーへの給与 ＋ 手数料）。 */
export function StoreCostSummary({ hourlyWage, workMinutes, totalYen, feePercent, feeYen, storeTotalYen }: { hourlyWage: number; workMinutes: number; totalYen: number; feePercent?: number; feeYen?: number; storeTotalYen?: number }) {
  const computed = calculateStoreCost(totalYen);
  const percent = feePercent ?? computed.feePercent;
  const fee = feeYen ?? computed.feeYen;
  const total = storeTotalYen ?? computed.storeTotalYen;
  return <section className="rounded-lg bg-brand-yellow-light px-4 py-3">
    <h3 className="text-xs font-bold text-brand-yellow-dark">お店のお支払い予定額</h3>
    <dl className="mt-2 space-y-1.5 text-sm text-ink">
      <div className="flex items-start justify-between gap-3"><dt>ワーカーへの給与<span className="block text-xs text-brand-yellow-dark">時給 {hourlyWage.toLocaleString()}円 × {durationLabel(workMinutes)}</span></dt><dd className="shrink-0 font-bold tabular-nums">{totalYen.toLocaleString()}円</dd></div>
      <div className="flex justify-between gap-3"><dt>手数料 {percent}％</dt><dd className="font-bold tabular-nums">{fee.toLocaleString()}円</dd></div>
      <div className="flex items-end justify-between gap-3 border-t border-brand-yellow pt-2"><dt className="font-bold">合計</dt><dd className="text-3xl font-black leading-tight tabular-nums">{total.toLocaleString()}<span className="ml-0.5 text-base font-bold">円</span></dd></div>
    </dl>
    <p className="mt-2 text-xs leading-relaxed text-brand-yellow-dark">手数料はお店の負担として加算します。分単位で計算し、1円単位で四捨五入します。</p>
  </section>;
}
