import { calculateOffer, durationLabel } from "@/lib/utils/matching";
import { ScoutRequest } from "@/lib/types/database";

type Offer = Pick<ScoutRequest, "offered_hourly_wage" | "preferred_start_time" | "preferred_end_time" | "break_minutes" | "work_minutes" | "offered_total_yen">;

/** スカウトの金額（合計と、時給 × 時間）。計算できないときは null。 */
export function offerNumbers(scout: Offer): { total: number; minutes: number; wage: number } | null {
  const derived = calculateOffer(Number(scout.offered_hourly_wage), scout.preferred_start_time ?? "", scout.preferred_end_time ?? "", scout.break_minutes ?? 0);
  const minutes = scout.work_minutes ?? derived?.workMinutes;
  const total = scout.offered_total_yen ?? derived?.totalYen;
  if (total === undefined || total === null || minutes === undefined || minutes === null) return null;
  return { total: Number(total), minutes: Number(minutes), wage: Number(scout.offered_hourly_wage) };
}

/** もらえる金額を大きく見せる枠。 */
export function OfferSummary({ scout }: { scout: Offer }) {
  const offer = offerNumbers(scout);
  if (!offer) return <p className="text-sm text-ink-soft">提示額の詳細は未設定です。</p>;
  return <div className="rounded-lg bg-brand-yellow-light px-4 py-3">
    <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <div>
        <p className="text-xs font-bold text-brand-yellow-dark">給与（予定）</p>
        <p className="text-3xl font-black leading-tight tabular-nums text-ink">{offer.total.toLocaleString()}<span className="ml-0.5 text-base font-bold">円</span></p>
      </div>
      <p className="pb-1 text-sm text-ink">時給 {offer.wage.toLocaleString()}円 × {durationLabel(offer.minutes)}</p>
    </div>
    <p className="mt-1 text-xs leading-relaxed text-brand-yellow-dark">{(scout.break_minutes ?? 0) > 0 ? `休憩${scout.break_minutes}分を除いた時間で計算。` : ""}交通費・手当等は含みません。</p>
  </div>;
}
