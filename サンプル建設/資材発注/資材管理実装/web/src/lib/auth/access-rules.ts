import type { AppUserRole } from "@/types/app-user";

/**
 * A-7-app-1 / Phase 3-0A: 画面ガード用のパス × ロール認可ルール。
 *
 * - root layout から `evaluatePathAccess(pathname, role)` を呼び、結果に応じて
 *   redirect('/forbidden') / notFound() / 通過 を決定する。
 * - ロールは admin(事務) / center(サンプル市Aセンター) / vendor(現場・業者) の 3 種。
 *   legacy の internal は admin と同等に正規化して扱う（移行期間の互換）。
 * - (b) app_users 未登録（role=null）は layout で /no-access へ寄せ済み。
 * - Server Action 内の操作ガードは require-role.ts で別途実装する（本ルールは画面のみ）。
 *
 * 権限方針:
 *   - center が使うのは オーダー確認・印刷 / センター在庫 / 現場在庫 / 棚卸
 *     （D-20260806-03、D-20260807-01）
 *   - マスタ管理・リース・入出庫・返却・在庫調整・分析は center から外す
 *   - 在庫の直接補正（/stock/new, /stock/[id]/edit）は admin のみ
 *   - 出庫依頼の作成（/requests/new）は vendor のみ
 *   - vendor が使うのは 出庫依頼 / 自現場の在庫 / 在庫調整申請 / 予定数量(参照) の4つだけ
 *     （D-20260805-07, 08）。/vendor/stock は vendor 専用（admin/center は 404）
 */

export type AccessResult = "allow" | "forbidden" | "not_found";

/** 画面ルール上のロール（internal は admin に正規化するため 3 値） */
type UiAccessRole = "admin" | "center" | "vendor";

type AccessRule = {
  /** デバッグ・ログ用 */
  id: string;
  match: (pathname: string) => boolean;
  admin: AccessResult;
  center: AccessResult;
  vendor: AccessResult;
};

const RE_PRODUCTS_EDIT = /^\/products\/[^/]+\/edit$/;
const RE_SITES_EDIT = /^\/sites\/[^/]+\/edit$/;
const RE_SITES_PRODUCTS = /^\/sites\/[^/]+\/products$/;
const RE_SITE_PROGRESS_DETAIL = /^\/stock\/progress\/[^/]+$/;
const RE_SUPPLIERS_EDIT = /^\/purchases\/suppliers\/[^/]+\/edit$/;
const RE_STOCK_EDIT = /^\/stock\/[^/]+\/edit$/;
const RE_REQUESTS_DETAIL = /^\/requests\/[^/]+$/;
const RE_ORDERS_DETAIL = /^\/orders\/[^/]+$/;
const RE_ORDERS_PRINT = /^\/orders\/[^/]+\/print$/;
const RE_VENDORS_EDIT = /^\/vendors\/[^/]+\/edit$/;
const RE_VENDORS_SITES = /^\/vendors\/[^/]+\/sites$/;
const RE_USERS_EDIT = /^\/users\/[^/]+\/edit$/;
const RE_LEASE_COMPANIES_EDIT = /^\/leases\/companies\/[^/]+\/edit$/;
const RE_LEASE_BATCH_DETAIL = /^\/leases\/batches\/[^/]+$/;
const RE_PLANS_EDIT = /^\/plans\/[^/]+\/edit$/;

