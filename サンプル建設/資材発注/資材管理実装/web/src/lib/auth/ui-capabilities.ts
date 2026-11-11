import { isAuthzEnabled } from "@/lib/auth/authz-flag";
import type { AppUser } from "@/types/app-user";
import type { StockRequestStatus } from "@/types/stock-request";

/**
 * Phase 3-0A: UI 出し分け用の判定（画面・ボタン表示のみ）。
 * 認可の最終防衛は require-role.ts + RLS。本ファイルは UX 用。
 *
 * ロールは admin(事務) / center(サンプル市Aセンター) / vendor(現場・業者) の 3 種。
 * legacy の internal は admin 相当に正規化する。
 * 認可 OFF（`REQUIRE_AUTH=0`）のときは admin 相当（開発用）。
 */

export type UiRole = "admin" | "center" | "vendor";

export type HomeNavLink = {
  href: string;
  label: string;
  variant: "primary" | "secondary";
};

/**
 * UI 表示用ロール。vendor / center はそのまま、admin / internal(legacy) / null は admin。
 * 認可 OFF 時は常に admin。
 */
export function resolveUiRole(user: AppUser | null): UiRole {
  if (!isAuthzEnabled()) {
    return "admin";
  }
  if (user?.role === "vendor") {
    return "vendor";
  }
  if (user?.role === "center") {
    return "center";
  }
  return "admin";
}

/** マスタの作成/編集/削除ボタンを表示してよいか（admin のみ）。 */
export function canShowMasterWriteActions(role: UiRole): boolean {
  return role === "admin";
}

/** 出庫依頼の「受付」ボタン（現在は事務がシステム操作を代行）。 */
export function canShowRequestAccept(
  role: UiRole,
  status: StockRequestStatus,
): boolean {
  return role === "admin" && status === "requested";
}

/** 出庫依頼の「出庫確定」ボタン（現在は事務がシステム操作を代行）。 */
export function canShowRequestShip(
  role: UiRole,
  status: StockRequestStatus,
): boolean {
  return role === "admin" && status === "accepted";
}

/** 出庫依頼の「キャンセル」ボタンを表示してよいか。 */
export function canShowRequestCancel(
  role: UiRole,
  ctx: {
    status: StockRequestStatus;
    requestedBy: string | null;
    userId: string;
  },
): boolean {
  // 事務: requested / accepted をキャンセル可
  if (role === "admin") {
    return ctx.status === "requested" || ctx.status === "accepted";
  }
  // vendor: 自分の requested のみ
  if (role === "vendor") {
    return (
      ctx.status === "requested" &&
      ctx.requestedBy !== null &&
      ctx.requestedBy === ctx.userId
    );
  }
  return false;
}

/** 在庫の直接補正（暫定メンテ）ボタンを表示してよいか（admin のみ）。 */
export function canShowStockDirectEdit(role: UiRole): boolean {
  return role === "admin";
}

/** 入出庫登録ボタン（現在は事務がシステム操作を代行）。 */
export function canShowStockMovement(role: UiRole): boolean {
  return role === "admin";
}

/** 現場在庫からの返却登録ボタン（現在は事務がシステム操作を代行）。 */
export function canShowStockReturn(role: UiRole): boolean {
  return role === "admin";
}

/** リース借用の登録・承認・キャンセルボタンを表示してよいか（admin のみ）。 */
export function canShowLeaseBatchAdminActions(role: UiRole): boolean {
  return role === "admin";
}

/**
 * リース品の受入・出庫・返却ボタン。現在は事務がシステム操作を代行する。
 */
export function canShowLeaseStockActions(role: UiRole): boolean {
  return role === "admin";
}

/** 予定数量の登録・編集・削除ボタンを表示してよいか（admin のみ）。 */
export function canShowPlanWriteActions(role: UiRole): boolean {
  return role === "admin";
}

