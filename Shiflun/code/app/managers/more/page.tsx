import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { ChevronRightIcon } from "@/components/ui/Icons";

const ITEMS = [
  { href: "/managers/staff", label: "スタッフ", description: "所属スタッフの確認、店長認証、通報" },
  { href: "/managers/shift-periods", label: "シフトの募集期間", description: "希望を集める期間の作成と締め切り" },
  { href: "/managers/payouts", label: "支払い", description: "スカウト勤務の支払い状況の記録" },
  { href: "/managers/checkin-qr", label: "出勤用QRコード", description: "店舗に掲示する、出退勤の打刻用コード" },
  { href: "/managers/notifications", label: "お知らせ", description: "スカウトへの返信やメッセージの通知" },
  { href: "/managers/settings", label: "店舗・時給設定", description: "店舗の写真、勤務地、時給、ログアウト、退会" },
];

/** 下のメニューに入りきらない店舗用の画面への入口。 */
export default function ManagerMorePage() {
  return (
    <div className="app-page">
      <AppHeader title="その他" />
      <main>
        <ul className="app-card divide-y divide-line p-0">
          {ITEMS.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-paper">
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-ink">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{item.description}</span>
                </span>
                <ChevronRightIcon className="size-5 shrink-0 text-ink-soft" />
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <LegalLinks className="mt-8" />
    </div>
  );
}
