import Link from "next/link";
import { ChevronRightIcon } from "@/components/ui/Icons";

type NavCardProps = {
  href: string;
  title: string;
  description: string;
  /** 以前の色分け用。見た目は同じ（呼び出し側の互換のために残している）。 */
  accent?: "worker" | "store";
};

/** 行き先を選ぶための大きめの行。 */
export function NavCard({ href, title, description }: NavCardProps) {
  return (
    <Link href={href} className="app-card flex items-center gap-3 hover:bg-paper">
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold text-ink">{title}</span>
        <span className="mt-1 block text-sm leading-relaxed text-ink-soft">{description}</span>
      </span>
      <ChevronRightIcon className="size-6 shrink-0 text-ink-soft" />
    </Link>
  );
}
