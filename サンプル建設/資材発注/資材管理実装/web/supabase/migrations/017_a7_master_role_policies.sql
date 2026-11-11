-- 017_a7_master_role_policies.sql
-- 016 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-7-DB-2: マスタ群（customers/products/sites/site_products/vendors/vendor_sites）の
-- authenticated policy を role 別に分割する。
-- 詳細設計: docs/13 §13-12 / A-7 §7-2
--
-- 適用前の実 DB 確認結果（2026-06-01）:
--   - 各マスタ authenticated policy: customers=4, products=4, sites=4, site_products=4,
--     vendors=1(SELECT only), vendor_sites=1(SELECT only)
--   - anon は全テーブル 0 件（A-6 完了）
--   - FK 構造は想定どおり
--
-- 設計方針:
--   - 既存 *_authenticated_* policy を drop し、internal 用 policy と vendor 用 policy に分割
--   - INSERT/UPDATE/DELETE は internal のみ（vendor 用 policy は作らない）
--   - SELECT のみ vendor 用 policy を作成（テーブルごとに可視範囲を限定）
--     - customers:     vendor SELECT なし（internal のみ）
--     - products:      vendor SELECT 全件可
--     - sites:         vendor は vendor_sites 経由
--     - site_products: vendor は site_products.site_id → vendor_sites 経由
--     - vendors:       vendor は自社のみ
--     - vendor_sites:  vendor は自分の紐付けのみ
--   - 二重防御: Server Action / middleware と並走（A-7-app-1 で実装）
--   - anon には何も触れない（A-6 完了）

begin;

-- ===========================================================================
-- 1) customers : internal のみ全権（vendor 一切不可）
-- ===========================================================================
drop policy if exists "customers_authenticated_select" on public.customers;
drop policy if exists "customers_authenticated_insert" on public.customers;
drop policy if exists "customers_authenticated_update" on public.customers;
drop policy if exists "customers_authenticated_delete" on public.customers;

create policy "customers_internal_select"
  on public.customers for select to authenticated
  using (public.current_app_role() = 'internal');
create policy "customers_internal_insert"
  on public.customers for insert to authenticated
  with check (public.current_app_role() = 'internal');
create policy "customers_internal_update"
  on public.customers for update to authenticated
  using (public.current_app_role() = 'internal')
  with check (public.current_app_role() = 'internal');
create policy "customers_internal_delete"
  on public.customers for delete to authenticated
  using (public.current_app_role() = 'internal');

-- ===========================================================================
-- 2) products : internal 全権 / vendor は SELECT 全件可
-- ===========================================================================
drop policy if exists "products_authenticated_select" on public.products;
drop policy if exists "products_authenticated_insert" on public.products;
drop policy if exists "products_authenticated_update" on public.products;
drop policy if exists "products_authenticated_delete" on public.products;

create policy "products_internal_select"
  on public.products for select to authenticated
  using (public.current_app_role() = 'internal');
create policy "products_internal_insert"
  on public.products for insert to authenticated
  with check (public.current_app_role() = 'internal');
create policy "products_internal_update"
  on public.products for update to authenticated
  using (public.current_app_role() = 'internal')
  with check (public.current_app_role() = 'internal');
create policy "products_internal_delete"
  on public.products for delete to authenticated
  using (public.current_app_role() = 'internal');

create policy "products_vendor_select"
  on public.products for select to authenticated
  using (public.current_app_role() = 'vendor');

-- ===========================================================================
-- 3) sites : internal 全権 / vendor は vendor_sites 経由で担当現場のみ SELECT
-- ===========================================================================
drop policy if exists "sites_authenticated_select" on public.sites;
drop policy if exists "sites_authenticated_insert" on public.sites;
drop policy if exists "sites_authenticated_update" on public.sites;
drop policy if exists "sites_authenticated_delete" on public.sites;

create policy "sites_internal_select"
  on public.sites for select to authenticated
  using (public.current_app_role() = 'internal');
create policy "sites_internal_insert"
  on public.sites for insert to authenticated
  with check (public.current_app_role() = 'internal');
create policy "sites_internal_update"
  on public.sites for update to authenticated
  using (public.current_app_role() = 'internal')
  with check (public.current_app_role() = 'internal');
create policy "sites_internal_delete"
  on public.sites for delete to authenticated
  using (public.current_app_role() = 'internal');

create policy "sites_vendor_select"
  on public.sites for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and exists (
      select 1
        from public.vendor_sites vs
       where vs.vendor_id = public.current_vendor_id()
         and vs.site_id   = sites.id
    )
  );

