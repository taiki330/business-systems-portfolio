import Link from "next/link";

/** 画面下部に置く、利用規約・プライバシーポリシー・お問い合わせへのリンク。 */
export function LegalLinks({ className = "" }: { className?: string }) {
  return <nav aria-label="規約とお問い合わせ" className={`flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-ink-soft ${className}`}>
    <Link href="/terms" className="hover:text-ink-soft hover:underline">利用規約</Link>
    <Link href="/privacy" className="hover:text-ink-soft hover:underline">プライバシーポリシー</Link>
    <Link href="/contact" className="hover:text-ink-soft hover:underline">お問い合わせ</Link>
  </nav>;
}