/** 予定数量超過の確認ページへの導線を表示してよいか（admin のみ）。 */
export function canShowOverPlanPage(role: UiRole): boolean {
  return role === "admin";
}

/** 資材移動の月別・年別集計を表示してよいか（admin のみ）。 */
export function canShowMovementAnalytics(role: UiRole): boolean {
  return role === "admin";
}

/**
 * リース会社名を表示してよいか（admin + center）。
 * vendor は数量の内訳までを参照範囲とし、リース会社・契約情報は参照しない（要件定義書 §4-3）。
 */
export function canShowLeaseCompanyName(role: UiRole): boolean {
  return role === "admin" || role === "center";
}

export function homeNavLinks(role: UiRole): HomeNavLink[] {
  // vendor（現場・業者）は画面を最小限にする（D-20260805-07）。
  // マスタ・センター倉庫在庫・在庫内訳は参照させないが、
  // 次の依頼数量を判断するため自現場の在庫だけは見せる（D-20260805-08）。
  if (role === "vendor") {
    return [
      { href: "/requests", label: "出庫依頼", variant: "primary" },
      { href: "/vendor/stock", label: "自現場の在庫", variant: "secondary" },
      { href: "/stock/adjustments", label: "在庫調整申請", variant: "secondary" },
      { href: "/plans", label: "予定数量（参照）", variant: "secondary" },
    ];
  }

  if (role === "center") {
    return [
      { href: "/orders", label: "オーダーを確認・印刷", variant: "primary" },
      { href: "/stock", label: "センター在庫を見る", variant: "secondary" },
      { href: "/stock/inventory", label: "棚卸", variant: "secondary" },
      { href: "/stock/sites", label: "現場在庫を見る", variant: "secondary" },
      { href: "/stock/transfers", label: "センター間移動", variant: "secondary" },
    ];
  }

  // admin（事務）
  return [
    { href: "/products", label: "商品マスタへ", variant: "secondary" },
    { href: "/prime-contractors", label: "元請マスタへ", variant: "secondary" },
    { href: "/centers", label: "センターマスタへ", variant: "secondary" },
    { href: "/sites", label: "現場マスタへ", variant: "secondary" },
    { href: "/vendors", label: "業者管理へ", variant: "secondary" },
    { href: "/leases/companies", label: "リース会社管理へ", variant: "secondary" },
    { href: "/leases/batches", label: "リース借用管理へ", variant: "secondary" },
    { href: "/leases/stock", label: "リース在庫内訳", variant: "secondary" },
    { href: "/leases/due", label: "返却期限・未返却", variant: "secondary" },
    { href: "/plans", label: "現場別予定数量", variant: "secondary" },
    { href: "/plans/over", label: "予定数量超過の確認", variant: "secondary" },
    { href: "/plans/lot-size", label: "半端もんの確認", variant: "secondary" },
    { href: "/analytics", label: "分析ダッシュボード", variant: "secondary" },
    { href: "/users", label: "ユーザー管理へ", variant: "secondary" },
    { href: "/users/new", label: "アカウントを発行", variant: "secondary" },
    { href: "/purchases", label: "仕入れ管理", variant: "secondary" },
    { href: "/operations", label: "操作履歴", variant: "secondary" },
    { href: "/history-archive", label: "履歴のExcel出力・削除", variant: "secondary" },
    { href: "/stock", label: "在庫一覧（センター）", variant: "secondary" },
    { href: "/stock/summary", label: "総在庫サマリー", variant: "secondary" },
    { href: "/stock/inventory", label: "棚卸", variant: "secondary" },
    { href: "/stock/sites", label: "現場在庫一覧", variant: "secondary" },
    { href: "/stock/returns", label: "返却履歴", variant: "secondary" },
    { href: "/stock/over-returns", label: "過入庫一覧", variant: "secondary" },
    { href: "/stock/adjustments", label: "在庫調整申請（承認）", variant: "secondary" },
    { href: "/stock/progress", label: "現場進捗・完工レポート", variant: "secondary" },
    { href: "/stock/outstanding", label: "未返却資材一覧", variant: "secondary" },
    { href: "/stock/ledger", label: "在庫履歴", variant: "secondary" },
    { href: "/orders", label: "オーダー（確定数量・資材発注書）", variant: "secondary" },
  ];
}