export const PATH_ACCESS_RULES: AccessRule[] = [
  // ---- 共通 ----
  { id: "home", match: (p) => p === "/", admin: "allow", center: "allow", vendor: "allow" },

  // ---- 出庫依頼: 現場（vendor）のオーダー作成・確認専用。事務は /orders に統合 ----
  { id: "requests_list", match: (p) => p === "/requests", admin: "forbidden", center: "forbidden", vendor: "allow" },
  { id: "requests_new", match: (p) => p === "/requests/new", admin: "forbidden", center: "forbidden", vendor: "allow" },
  { id: "requests_detail", match: (p) => RE_REQUESTS_DETAIL.test(p), admin: "forbidden", center: "forbidden", vendor: "allow" },

  // ---- オーダー（出庫依頼まとめ）: center は確認・印刷のみ、更新は admin ----
  { id: "orders_list", match: (p) => p === "/orders", admin: "allow", center: "allow", vendor: "forbidden" },
  { id: "orders_print", match: (p) => RE_ORDERS_PRINT.test(p), admin: "allow", center: "allow", vendor: "forbidden" },
  { id: "orders_detail", match: (p) => RE_ORDERS_DETAIL.test(p), admin: "allow", center: "allow", vendor: "forbidden" },

  // ---- products: 一覧は 3 者参照 / 編集系は admin のみ ----
  { id: "products_list", match: (p) => p === "/products", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "products_export", match: (p) => p === "/products/export", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "prime_contractors", match: (p) => p === "/prime-contractors", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "centers", match: (p) => p === "/centers", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "products_new", match: (p) => p === "/products/new", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "products_edit", match: (p) => RE_PRODUCTS_EDIT.test(p), admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "product_categories", match: (p) => p === "/products/categories", admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- sites: 一覧は 3 者参照 / 編集系は admin のみ ----
  { id: "sites_list", match: (p) => p === "/sites", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "sites_new", match: (p) => p === "/sites/new", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "sites_edit", match: (p) => RE_SITES_EDIT.test(p), admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "sites_products", match: (p) => RE_SITES_PRODUCTS.test(p), admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- stock: center は在庫参照に加え、棚卸だけadminと同じく開始・確定できる ----
  { id: "stock_list", match: (p) => p === "/stock", admin: "allow", center: "allow", vendor: "forbidden" },
  { id: "stock_summary", match: (p) => p === "/stock/summary" || p.startsWith("/stock/summary/"), admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "stock_new", match: (p) => p === "/stock/new", admin: "forbidden", center: "forbidden", vendor: "forbidden" },
  { id: "stock_edit", match: (p) => RE_STOCK_EDIT.test(p), admin: "forbidden", center: "forbidden", vendor: "forbidden" },
  { id: "stock_move", match: (p) => p === "/stock/move", admin: "forbidden", center: "forbidden", vendor: "forbidden" },
  { id: "stock_ledger", match: (p) => p === "/stock/ledger", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "stock_sites_list", match: (p) => p === "/stock/sites", admin: "allow", center: "allow", vendor: "forbidden" },
  // センター間移動: center が起票、admin は確認のみ（P4-2）
  { id: "stock_transfers", match: (p) => p === "/stock/transfers", admin: "allow", center: "allow", vendor: "forbidden" },
  { id: "stock_inventory", match: (p) => p === "/stock/inventory" || p.startsWith("/stock/inventory/"), admin: "allow", center: "allow", vendor: "forbidden" },
  { id: "stock_returns_new", match: (p) => p === "/stock/returns/new", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "stock_returns_list", match: (p) => p === "/stock/returns", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "stock_over_returns", match: (p) => p === "/stock/over-returns", admin: "allow", center: "forbidden", vendor: "forbidden" },
  // 在庫調整申請: center は対象外。vendor は担当現場分のみ申請・参照、承認は admin
  { id: "stock_adjustments_list", match: (p) => p === "/stock/adjustments", admin: "allow", center: "forbidden", vendor: "allow" },
  { id: "stock_adjustments_new", match: (p) => p === "/stock/adjustments/new", admin: "forbidden", center: "forbidden", vendor: "allow" },

  // ---- vendors: admin のみ ----
  { id: "vendors_list", match: (p) => p === "/vendors", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "vendors_new", match: (p) => p === "/vendors/new", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "vendors_edit", match: (p) => RE_VENDORS_EDIT.test(p), admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "vendors_sites", match: (p) => RE_VENDORS_SITES.test(p), admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- 現場進捗・未返却: admin のみ ----
  { id: "site_progress_list", match: (p) => p === "/stock/progress", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "site_progress_new", match: (p) => p === "/stock/progress/new", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "site_progress_detail", match: (p) => RE_SITE_PROGRESS_DETAIL.test(p), admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "site_outstanding", match: (p) => p === "/stock/outstanding", admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- purchases: 仕入れ管理は admin のみ（RLS も admin のみ。center/vendor には見せない） ----
  { id: "purchases_list", match: (p) => p === "/purchases", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "purchases_new", match: (p) => p === "/purchases/new", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "suppliers_list", match: (p) => p === "/purchases/suppliers", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "suppliers_new", match: (p) => p === "/purchases/suppliers/new", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "suppliers_edit", match: (p) => RE_SUPPLIERS_EDIT.test(p), admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- operations: 操作履歴は admin のみ（RLS も admin のみ SELECT 可） ----
  { id: "operation_logs", match: (p) => p === "/operations", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "history_archive", match: (p) => p === "/history-archive", admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- users: admin のみ ----
  { id: "users_list", match: (p) => p === "/users", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "users_new", match: (p) => p === "/users/new", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "users_edit", match: (p) => RE_USERS_EDIT.test(p), admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- leases/companies: admin のみ ----
  { id: "lease_companies_list", match: (p) => p === "/leases/companies", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "lease_companies_new", match: (p) => p === "/leases/companies/new", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "lease_companies_edit", match: (p) => RE_LEASE_COMPANIES_EDIT.test(p), admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- leases/batches: admin のみ ----
  { id: "lease_batches_list", match: (p) => p === "/leases/batches", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "lease_batches_new", match: (p) => p === "/leases/batches/new", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "lease_batches_detail", match: (p) => RE_LEASE_BATCH_DETAIL.test(p), admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- リース在庫内訳（自社/リース別）: admin のみ。
  //      vendor には所有形態を見せない（自現場の合計数量は /vendor/stock。D-20260805-08）----
  { id: "lease_stock", match: (p) => p === "/leases/stock", admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- 返却期限・未返却一覧: admin のみ ----
  { id: "lease_due", match: (p) => p === "/leases/due", admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- 予定数量: 登録・編集は admin / 一覧参照は 3 者（vendor は RLS で担当現場のみ）----
  { id: "plans_list", match: (p) => p === "/plans", admin: "allow", center: "forbidden", vendor: "allow" },
  { id: "plans_new", match: (p) => p === "/plans/new", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "plans_import", match: (p) => p === "/plans/import", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "plans_over", match: (p) => p === "/plans/over", admin: "allow", center: "forbidden", vendor: "forbidden" },
  // 半端もんの確認は admin 専用（ページ自体もそう書かれている）。
  // ルール未登録だと evaluatePathAccess の既定 "allow" で誰でも到達できてしまうため明示する。
  { id: "plans_lot_size", match: (p) => p === "/plans/lot-size", admin: "allow", center: "forbidden", vendor: "forbidden" },
  { id: "plans_edit", match: (p) => RE_PLANS_EDIT.test(p), admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- 分析（ダッシュボード / 月別年別 / 現場別 / 商品別 / リース / CSV）: admin のみ ----
  { id: "analytics", match: (p) => p === "/analytics" || p.startsWith("/analytics/"), admin: "allow", center: "forbidden", vendor: "forbidden" },

  // ---- vendor 専用: admin/center は 404 ----
  // 自現場の在庫（vendor 専用）。次の依頼数量を判断するために必要（D-20260805-08）。
  { id: "vendor_stock", match: (p) => p === "/vendor/stock", admin: "not_found", center: "not_found", vendor: "allow" },
];

/** legacy internal を admin に正規化して 3 値へ落とす。 */
function normalizeRole(role: AppUserRole): UiAccessRole {
  if (role === "vendor") return "vendor";
  if (role === "center") return "center";
  // admin / internal（legacy）はどちらも admin 扱い
  return "admin";
}

/**
 * pathname × role の認可判定。
 * - 未マッチは center のみ "forbidden"（許可画面を4業務に限定するためフェイルクローズ）
 *   admin/vendor は既存互換のため "allow"
 * - /login, /no-access, /forbidden, /auth/signout 等は root layout の EXEMPT で先に弾く
 */
export function evaluatePathAccess(
  pathname: string,
  role: AppUserRole,
): AccessResult {
  const r = normalizeRole(role);
  for (const rule of PATH_ACCESS_RULES) {
    if (rule.match(pathname)) {
      return rule[r];
    }
  }
  // center はヒアリングで確定した画面だけを明示許可する（新規画面は既定拒否）。
  return r === "center" ? "forbidden" : "allow";
}

/**
 * Page / ネスト layout 層で notFound() を呼ぶべきか。
 * Next.js は root layout からの notFound() を禁止するため、'not_found' のときは
 * 該当 page.tsx 側で本関数を見て notFound() する。
 */
export function shouldPageCallNotFound(
  pathname: string,
  role: AppUserRole,
): boolean {
  return evaluatePathAccess(pathname, role) === "not_found";
}