-- ===========================================================================
-- 4) site_products : internal 全権 / vendor は site_id → vendor_sites 経由で SELECT
-- ===========================================================================
drop policy if exists "site_products_authenticated_select" on public.site_products;
drop policy if exists "site_products_authenticated_insert" on public.site_products;
drop policy if exists "site_products_authenticated_update" on public.site_products;
drop policy if exists "site_products_authenticated_delete" on public.site_products;

create policy "site_products_internal_select"
  on public.site_products for select to authenticated
  using (public.current_app_role() = 'internal');
create policy "site_products_internal_insert"
  on public.site_products for insert to authenticated
  with check (public.current_app_role() = 'internal');
create policy "site_products_internal_update"
  on public.site_products for update to authenticated
  using (public.current_app_role() = 'internal')
  with check (public.current_app_role() = 'internal');
create policy "site_products_internal_delete"
  on public.site_products for delete to authenticated
  using (public.current_app_role() = 'internal');

create policy "site_products_vendor_select"
  on public.site_products for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and exists (
      select 1
        from public.vendor_sites vs
       where vs.vendor_id = public.current_vendor_id()
         and vs.site_id   = site_products.site_id
    )
  );

-- ===========================================================================
-- 5) vendors : internal 全権 / vendor は自社のみ SELECT
-- ===========================================================================
drop policy if exists "vendors_authenticated_select" on public.vendors;

create policy "vendors_internal_select"
  on public.vendors for select to authenticated
  using (public.current_app_role() = 'internal');
create policy "vendors_internal_insert"
  on public.vendors for insert to authenticated
  with check (public.current_app_role() = 'internal');
create policy "vendors_internal_update"
  on public.vendors for update to authenticated
  using (public.current_app_role() = 'internal')
  with check (public.current_app_role() = 'internal');
create policy "vendors_internal_delete"
  on public.vendors for delete to authenticated
  using (public.current_app_role() = 'internal');

create policy "vendors_vendor_select"
  on public.vendors for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and id = public.current_vendor_id()
  );

-- ===========================================================================
-- 6) vendor_sites : internal 全権 / vendor は自分の紐付けのみ SELECT
-- ===========================================================================
drop policy if exists "vendor_sites_authenticated_select" on public.vendor_sites;

create policy "vendor_sites_internal_select"
  on public.vendor_sites for select to authenticated
  using (public.current_app_role() = 'internal');
create policy "vendor_sites_internal_insert"
  on public.vendor_sites for insert to authenticated
  with check (public.current_app_role() = 'internal');
create policy "vendor_sites_internal_update"
  on public.vendor_sites for update to authenticated
  using (public.current_app_role() = 'internal')
  with check (public.current_app_role() = 'internal');
create policy "vendor_sites_internal_delete"
  on public.vendor_sites for delete to authenticated
  using (public.current_app_role() = 'internal');

