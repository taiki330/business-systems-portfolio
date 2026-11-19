/** 撮影する画面の一覧。name は出力ファイル名(連番-名前)。 */
export const SHOTS = [
  // ---- 事務(管理者) ----
  { role: 'admin', name: 'admin-01-home', path: '/' },
  { role: 'admin', name: 'admin-02-menu-stock', path: '/menu/stock' },
  { role: 'admin', name: 'admin-03-stock', path: '/stock' },
  { role: 'admin', name: 'admin-04-stock-sites', path: '/stock/sites' },
  { role: 'admin', name: 'admin-05-orders', path: '/orders' },
  { role: 'admin', name: 'admin-06-order-detail', path: '/orders/o-0001' },
  { role: 'admin', name: 'admin-07-order-print', path: '/orders/o-0001/print' },
  { role: 'admin', name: 'admin-08-outstanding', path: '/stock/outstanding' },
  { role: 'admin', name: 'admin-09-progress', path: '/stock/progress' },
  { role: 'admin', name: 'admin-10-ledger', path: '/stock/ledger' },
  { role: 'admin', name: 'admin-11-returns', path: '/stock/returns' },
  { role: 'admin', name: 'admin-12-lease-due', path: '/leases/due' },
  { role: 'admin', name: 'admin-13-lease-batches', path: '/leases/batches' },
  { role: 'admin', name: 'admin-14-lease-stock', path: '/leases/stock' },
  { role: 'admin', name: 'admin-15-plans', path: '/plans' },
  { role: 'admin', name: 'admin-16-analytics', path: '/analytics' },
  { role: 'admin', name: 'admin-17-analytics-sites', path: '/analytics/sites' },
  { role: 'admin', name: 'admin-18-products', path: '/products' },
  { role: 'admin', name: 'admin-19-sites', path: '/sites' },
  { role: 'admin', name: 'admin-20-users', path: '/users' },
  // ---- 現場(業者) ----
  { role: 'vendor', name: 'vendor-01-home', path: '/' },
  { role: 'vendor', name: 'vendor-02-requests', path: '/requests' },
  { role: 'vendor', name: 'vendor-03-request-new', path: '/requests/new' },
  { role: 'vendor', name: 'vendor-04-request-detail', path: '/requests/r-0001' },
  { role: 'vendor', name: 'vendor-05-site-stock', path: '/vendor/stock' },
  // ---- センター ----
  { role: 'center', name: 'center-01-home', path: '/' },
  { role: 'center', name: 'center-02-orders', path: '/orders' },
  { role: 'center', name: 'center-03-stock', path: '/stock' },
];

/** 試し撮り用(PROBE=1)。崩れる画面を洗い出すための候補。 */
export const PROBE = [
  ...['/menu/stock', '/menu/lease', '/menu/plan', '/menu/master', '/sites', '/sites/s-0001/products', '/vendors', '/users', '/plans', '/plans/over', '/plans/lot-size',
    '/analytics', '/analytics/sites', '/analytics/products', '/analytics/period', '/stock/sites', '/stock/summary', '/stock/returns', '/stock/adjustments',
    '/stock/progress', '/stock/ledger', '/stock/transfers', '/stock/inventory', '/stock/over-returns', '/leases/batches', '/leases/batches/lb-0001',
    '/leases/stock', '/leases/companies', '/orders/o-0001', '/orders/o-0001/print', '/purchases', '/operations', '/prime-contractors', '/centers', '/history-archive']
    .map((p) => ({ role: 'admin', name: 'a' + p.replace(/\W+/g, '_'), path: p })),
  ...['/requests/new', '/requests/r-0001', '/vendor/stock', '/stock/adjustments', '/stock/adjustments/new', '/plans', '/']
    .map((p) => ({ role: 'vendor', name: 'v' + p.replace(/\W+/g, '_'), path: p })),
];
