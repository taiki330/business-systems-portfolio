import { ShiftRequestStatus } from "@/lib/types/database";
import { SHIFT_STATUS_BADGE_CLASSES, SHIFT_STATUS_LABELS } from "@/lib/constants/shift-status";

/** シフトの状態の印（確認待ち・採用済み など）。 */
export function ShiftStatusBadge({ status }: { status: ShiftRequestStatus }) {
  return <span className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-xs font-bold ${SHIFT_STATUS_BADGE_CLASSES[status]}`}>{SHIFT_STATUS_LABELS[status]}</span>;
}