create policy "vendor_sites_vendor_select"
  on public.vendor_sites for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and vendor_id = public.current_vendor_id()
  );

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用前の確認 SQL（任意）
-- ---------------------------------------------------------------------------
-- select tablename, count(*) as auth_policies
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('customers','products','sites','site_products','vendors','vendor_sites')
--    and roles::text like '%authenticated%'
--  group by tablename
--  order by tablename;
-- -- 期待: customers=4, products=4, sites=4, site_products=4, vendors=1, vendor_sites=1
--
-- select p.proname from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public'
--    and p.proname in ('current_app_role','current_vendor_id');
-- -- 期待: 2 行（A-7-DB-1 完了確認）

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意）
-- ---------------------------------------------------------------------------
-- -- (a) 各マスタの policy 数（internal 用 + vendor 用）
-- select tablename, count(*) as auth_policies,
--        count(*) filter (where policyname like '%internal%') as internal_cnt,
--        count(*) filter (where policyname like '%vendor%')   as vendor_cnt
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('customers','products','sites','site_products','vendors','vendor_sites')
--    and roles::text like '%authenticated%'
--  group by tablename
--  order by tablename;
-- -- 期待:
-- --   customers      auth=4 internal=4 vendor=0
-- --   products       auth=5 internal=4 vendor=1
-- --   sites          auth=5 internal=4 vendor=1
-- --   site_products  auth=5 internal=4 vendor=1
-- --   vendors        auth=5 internal=4 vendor=1
-- --   vendor_sites   auth=5 internal=4 vendor=1
--
-- -- (b) 旧 *_authenticated_* policy が消えていること
-- select tablename, policyname
--   from pg_policies
--  where schemaname='public'
--    and policyname like '%_authenticated_%'
--    and tablename in ('customers','products','sites','site_products','vendors','vendor_sites');
-- -- 期待: 0 行
--
-- -- (c) anon は依然として 0 件（A-6 状態維持）
-- select count(*) as anon_policy_cnt
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('customers','products','sites','site_products','vendors','vendor_sites')
--    and roles::text like '%anon%';
-- -- 期待: 0
--
-- -- (d) テーブルデータは無変更
-- select 'customers' as t, count(*) from public.customers
-- union all select 'products', count(*) from public.products
-- union all select 'sites', count(*) from public.sites
-- union all select 'site_products', count(*) from public.site_products
-- union all select 'vendors', count(*) from public.vendors
-- union all select 'vendor_sites', count(*) from public.vendor_sites;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（A-7-DB-2 を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- -- customers
-- drop policy if exists "customers_internal_select" on public.customers;
-- drop policy if exists "customers_internal_insert" on public.customers;
-- drop policy if exists "customers_internal_update" on public.customers;
-- drop policy if exists "customers_internal_delete" on public.customers;
-- create policy "customers_authenticated_select" on public.customers for select to authenticated using (true);
-- create policy "customers_authenticated_insert" on public.customers for insert to authenticated with check (true);
-- create policy "customers_authenticated_update" on public.customers for update to authenticated using (true) with check (true);
-- create policy "customers_authenticated_delete" on public.customers for delete to authenticated using (true);
--
-- -- products
-- drop policy if exists "products_internal_select" on public.products;
-- drop policy if exists "products_internal_insert" on public.products;
-- drop policy if exists "products_internal_update" on public.products;
-- drop policy if exists "products_internal_delete" on public.products;
-- drop policy if exists "products_vendor_select"   on public.products;
-- create policy "products_authenticated_select" on public.products for select to authenticated using (true);
-- create policy "products_authenticated_insert" on public.products for insert to authenticated with check (true);
-- create policy "products_authenticated_update" on public.products for update to authenticated using (true) with check (true);
-- create policy "products_authenticated_delete" on public.products for delete to authenticated using (true);
--
-- -- sites
-- drop policy if exists "sites_internal_select" on public.sites;
-- drop policy if exists "sites_internal_insert" on public.sites;
-- drop policy if exists "sites_internal_update" on public.sites;
-- drop policy if exists "sites_internal_delete" on public.sites;
-- drop policy if exists "sites_vendor_select"   on public.sites;
-- create policy "sites_authenticated_select" on public.sites for select to authenticated using (true);
-- create policy "sites_authenticated_insert" on public.sites for insert to authenticated with check (true);
-- create policy "sites_authenticated_update" on public.sites for update to authenticated using (true) with check (true);
-- create policy "sites_authenticated_delete" on public.sites for delete to authenticated using (true);
--
-- -- site_products
-- drop policy if exists "site_products_internal_select" on public.site_products;
-- drop policy if exists "site_products_internal_insert" on public.site_products;
-- drop policy if exists "site_products_internal_update" on public.site_products;
-- drop policy if exists "site_products_internal_delete" on public.site_products;
-- drop policy if exists "site_products_vendor_select"   on public.site_products;
-- create policy "site_products_authenticated_select" on public.site_products for select to authenticated using (true);
-- create policy "site_products_authenticated_insert" on public.site_products for insert to authenticated with check (true);
-- create policy "site_products_authenticated_update" on public.site_products for update to authenticated using (true) with check (true);
-- create policy "site_products_authenticated_delete" on public.site_products for delete to authenticated using (true);
--
-- -- vendors
-- drop policy if exists "vendors_internal_select" on public.vendors;
-- drop policy if exists "vendors_internal_insert" on public.vendors;
-- drop policy if exists "vendors_internal_update" on public.vendors;
-- drop policy if exists "vendors_internal_delete" on public.vendors;
-- drop policy if exists "vendors_vendor_select"   on public.vendors;
-- create policy "vendors_authenticated_select" on public.vendors for select to authenticated using (true);
--
-- -- vendor_sites
-- drop policy if exists "vendor_sites_internal_select" on public.vendor_sites;
-- drop policy if exists "vendor_sites_internal_insert" on public.vendor_sites;
-- drop policy if exists "vendor_sites_internal_update" on public.vendor_sites;
-- drop policy if exists "vendor_sites_internal_delete" on public.vendor_sites;
-- drop policy if exists "vendor_sites_vendor_select"   on public.vendor_sites;
-- create policy "vendor_sites_authenticated_select" on public.vendor_sites for select to authenticated using (true);
--
-- commit;
-- notify pgrst, 'reload schema';
