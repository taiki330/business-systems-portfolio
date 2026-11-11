import Link from "next/link";

type LeaseSection = "batches" | "stock" | "due" | "companies";

const ITEMS: { key: LeaseSection; href: string; label: string }[] = [
  { key: "batches", href: "/leases/batches", label: "借用一覧" },
  { key: "stock", href: "/leases/stock", label: "リース在庫" },
  { key: "due", href: "/leases/due", label: "未返却・返却期限" },
  { key: "companies", href: "/leases/companies", label: "リース会社" },
];

export function LeaseSectionNav({ active }: { active: LeaseSection }) {
  return (
    <nav
      aria-label="リース管理メニュー"
      className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-sm"
    >
      {ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            active === item.key
              ? "bg-zinc-900 text-white"
              : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
