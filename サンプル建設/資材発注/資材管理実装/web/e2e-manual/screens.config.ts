/**
 * 利用者マニュアル自動生成の正本マニフェスト。
 *
 * ここに書かれた画面グループが、
 *   1) capture-screenshots.spec.ts が撮るスクリーンショットの一覧
 *   2) docs/manual/{admin,center,vendor}.md に書くべき画面の一覧
 * の両方の唯一の情報源になる。画面が増減したらまずここを直す。
 *
 * ロール×パスの実際のアクセス可否は src/lib/auth/access-rules.ts
 * （PATH_ACCESS_RULES）が正本。ここの `roles` はそれをそのまま転記したもの
 * なので、access-rules.ts を変更したら整合性を確認すること。
 */

export type UiRole = "admin" | "center" | "vendor";

export type ScreenView = {
  /** 画面グループ内でのビュー名（スクリーンショットのファイル名にも使う） */
  name: string;
  /**
   * Next.js のルートパス（フォルダ名そのまま）。
   * 動的セグメントは `[id]` のようにブラケット表記のまま書く
   * （capture-screenshots.spec.ts が正規表現に変換して実際の href を探す）。
   */
  path: string;
  /** このビューへ到達できるロール */
  roles: UiRole[];
  /**
   * 動的セグメントを含むビュー用。
   * 同じグループ内の別ビュー（通常は一覧）を先に開き、
   * そのページ内のリンクから `path` に一致する href を探して遷移する。
   * ID を直接組み立てない（実データが無い環境でも壊れず、値のハードコーディングも避けられる）。
   */
  discoverFrom?: string;
  /**
   * 別ビューの実URLに文字列を継ぎ足して求まるビュー用
   * （例: 印刷ページ = 詳細ページの URL + "/print"）。
   */
  deriveFrom?: { view: string; suffix: string };
};

export type ScreenGroup = {
  /** スクリーンショットのファイル名プレフィックス・見出しのアンカーに使う */
  slug: string;
  /** マニュアル上の画面名（# 見出しにそのまま使う） */
  title: string;
  views: ScreenView[];
  /** マニュアル執筆時に読むべきソースファイル（web/ からの相対パス） */
  sourceFiles: string[];
};

