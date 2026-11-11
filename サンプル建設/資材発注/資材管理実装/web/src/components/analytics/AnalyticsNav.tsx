import Link from "next/link";

const TABS: { href: string; label: string }[] = [
  { href: "/analytics", label: "ダッシュボード" },
  { href: "/analytics/period", label: "月別・年別" },
  { href: "/analytics/sites", label: "現場別" },
  { href: "/analytics/products", label: "商品別" },
  { href: "/analytics/leases", label: "リース" },
];

/** 分析画面の共通タブナビ（Phase 5）。current にアクティブなパスを渡す。 */
export function AnalyticsNav({ current }: { current: string }) {
  return (
    <nav className="mt-3 flex flex-wrap gap-2">
      {TABS.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              active
                ? "bg-zinc-900 text-white"
                : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
