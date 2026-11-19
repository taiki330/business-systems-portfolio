import { extend } from './fixtures-extra.mjs';
/** ダミーデータ(すべて架空)。モック Supabase が返す。 */
const id = (p, n) => `${p}-${String(n).padStart(4, '0')}`;
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const date = (n) => days(n).slice(0, 10);

export const ADMIN_ID = '00000000-0000-4000-8000-000000000001';

const mkUser = (uid, email) => ({ id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: days(-200) });
export const CENTER_USER_ID = '00000000-0000-4000-8000-000000000002';
export const VENDOR_USER_ID = '00000000-0000-4000-8000-000000000003';
export const users = {
  admin: mkUser(ADMIN_ID, 'admin@example.com'),
  center: mkUser(CENTER_USER_ID, 'center@example.com'),
  vendor: mkUser(VENDOR_USER_ID, 'vendor@example.com'),
};

const centers = [
  { id: id('c', 1), code: 'kansai', name: 'サンプル市Aセンター', stock_location: 'center' },
  { id: id('c', 2), code: 'kanto', name: 'サンプル市Bセンター', stock_location: 'center_kanto' },
  { id: id('c', 3), code: 'kyushu', name: 'サンプル市Cセンター', stock_location: 'center_kyushu' },
];

const categories = [
  { id: id('cat', 1), name: '単管' },
  { id: id('cat', 2), name: '枠組足場' },
  { id: id('cat', 3), name: 'クサビ式' },
  { id: id('cat', 4), name: '踏板' },
  { id: id('cat', 5), name: '付属品' },
  { id: id('cat', 6), name: '養生' },
];

const productDefs = [
  ['T-001', '単管パイプ 3.0m', '本', 1, 5, 4.4],
  ['T-002', '単管パイプ 2.0m', '本', 1, 5, 2.9],
  ['T-003', '単管パイプ 1.0m', '本', 1, 5, 1.5],
  ['W-101', '建枠 1700', '枚', 2, 1, 12.5],
  ['W-102', '建枠 1200', '枚', 2, 1, 10.2],
  ['W-103', '筋交い 1829', '本', 2, 5, 3.1],
  ['K-201', 'クサビ式 支柱 3.0m', '本', 3, 1, 14.0],
  ['K-202', 'クサビ式 ブラケット 600', '個', 3, 10, 2.4],
  ['K-203', 'クサビ式 ブラケット 900', '個', 3, 10, 3.0],
  ['B-301', 'アンチ(踏板) 1829', '枚', 4, 1, 9.8],
  ['B-302', 'アンチ(踏板) 1219', '枚', 4, 1, 6.6],
  ['A-401', '壁つなぎ', '個', 5, 20, 0.9],
  ['A-402', 'ジャッキベース', '個', 5, 20, 2.1],
  ['A-403', '直交クランプ', '個', 5, 50, 0.7],
  ['A-404', '自在クランプ', '個', 5, 50, 0.8],
  ['Y-501', '養生シート 1.8×5.1m', '枚', 6, 10, 3.5],
  ['Y-502', '合板 12mm', '枚', 6, 1, 14.0],
];
const products = productDefs.map(([code, name, unit, cat, lot, w], i) => ({
  id: id('p', i + 1), code, name, unit,
  category_id: id('cat', cat), lot_size: lot, weight_kg: w,
  created_at: days(-300), updated_at: days(-30),
  product_categories: undefined,
}));

const siteDefs = [
  ['S-001', 'A市 新築マンション工事', 1], ['S-002', 'B町 店舗改修', 1],
  ['S-003', 'C区 工場増築', 1], ['S-004', 'D町 戸建て 3 棟', 1],
  ['S-005', 'E市 倉庫新築', 1], ['S-006', 'F市 マンション改修', 1],
  ['S-007', 'G町 事務所ビル', 1], ['S-008', 'H区 学校体育館', 1],
];
const sites = siteDefs.map(([code, name, c], i) => ({
  id: id('s', i + 1), code, name, address: `サンプル県サンプル市${i + 1}-2-3`,
  prime_contractor_id: id('pc', (i % 3) + 1), slip_site_number: 100 + i,
  center_id: id('c', c), allow_partial_lot_default: false,
  created_at: days(-200), updated_at: days(-20),
}));

// センター在庫 / 現場在庫
const stock_items = [];
products.forEach((p, i) => {
  stock_items.push({ id: id('si', i + 1), product_id: p.id, location: 'center', quantity: [1240, 860, 420, 318, 240, 190, 96, 410, 150, 540, 320, 28, 75, 880, 640, 120, 410][i], storage_kind: 'center', site_id: null });
});
let sn = 100;
sites.slice(0, 6).forEach((s, si) => {
  products.slice(0, 7 + si).forEach((p, pi) => {
    stock_items.push({ id: id('si', ++sn), product_id: p.id, location: s.name, quantity: 20 + ((si * 37 + pi * 53) % 260), storage_kind: 'site', site_id: s.id });
  });
});

