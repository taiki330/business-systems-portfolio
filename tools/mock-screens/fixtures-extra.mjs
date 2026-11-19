/** 管理画面・現場画面用の追加ダミーデータ(すべて架空)。fixtures.mjs から呼ばれる。 */
export function extend(tables, { ADMIN_ID, CENTER_USER_ID, VENDOR_USER_ID }) {
  const id = (p, n) => `${p}-${String(n).padStart(4, '0')}`;
  const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
  const date = (n) => days(n).slice(0, 10);
  const { products, sites } = tables;
  const pick = (arr, n) => arr[n % arr.length];

  tables.vendors = [
    { id: id('v', 1), name: 'サンプル足場工業', note: '主に関西エリア', created_at: days(-300), updated_at: days(-40) },
    { id: id('v', 2), name: 'サンプル仮設', note: null, created_at: days(-280), updated_at: days(-40) },
    { id: id('v', 3), name: 'サンプルテック', note: '解体専門', created_at: days(-250), updated_at: days(-40) },
  ];
  tables.vendor_sites = sites.slice(0, 5).map((s, i) => ({ id: id('vs', i + 1), vendor_id: id('v', (i % 3) + 1), site_id: s.id }));

  // 現場別 予定数量
  tables.site_product_plan_status = [];
  sites.slice(0, 5).forEach((s, si) => {
    products.slice(0, 4).forEach((p, pi) => {
      const planned = [400, 250, 120, 600][pi] + si * 20;
      const shipped = Math.round(planned * (0.5 + ((si + pi) % 4) * 0.19));
      const over = Math.max(0, shipped + 10 - planned);
      tables.site_product_plan_status.push({
        plan_id: id('pl', si * 10 + pi + 1), site_id: s.id, product_id: p.id, planned_quantity: planned,
        shipped_quantity: shipped, current_site_quantity: shipped - 20, pending_quantity: 10,
        expected_quantity: shipped + 10, over_quantity: over, is_over: over > 0, note: null, updated_at: days(-pi),
      });
    });
  });

  // 自社/リース判定・リース在庫内訳
  tables.product_ownership_kind = products.map((p, i) => ({ product_id: p.id, ownership_kind: [4, 10].includes(i + 1) ? 'leased' : 'owned' }));
  const mb = (n, o, p, lc, bi, slip, bor, due, ob, kind, site, loc, q) => ({
    row_id: `mb-${n}`, ownership: o, product_id: id('p', p), lease_company_id: lc ? id('lc', lc) : null,
    lease_company_name: lc ? 'サンプルリース(株)' : null, lease_batch_item_id: bi ? id('lbi', bi) : null, slip_number: slip,
    borrowed_at: bor, return_due_date: due, return_obligation_quantity: ob, storage_kind: kind,
    site_id: site ? id('s', site) : null, location: loc, quantity: q,
  });
  tables.material_stock_breakdown = [
    mb(1, 'leased', 4, 1, 1, 'L-2610-014', date(-36), date(-5), 80, 'center', 0, 'center', 40),
    mb(2, 'leased', 4, 1, 1, 'L-2610-014', date(-36), date(-5), 80, 'site', 1, 'A市 新築マンション工事', 40),
    mb(3, 'leased', 10, 1, 3, 'L-2611-003', date(-18), date(0), 200, 'site', 2, 'B町 店舗改修', 200),
    mb(4, 'owned', 1, 0, 0, null, null, null, 0, 'site', 1, 'A市 新築マンション工事', 260),
    mb(5, 'owned', 1, 0, 0, null, null, null, 0, 'center', 0, 'center', 1240),
  ];

  // 在庫履歴・返却履歴
  tables.stock_ledger = Array.from({ length: 24 }, (_, i) => ({
    id: id('sl', i + 1), product_id: pick(products, i * 3).id, location: i % 3 ? 'center' : sites[i % 6].name,
    movement_type: i % 3 === 1 ? 'in' : 'out', quantity: [120, 48, 60, 200, 80, 30][i % 6], created_at: days(-i * 0.7),
  }));
  tables.stock_returns = Array.from({ length: 8 }, (_, i) => ({
    id: id('sr', i + 1), site_id: sites[i % 6].id, product_id: pick(products, i * 2).id, quantity: [40, 25, 60, 12, 80, 30, 18, 50][i],
    memo: [null, '養生シートは破損あり', null, '一部リース品を含む'][i % 4], created_at: days(-i - 1), corrected_at: null,
  }));

  // 現場進捗
  const ev = (n, s, kind, d, note) => ({ id: id('ev', n), site_id: id('s', s), kind, occurred_on: date(d), recorded_at: days(d + 1), recorded_by: ADMIN_ID, note });
  tables.site_progress_events = [
    ev(1, 6, 'dismantle_completed', -9, '全撤去完了'), ev(2, 7, 'dismantle_completed', -14, null),
    ev(3, 1, 'assembly_completed', -20, '1〜5 階 組立完了'), ev(4, 2, 'dismantle_started', -3, null),
    ev(5, 8, 'dismantle_completed', -21, null),
  ];
  tables.site_progress_snapshot_items = tables.site_progress_events.flatMap((e, ei) =>
    [1, 4, 10].map((pn, k) => ({
      id: id('sp', ei * 3 + k), site_progress_event_id: e.id, product_id: id('p', pn), ownership: 'owned',
      shipped_quantity: 200 - k * 40, returned_quantity: 150 - k * 30, outstanding_quantity: 50 - k * 10,
      over_return_quantity: 0, site_quantity: 50 - k * 10,
    })));

  tables.stock_purchases = [];
  tables.suppliers = [{ id: id('sup', 1), name: 'サンプル資材商会', code: 'SUP-01', note: null, created_at: days(-300), updated_at: days(-40) }];

  const user = (uid, email, role, name, extra) => ({
    id: uid, email, role, display_name: name, vendor_id: null, site_id: null, site_name: null, site_ids: [], site_names: [],
    center_id: null, center_name: null, created_at: days(-120), updated_at: days(-20), ...extra,
  });
  return {
    analytics_product_utilization: () => [],
    get_order_plan_status: () => [],
    list_app_users: () => [
      user(ADMIN_ID, 'admin@example.com', 'admin', '管理者(サンプル)'),
      user(CENTER_USER_ID, 'center-a@example.com', 'center', 'サンプル市Aセンター', { center_id: id('c', 1), center_name: 'サンプル市Aセンター' }),
      user(VENDOR_USER_ID, 'genba-a@example.com', 'vendor', '現場担当(サンプル)', { site_id: id('s', 1), site_name: sites[0].name, site_ids: [id('s', 1)], site_names: [sites[0].name] }),
    ],
    analytics_dashboard: () => [{ this_month: date(0).slice(0, 8) + '01', this_shipped: 3820, prev_shipped: 3410, this_returned: 2975, prev_returned: 3120, site_stock_owned: 9365, lease_outstanding: 1040, overdue_lease_count: 2, over_plan_count: 3 }],
    analytics_period_summary: () => ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((p, i) => ({ period: p, shipped_quantity: 2800 + i * 260, returned_quantity: 2500 + i * 190, net_quantity: 300 + i * 70, lease_received_quantity: 400 + i * 30, lease_returned_to_company: 350 + i * 20, site_count: 5 + (i % 3), request_count: 22 + i * 4 })),
    analytics_site_summary: () => sites.slice(0, 7).map((s, i) => ({ site_id: s.id, site_name: s.name, shipped_quantity: 1800 - i * 190, returned_quantity: 1200 - i * 120, current_stock: 600 - i * 70, pending_requests: i % 3, planned_total: 2000 - i * 150, over_quantity: i === 2 ? 40 : 0 })),
    analytics_product_summary: () => products.slice(0, 8).map((p, i) => ({ product_id: p.id, product_code: p.code, product_name: p.name, product_unit: p.unit, shipped_quantity: 1600 - i * 150, shipped_owned: 1300 - i * 120, shipped_leased: 300 - i * 30, returned_quantity: 1200 - i * 110, current_stock: 400 - i * 40, current_owned: 320 - i * 30, current_leased: 80 - i * 10, using_site_count: 6 - (i % 4), planned_total: 1800 - i * 140, over_quantity: i === 3 ? 30 : 0 })),
  };
}
