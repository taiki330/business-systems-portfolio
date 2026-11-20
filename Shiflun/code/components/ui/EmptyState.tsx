import Image from "next/image";
import Link from "next/link";

/** 一覧が空のときの表示。シフルニャンを小さく添える。 */
export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <section className="flex flex-col items-center px-4 py-10 text-center">
      <Image src="/mascot/shifurunyan-empty.png" alt="" width={470} height={491} className="h-24 w-auto" />
      <h3 className="mt-4 text-base font-bold text-ink">{title}</h3>
      {description && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{description}</p>}
      {actionHref && actionLabel && <Link href={actionHref} className="app-secondary mt-5">{actionLabel}</Link>}
    </section>
  );
}