export const SCREEN_GROUPS: ScreenGroup[] = [
  {
    slug: "login",
    title: "ログイン画面",
    views: [{ name: "login", path: "/login", roles: ["admin", "center", "vendor"] }],
    sourceFiles: [
      "src/app/login/page.tsx",
      "src/app/login/actions.ts",
      "src/components/auth/LoginForm.tsx",
    ],
  },
  {
    slug: "set-password",
    title: "初回パスワード設定画面",
    views: [
      { name: "page", path: "/auth/set-password", roles: ["admin", "center", "vendor"] },
    ],
    sourceFiles: [
      "src/app/auth/set-password/page.tsx",
      "src/app/auth/set-password/actions.ts",
      "src/components/auth/SetPasswordForm.tsx",
    ],
  },
  {
    slug: "home",
    title: "ホーム画面（メニュー）",
    views: [
      { name: "page", path: "/", roles: ["admin", "center", "vendor"] },
      { name: "category", path: "/menu/[key]", roles: ["admin"], discoverFrom: "page" },
    ],
    sourceFiles: [
      "src/app/page.tsx",
      "src/app/menu/[key]/page.tsx",
      "src/lib/auth/ui-capabilities.ts",
    ],
  },
  {
    slug: "requests",
    title: "出庫依頼",
    views: [
      { name: "list", path: "/requests", roles: ["vendor"] },
      { name: "new", path: "/requests/new", roles: ["vendor"] },
      { name: "detail", path: "/requests/[id]", roles: ["vendor"], discoverFrom: "list" },
    ],
    sourceFiles: [
      "src/app/requests/page.tsx",
      "src/app/requests/new/page.tsx",
      "src/app/requests/[id]/page.tsx",
      "src/app/requests/actions.ts",
      "src/components/requests/OrderForm.tsx",
      "src/lib/auth/ui-capabilities.ts",
    ],
  },
  {
    slug: "orders",
    title: "オーダー（確定数量・資材発注書）",
    views: [
      { name: "list", path: "/orders", roles: ["admin", "center"] },
      { name: "detail", path: "/orders/[id]", roles: ["admin", "center"], discoverFrom: "list" },
      {
        name: "print",
        path: "/orders/[id]/print",
        roles: ["admin", "center"],
        deriveFrom: { view: "detail", suffix: "/print" },
      },
    ],
    sourceFiles: [
      "src/app/orders/page.tsx",
      "src/app/orders/[id]/page.tsx",
      "src/app/orders/[id]/print/page.tsx",
      "src/app/orders/actions.ts",
      "src/components/orders/PrintButton.tsx",
    ],
  },
  {
    slug: "products",
    title: "商品マスタ",
    views: [
      { name: "list", path: "/products", roles: ["admin"] },
      { name: "new", path: "/products/new", roles: ["admin"] },
      { name: "edit", path: "/products/[id]/edit", roles: ["admin"], discoverFrom: "list" },
      { name: "categories", path: "/products/categories", roles: ["admin"] },
    ],
    sourceFiles: [
      "src/app/products/page.tsx",
      "src/app/products/new/page.tsx",
      "src/app/products/[id]/edit/page.tsx",
      "src/app/products/categories/page.tsx",
      "src/app/products/actions.ts",
      "src/app/products/categories/actions.ts",
      "src/components/products/ProductForm.tsx",
      "src/components/products/DeleteProductButton.tsx",
    ],
  },
  {
    slug: "sites",
    title: "現場マスタ",
    views: [
      { name: "list", path: "/sites", roles: ["admin"] },
      { name: "new", path: "/sites/new", roles: ["admin"] },
      { name: "edit", path: "/sites/[id]/edit", roles: ["admin"], discoverFrom: "list" },
      { name: "products", path: "/sites/[id]/products", roles: ["admin"], discoverFrom: "list" },
    ],
    sourceFiles: [
      "src/app/sites/page.tsx",
      "src/app/sites/new/page.tsx",
      "src/app/sites/[id]/edit/page.tsx",
      "src/app/sites/[id]/products/page.tsx",
      "src/app/sites/actions.ts",
      "src/app/sites/[id]/products/actions.ts",
      "src/components/sites/SiteForm.tsx",
      "src/components/sites/DeleteSiteButton.tsx",
    ],
  },
  {
    slug: "prime-contractors",
    title: "元請マスタ",
    views: [{ name: "list", path: "/prime-contractors", roles: ["admin"] }],
    sourceFiles: [
      "src/app/prime-contractors/page.tsx",
      "src/app/prime-contractors/actions.ts",
    ],
  },
  {
    slug: "vendors",
    title: "業者管理",
    views: [
      { name: "list", path: "/vendors", roles: ["admin"] },
      { name: "new", path: "/vendors/new", roles: ["admin"] },
      { name: "edit", path: "/vendors/[id]/edit", roles: ["admin"], discoverFrom: "list" },
      { name: "sites", path: "/vendors/[id]/sites", roles: ["admin"], discoverFrom: "list" },
    ],
    sourceFiles: [
      "src/app/vendors/page.tsx",
      "src/app/vendors/new/page.tsx",
      "src/app/vendors/[id]/edit/page.tsx",
      "src/app/vendors/[id]/sites/page.tsx",
      "src/app/vendors/actions.ts",
      "src/app/vendors/[id]/sites/actions.ts",
      "src/components/vendors/VendorForm.tsx",
      "src/components/vendors/VendorSiteForm.tsx",
      "src/components/vendors/DeleteVendorButton.tsx",
      "src/components/vendors/DeleteVendorSiteButton.tsx",
    ],
  },
  {
    slug: "users",
    title: "ユーザー管理",
    views: [
      { name: "list", path: "/users", roles: ["admin"] },
      { name: "new", path: "/users/new", roles: ["admin"] },
      { name: "edit", path: "/users/[id]/edit", roles: ["admin"], discoverFrom: "list" },
    ],
    sourceFiles: [
      "src/app/users/page.tsx",
      "src/app/users/new/page.tsx",
      "src/app/users/[id]/edit/page.tsx",
      "src/app/users/actions.ts",
      "src/components/users/RegisterUserForm.tsx",
      "src/components/users/EditUserForm.tsx",
    ],
  },
  {
    slug: "stock",
    title: "在庫（センター）",
    views: [
      { name: "list", path: "/stock", roles: ["admin", "center"] },
      { name: "new", path: "/stock/new", roles: ["admin"] },
      { name: "edit", path: "/stock/[id]/edit", roles: ["admin"], discoverFrom: "list" },
      { name: "move", path: "/stock/move", roles: ["admin"] },
      { name: "ledger", path: "/stock/ledger", roles: ["admin"] },
    ],
    sourceFiles: [
      "src/app/stock/page.tsx",
      "src/app/stock/new/page.tsx",
      "src/app/stock/[id]/edit/page.tsx",
      "src/app/stock/move/page.tsx",
      "src/app/stock/move/actions.ts",
      "src/app/stock/ledger/page.tsx",
      "src/app/stock/actions.ts",
      "src/components/stock/StockForm.tsx",
      "src/components/stock/StockMovementForm.tsx",
    ],
  },
  {
    slug: "stock-sites",
    title: "現場在庫一覧",
    views: [{ name: "list", path: "/stock/sites", roles: ["admin", "center"] }],
    sourceFiles: ["src/app/stock/sites/page.tsx"],
  },
  {
    slug: "vendor-stock",
    title: "自現場の在庫",
    views: [{ name: "list", path: "/vendor/stock", roles: ["vendor"] }],
    sourceFiles: [
      "src/app/vendor/stock/page.tsx",
      "src/lib/leases/fetch-stock-breakdown.ts",
    ],
  },
  {
    slug: "stock-returns",
    title: "返却登録・返却履歴",
    views: [
      { name: "list", path: "/stock/returns", roles: ["admin"] },
      { name: "new", path: "/stock/returns/new", roles: ["admin"] },
      { name: "edit", path: "/stock/returns/[id]/edit", roles: ["admin"], discoverFrom: "list" },
    ],
    sourceFiles: [
      "src/app/stock/returns/page.tsx",
      "src/app/stock/returns/new/page.tsx",
      "src/app/stock/returns/[id]/edit/page.tsx",
      "src/app/stock/returns/actions.ts",
      "src/components/stock/ReturnStockForm.tsx",
    ],
  },
  {
    slug: "stock-inventory",
    title: "棚卸",
    views: [
      { name: "list", path: "/stock/inventory", roles: ["admin", "center"] },
      { name: "detail", path: "/stock/inventory/[id]", roles: ["admin", "center"], discoverFrom: "list" },
    ],
    sourceFiles: [
      "src/app/stock/inventory/page.tsx",
      "src/app/stock/inventory/[id]/page.tsx",
      "src/app/stock/inventory/actions.ts",
    ],
  },
  {
    slug: "stock-over-returns",
    title: "過入庫一覧",
    views: [{ name: "list", path: "/stock/over-returns", roles: ["admin"] }],
    sourceFiles: [
      "src/app/stock/over-returns/page.tsx",
      "src/app/stock/over-returns/actions.ts",
    ],
  },
  {
    slug: "stock-adjustments",
    title: "在庫調整申請",
    views: [
      { name: "list", path: "/stock/adjustments", roles: ["admin", "vendor"] },
      { name: "new", path: "/stock/adjustments/new", roles: ["vendor"] },
    ],
    sourceFiles: [
      "src/app/stock/adjustments/page.tsx",
      "src/app/stock/adjustments/new/page.tsx",
      "src/app/stock/adjustments/actions.ts",
      "src/components/stock/StockAdjustmentRequestForm.tsx",
    ],
  },
  {
    slug: "stock-progress",
    title: "現場進捗・完工レポート",
    views: [
      { name: "list", path: "/stock/progress", roles: ["admin"] },
      { name: "new", path: "/stock/progress/new", roles: ["admin"] },
      { name: "detail", path: "/stock/progress/[id]", roles: ["admin"], discoverFrom: "list" },
    ],
    sourceFiles: [
      "src/app/stock/progress/page.tsx",
      "src/app/stock/progress/new/page.tsx",
      "src/app/stock/progress/[id]/page.tsx",
      "src/app/stock/progress/actions.ts",
      "src/app/stock/progress/export/route.ts",
    ],
  },
  {
    slug: "stock-outstanding",
    title: "未返却資材一覧",
    views: [{ name: "list", path: "/stock/outstanding", roles: ["admin"] }],
    sourceFiles: ["src/app/stock/outstanding/page.tsx"],
  },
  {
    slug: "purchases",
    title: "仕入れ管理",
    views: [
      { name: "list", path: "/purchases", roles: ["admin"] },
      { name: "new", path: "/purchases/new", roles: ["admin"] },
      { name: "suppliers-list", path: "/purchases/suppliers", roles: ["admin"] },
      { name: "suppliers-new", path: "/purchases/suppliers/new", roles: ["admin"] },
      {
        name: "suppliers-edit",
        path: "/purchases/suppliers/[id]/edit",
        roles: ["admin"],
        discoverFrom: "suppliers-list",
      },
    ],
    sourceFiles: [
      "src/app/purchases/page.tsx",
      "src/app/purchases/new/page.tsx",
      "src/app/purchases/suppliers/page.tsx",
      "src/app/purchases/suppliers/new/page.tsx",
      "src/app/purchases/suppliers/[id]/edit/page.tsx",
      "src/app/purchases/actions.ts",
      "src/app/purchases/suppliers/actions.ts",
      "src/components/purchases/PurchaseForm.tsx",
      "src/components/purchases/SupplierForm.tsx",
      "src/components/purchases/DeleteSupplierButton.tsx",
    ],
  },
  {
    slug: "operations",
    title: "操作履歴",
    views: [{ name: "list", path: "/operations", roles: ["admin"] }],
    sourceFiles: ["src/app/operations/page.tsx"],
  },
  {
    slug: "leases-companies",
    title: "リース会社管理",
    views: [
      { name: "list", path: "/leases/companies", roles: ["admin"] },
      { name: "new", path: "/leases/companies/new", roles: ["admin"] },
      {
        name: "edit",
        path: "/leases/companies/[id]/edit",
        roles: ["admin"],
        discoverFrom: "list",
      },
    ],
    sourceFiles: [
      "src/app/leases/companies/page.tsx",
      "src/app/leases/companies/new/page.tsx",
      "src/app/leases/companies/[id]/edit/page.tsx",
      "src/app/leases/companies/actions.ts",
      "src/components/leases/LeaseCompanyForm.tsx",
      "src/components/leases/DeleteLeaseCompanyButton.tsx",
    ],
  },
  {
    slug: "leases-batches",
    title: "リース借用管理",
    views: [
      { name: "list", path: "/leases/batches", roles: ["admin"] },
      { name: "new", path: "/leases/batches/new", roles: ["admin"] },
      { name: "detail", path: "/leases/batches/[id]", roles: ["admin"], discoverFrom: "list" },
    ],
    sourceFiles: [
      "src/app/leases/batches/page.tsx",
      "src/app/leases/batches/new/page.tsx",
      "src/app/leases/batches/[id]/page.tsx",
      "src/app/leases/batches/actions.ts",
      "src/components/leases/LeaseBatchForm.tsx",
      "src/components/leases/LeaseSectionNav.tsx",
    ],
  },
  {
    slug: "leases-stock",
    title: "リース在庫内訳",
    views: [{ name: "list", path: "/leases/stock", roles: ["admin"] }],
    sourceFiles: [
      "src/app/leases/stock/page.tsx",
      "src/lib/leases/fetch-stock-breakdown.ts",
    ],
  },
  {
    slug: "leases-due",
    title: "返却期限・未返却",
    views: [{ name: "list", path: "/leases/due", roles: ["admin"] }],
    sourceFiles: ["src/app/leases/due/page.tsx"],
  },
  {
    slug: "plans",
    title: "予定数量",
    views: [
      { name: "list", path: "/plans", roles: ["admin", "vendor"] },
      { name: "new", path: "/plans/new", roles: ["admin"] },
      { name: "edit", path: "/plans/[id]/edit", roles: ["admin"], discoverFrom: "list" },
    ],
    sourceFiles: [
      "src/app/plans/page.tsx",
      "src/app/plans/new/page.tsx",
      "src/app/plans/[id]/edit/page.tsx",
      "src/app/plans/actions.ts",
      "src/components/plans/PlanBulkForm.tsx",
      "src/components/plans/DeleteSiteProductPlanButton.tsx",
    ],
  },
  {
    slug: "plans-over",
    title: "予定数量超過の確認",
    views: [{ name: "list", path: "/plans/over", roles: ["admin"] }],
    sourceFiles: [
      "src/app/plans/over/page.tsx",
      "src/lib/plans/fetch-over-plan.ts",
    ],
  },
  {
    slug: "plans-lot-size",
    title: "半端もんの確認",
    views: [{ name: "list", path: "/plans/lot-size", roles: ["admin"] }],
    sourceFiles: [
      "src/app/plans/lot-size/page.tsx",
      "src/lib/plans/fetch-lot-size-status.ts",
    ],
  },
  {
    slug: "analytics",
    title: "分析ダッシュボード",
    views: [
      { name: "dashboard", path: "/analytics", roles: ["admin"] },
      { name: "period", path: "/analytics/period", roles: ["admin"] },
      { name: "products", path: "/analytics/products", roles: ["admin"] },
      { name: "sites", path: "/analytics/sites", roles: ["admin"] },
      { name: "leases", path: "/analytics/leases", roles: ["admin"] },
    ],
    sourceFiles: [
      "src/app/analytics/page.tsx",
      "src/app/analytics/period/page.tsx",
      "src/app/analytics/products/page.tsx",
      "src/app/analytics/sites/page.tsx",
      "src/app/analytics/leases/page.tsx",
      "src/app/analytics/period/export/route.ts",
      "src/app/analytics/products/export/route.ts",
      "src/app/analytics/sites/export/route.ts",
      "src/app/analytics/leases/export/route.ts",
      "src/components/analytics/AnalyticsNav.tsx",
      "src/lib/analytics/fetch-movement-summary.ts",
    ],
  },
];
