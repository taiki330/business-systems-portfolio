import Link from "next/link";

type CenterSection = "orders" | "center-stock" | "site-stock" | "transfers";

const ITEMS: { key: CenterSection; href: string; label: string }[] = [
  { key: "orders", href: "/orders", label: "オーダー・印刷" },
  { key: "center-stock", href: "/stock", label: "センター在庫" },
  { key: "site-stock", href: "/stock/sites", label: "現場在庫" },
  { key: "transfers", href: "/stock/transfers", label: "センター間移動" },
];

export function CenterSectionNav({ active }: { active: CenterSection }) {
  return (
    <nav
      aria-label="地域センターメニュー"
      className="mb-6 grid grid-cols-1 gap-2 rounded-xl border border-blue-200 bg-blue-50 p-2 shadow-sm sm:grid-cols-4"
    >
      {ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={`rounded-lg px-4 py-3 text-center text-sm font-semibold transition-colors ${
            active === item.key
              ? "bg-blue-700 text-white"
              : "bg-white text-blue-900 hover:bg-blue-100"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
