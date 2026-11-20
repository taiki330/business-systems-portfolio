import Link from "next/link";

const ITEMS = [
  { key: "identity", href: "/admin/identity-verifications", label: "本人確認" },
  { key: "reports", href: "/admin/reports", label: "通報" },
  { key: "inquiries", href: "/admin/inquiries", label: "お問い合わせ" },
  { key: "suspensions", href: "/admin/suspensions", label: "利用停止" },
] as const;

/** 運営（審査担当）用の画面どうしを行き来するタブ。 */
export function AdminNav({ current }: { current: (typeof ITEMS)[number]["key"] }) {
  return <nav aria-label="運営メニュー" className="mb-5 flex gap-2">
    {ITEMS.map((item) => <Link key={item.key} href={item.href} aria-current={item.key === current ? "page" : undefined}
      className={`flex min-h-11 flex-1 items-center justify-center rounded-lg border px-2 text-sm font-semibold ${item.key === current ? "border-slate-900 bg-ink text-white" : "border-line bg-white text-ink-soft hover:bg-paper"}`}>{item.label}</Link>)}
  </nav>;
}
