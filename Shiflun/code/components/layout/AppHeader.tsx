import Image from "next/image";
import Link from "next/link";
import { NotificationBell } from "@/components/notifications/NotificationBell";

type AppHeaderProps = {
  title: string;
  description?: string;
  /** 空文字なら「戻る」を出さない（下のメニューから開く画面はこちら）。 */
  backHref?: string;
  backLabel?: string;
};

/** 画面いちばん上の帯：左にロゴ、右にお知らせ。全画面で共通。 */
export function TopBar() {
  return (
    <div className="-mx-4 flex h-14 items-center justify-between border-b border-line bg-white px-4">
      <Link href="/" aria-label="シフルン トップへ" className="inline-flex min-h-11 items-center">
        <Image src="/logo-full.png" alt="シフルン" width={140} height={42} className="h-7 w-auto" priority />
      </Link>
      <NotificationBell />
    </div>
  );
}

/** ロゴの帯と、画面の見出し。.app-page の先頭に置く。 */
export function AppHeader({ title, description, backHref = "", backLabel = "戻る" }: AppHeaderProps) {
  return (
    <header className="mb-5">
      <TopBar />
      {backHref && (
        <Link href={backHref} className="-ml-1 mt-2 inline-flex min-h-11 items-center gap-0.5 text-sm font-medium text-ink-soft hover:text-ink">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5"><path d="m15 5-7 7 7 7" /></svg>
          {backLabel}
        </Link>
      )}
      <h1 className={`app-title ${backHref ? "mt-1" : "mt-5"}`}>{title}</h1>
      {description && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{description}</p>}
    </header>
  );
}
