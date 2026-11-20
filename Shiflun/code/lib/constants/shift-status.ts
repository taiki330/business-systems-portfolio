import { ShiftRequestStatus } from "@/lib/types/database";

export const SHIFT_STATUS_LABELS: Record<ShiftRequestStatus, string> = {
  pending: "確認待ち",
  assigned: "採用済み",
  released: "他店開放済み",
  cancelled: "取消済み",
  attended: "出勤済み",
};

/** 状態の印の見た目。黄色＝まだ対応待ち、青＝決まった、灰色＝終わった・関係なくなった。 */
export const SHIFT_STATUS_BADGE_CLASSES: Record<ShiftRequestStatus, string> = {
  pending: "bg-brand-yellow text-ink",
  assigned: "bg-brand-blue-light text-brand-blue-dark",
  released: "bg-brand-blue-light text-brand-blue-dark",
  cancelled: "bg-chip text-ink-soft",
  attended: "bg-chip text-ink",
};