// 出庫依頼
const reqStatus = ['requested', 'requested', 'requested', 'accepted', 'accepted', 'shipped', 'shipped', 'shipped', 'cancelled'];
const orders = sites.map((s, i) => ({
  id: id('o', i + 1), site_id: s.id, order_number: String(20261100 + 10 + i),
  requested_by: ADMIN_ID, created_at: days(-i - 1), delivery_deadline: date(i + 2),
  yard_loading_date: i % 2 ? date(i + 1) : null, approved_at: i < 5 ? days(-i) : null,
  site_name_snapshot: s.name,
}));
const stock_requests = [];
let rn = 0;
orders.forEach((o, oi) => {
  for (let k = 0; k < 2 + (oi % 4); k++) {
    const p = products[(oi * 3 + k * 2) % products.length];
    const status = reqStatus[(oi + k) % reqStatus.length];
    stock_requests.push({
      id: id('r', ++rn), order_id: o.id, site_id: o.site_id, product_id: p.id,
      quantity: [120, 48, 60, 200, 80, 150, 30, 24][(rn) % 8], status,
      requested_at: days(-oi - 1 - k / 10), accepted_at: status === 'requested' ? null : days(-oi),
      shipped_at: status === 'shipped' ? days(-oi + 0.5) : null, cancelled_at: status === 'cancelled' ? days(-oi) : null,
      original_quantity: null, ownership_override: null,
      note: ['午前着希望', null, '搬入口は東側', null, '至急', null][rn % 6],
    });
  }
});

// リース
const lease_companies = [
  { id: id('lc', 1), name: 'サンプルリース(株)', created_at: days(-300) },
  { id: id('lc', 2), name: 'サンプル機材レンタル', created_at: days(-300) },
];
const lease_batches = [
  { id: id('lb', 1), lease_company_id: id('lc', 1), slip_number: 'L-2610-014', borrowed_at: date(-36), status: 'active' },
  { id: id('lb', 2), lease_company_id: id('lc', 2), slip_number: 'L-2610-021', borrowed_at: date(-33), status: 'active' },
  { id: id('lb', 3), lease_company_id: id('lc', 1), slip_number: 'L-2611-003', borrowed_at: date(-18), status: 'active' },
  { id: id('lb', 4), lease_company_id: id('lc', 2), slip_number: 'L-2611-007', borrowed_at: date(-15), status: 'active' },
  { id: id('lb', 5), lease_company_id: id('lc', 1), slip_number: 'L-2611-012', borrowed_at: date(-10), status: 'active' },
];
const li = (n, b, p, q, rec, ret, due) => ({
  id: id('lbi', n), lease_batch_id: id('lb', b), product_id: id('p', p), quantity: q,
  received_quantity: rec, returned_quantity: ret, return_obligation_quantity: rec - ret,
  return_due_date: due, unreturned_quantity: q - ret,
});
const lease_batch_items = [
  li(1, 1, 4, 200, 200, 120, date(-5)), li(2, 2, 8, 150, 150, 90, date(-2)),
  li(3, 3, 10, 300, 300, 100, date(0)), li(4, 4, 1, 500, 480, 0, date(6)),
  li(5, 5, 13, 120, 120, 0, date(21)), li(6, 5, 12, 60, 60, 0, date(21)),
];

// 未返却(ビュー)
const own = ['owned', 'lease'];
const site_material_outstanding = [
  [6, 4, 'owned', 120, 96], [6, 1, 'owned', 300, 280], [7, 10, 'leased', 200, 140], [7, 12, 'owned', 80, 52],
  [8, 13, 'owned', 90, 70], [5, 4, 'owned', 150, 100], [5, 11, 'owned', 60, 35], [4, 1, 'owned', 200, 150],
].map(([s, p, o, ship, ret]) => ({
  site_id: id('s', s), product_id: id('p', p), ownership: o, shipped_quantity: ship,
  returned_quantity: ret, outstanding_quantity: ship - ret, over_return_quantity: 0, site_quantity: ship - ret,
}));
const site_progress_latest = [
  { site_id: id('s', 6), kind: 'dismantle_completed', occurred_on: date(-9) },
  { site_id: id('s', 7), kind: 'dismantle_completed', occurred_on: date(-14) },
  { site_id: id('s', 8), kind: 'dismantle_completed', occurred_on: date(-21) },
];

export const tables = {
  app_users: [
    { id: ADMIN_ID, role: 'admin', display_name: '管理者(サンプル)', vendor_id: null, site_id: null, center_id: null },
    { id: CENTER_USER_ID, role: 'center', display_name: 'サンプル市Aセンター', vendor_id: null, site_id: null, center_id: id('c', 1) },
    { id: VENDOR_USER_ID, role: 'vendor', display_name: '現場担当(サンプル)', vendor_id: null, site_id: id('s', 1), center_id: null },
  ],
  app_user_sites: [{ user_id: VENDOR_USER_ID, site_id: id('s', 1) }],
  centers,
  product_categories: categories,
  products: products.map((p) => ({ ...p })),
  sites,
  prime_contractors: [
    { id: id('pc', 1), name: 'サンプル建設工業', code: 'PC-01' },
    { id: id('pc', 2), name: 'サンプルホームズ', code: 'PC-02' },
    { id: id('pc', 3), name: 'サンプル開発', code: 'PC-03' },
  ],
  stock_items, orders, stock_requests,
  lease_companies, lease_batches, lease_batch_items,
  lease_stock_items: [], site_material_outstanding, site_progress_latest,
  vendors: [], suppliers: [], vendor_sites: [], site_products: [], site_product_plans: [],
  site_product_plan_status: [], stock_request_plan_status: [], stock_request_lot_size_status: [],
  stock_ledger: [], stock_returns: [], over_returns: [], operation_logs: [],
  stock_adjustment_requests: [], inventory_counts: [], center_transfers: [],
};

const extra = extend(tables, { ADMIN_ID, CENTER_USER_ID, VENDOR_USER_ID });

export const rpc = {
  ...extra,
  resolve_display_names: () => [{ id: ADMIN_ID, display_name: '管理者(サンプル)' }],
  get_stock_history_archive_cutoff: () => null,
  get_order_requester_label: () => '管理者(サンプル)',
};
