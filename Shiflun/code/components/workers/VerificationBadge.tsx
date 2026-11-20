import { VerificationStatus } from "@/lib/types/database";
import { CheckBadgeIcon } from "@/components/ui/Icons";

type VerificationBadgeProps = {
  status: VerificationStatus;
  /** 以前の大きさ指定。見た目は同じ（呼び出し側の互換のために残している）。 */
  size?: "sm" | "md" | "lg";
};

/** 店長認証の有無の印。 */
export function VerificationBadge({ status }: VerificationBadgeProps) {
  if (status === "verified") {
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-blue-light px-2 py-1 text-xs font-bold text-brand-blue-dark"><CheckBadgeIcon className="size-4" />店長認証済み</span>;
  }
  return <span className="app-tag shrink-0 text-ink-soft">未認証</span>;
}
