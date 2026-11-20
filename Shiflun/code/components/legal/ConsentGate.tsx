"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConsent } from "@/lib/hooks/use-consent";
import { ParticipantRole } from "@/lib/types/database";

/**
 * 登録フォームの手前に置く。同意ページ（/agreement）で同意するまではフォームを出さず、
 * 同意ページへの案内を表示する（入力途中の内容が同意ページへの移動で消えないようにするため）。
 */
export function ConsentGate({ role, children }: { role: ParticipantRole; children: React.ReactNode }) {
  const { ready, agreedAt } = useConsent();
  const pathname = usePathname();
  if (!ready) return null;
  if (agreedAt) return children;
  return <div className="app-card space-y-4 text-center">
    <p className="text-base font-bold text-ink">はじめに、利用規約とプライバシーポリシーをご確認ください</p>
    <p className="text-sm leading-relaxed text-ink-soft">
      {role === "store" ? "店舗の登録" : "働いている店舗の登録"}には、利用規約とプライバシーポリシーへの同意が必要です。確認ページで内容をお読みのうえ、「同意する」を押すとこの画面に戻ります。
    </p>
    <Link href={`/agreement?role=${role}&next=${encodeURIComponent(pathname)}`} className="app-primary w-full">内容を確認する</Link>
  </div>;
}

/** 登録フォームの中に置く。同意ページで記録した版と日時をサーバーへ送る。 */
export function ConsentFields() {
  const { agreedAt, version } = useConsent();
  if (!agreedAt) return null;
  return <p className="text-xs leading-relaxed text-ink-soft">
    <input type="hidden" name="terms_version" value={version} />
    <input type="hidden" name="terms_agreed_at" value={agreedAt} />
    ✓ {new Date(agreedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}に
    <Link href="/terms" target="_blank" className="font-semibold text-brand-blue underline underline-offset-2">利用規約</Link>と
    <Link href="/privacy" target="_blank" className="font-semibold text-brand-blue underline underline-offset-2">プライバシーポリシー</Link>に同意済みです
  </p>;
}