/**
 * 管理トップのメニュー分類（4カテゴリ）。
 *
 * homeNavLinks(role) をロール別の正本とし、その各リンクを href によって
 * 4分類へ振り分ける。URL・権限・機能は一切変えず、表示の入れ子を作るだけ。
 * カテゴリページ（/menu/[key]）は各分類のリンク一覧を表示する。
 */
export type MenuCategoryKey = "stock" | "lease" | "plan" | "master";

export type MenuCategory = {
  key: MenuCategoryKey;
  title: string;
  description: string;
  links: HomeNavLink[];
};

const MENU_CATEGORY_META: Record<
  MenuCategoryKey,
  { title: string; description: string }
> = {
  stock: {
    title: "在庫・入出庫",
    description: "在庫の確認、入出庫、オーダー、返却、履歴",
  },
  lease: {
    title: "リース管理",
    description: "リース会社・借用・在庫・返却期限の管理",
  },
  plan: {
    title: "計画・分析",
    description: "予定数量、超過確認、月別・年別の分析",
  },
  master: {
    title: "マスタ・設定",
    description: "商品・現場・業者・ユーザーの管理",
  },
};

const MENU_CATEGORY_ORDER: MenuCategoryKey[] = [
  "stock",
  "lease",
  "plan",
  "master",
];

/** リンクの href から所属カテゴリを判定する。 */
function categoryOf(href: string): MenuCategoryKey {
  if (
    href === "/vendor/stock" ||
    href === "/requests" ||
    href.startsWith("/requests/") ||
    href === "/orders" ||
    href.startsWith("/orders/") ||
    href === "/stock" ||
    href.startsWith("/stock/") ||
    href === "/purchases" ||
    href.startsWith("/purchases/")
  ) {
    return "stock";
  }
  if (href === "/leases" || href.startsWith("/leases/")) {
    return "lease";
  }
  if (
    href === "/plans" ||
    href.startsWith("/plans/") ||
    href === "/analytics" ||
    href.startsWith("/analytics/")
  ) {
    return "plan";
  }
  // /products, /sites, /vendors, /users など
  return "master";
}

/** キーが有効な MenuCategoryKey か判定する（ルートパラメータ検証用）。 */
export function isMenuCategoryKey(value: string): value is MenuCategoryKey {
  return (MENU_CATEGORY_ORDER as string[]).includes(value);
}

/**
 * ロールの homeNavLinks を4分類へ振り分けて返す。
 * リンクが1件も無い分類は返さない（そのロールで使えない分類のカードは出さない）。
 * 各分類内のリンク順は homeNavLinks の順を保持する。
 */
export function homeMenuCategories(role: UiRole): MenuCategory[] {
  const links = homeNavLinks(role);
  const byKey = new Map<MenuCategoryKey, HomeNavLink[]>();
  for (const link of links) {
    const key = categoryOf(link.href);
    const list = byKey.get(key) ?? [];
    list.push(link);
    byKey.set(key, list);
  }
  return MENU_CATEGORY_ORDER.filter((key) => byKey.has(key)).map((key) => ({
    key,
    title: MENU_CATEGORY_META[key].title,
    description: MENU_CATEGORY_META[key].description,
    links: byKey.get(key)!,
  }));
}

/** 単一カテゴリを取得する（カテゴリページ用）。無ければ null。 */
export function homeMenuCategory(
  role: UiRole,
  key: MenuCategoryKey,
): MenuCategory | null {
  return homeMenuCategories(role).find((c) => c.key === key) ?? null;
}
