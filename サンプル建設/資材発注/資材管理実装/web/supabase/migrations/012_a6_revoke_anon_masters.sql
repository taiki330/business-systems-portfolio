-- 012_a6_revoke_anon_masters.sql
-- 011 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-6-3: マスタ群（customers / products / sites / site_products）から
-- anon 権限を剥奪する。authenticated は維持。
-- 詳細設計: docs/13 §13-5 / §13-12 / A-6-3
--
-- 注意:
-- - 本 migration はマスタ 4 テーブルのみ対象。stock_* / audit_logs / RPC には触れない
-- - authenticated の CRUD policy は維持（A-7 で role 別に分割予定）
-- - schema public への anon の usage GRANT は残す（A-6-6 で最終整理）
-- - rollback は本ファイル末尾コメントの SQL を SQL Editor で実行
-- - REQUIRE_AUTH の状態とは独立に適用可

begin;

-- ① anon policy 削除（4 テーブル × 4 cmd = 16 件）
drop policy if exists "customers_anon_select" on public.customers;
drop policy if exists "customers_anon_insert" on public.customers;
drop policy if exists "customers_anon_update" on public.customers;
drop policy if exists "customers_anon_delete" on public.customers;

drop policy if exists "products_anon_select" on public.products;
drop policy if exists "products_anon_insert" on public.products;
drop policy if exists "products_anon_update" on public.products;
drop policy if exists "products_anon_delete" on public.products;

drop policy if exists "sites_anon_select" on public.sites;
drop policy if exists "sites_anon_insert" on public.sites;
drop policy if exists "sites_anon_update" on public.sites;
drop policy if exists "sites_anon_delete" on public.sites;

drop policy if exists "site_products_anon_select" on public.site_products;
drop policy if exists "site_products_anon_insert" on public.site_products;
drop policy if exists "site_products_anon_update" on public.site_products;
drop policy if exists "site_products_anon_delete" on public.site_products;

-- ② anon GRANT 剥奪
revoke select, insert, update, delete on table public.customers from anon;
revoke select, insert, update, delete on table public.products from anon;
revoke select, insert, update, delete on table public.sites from anon;
revoke select, insert, update, delete on table public.site_products from anon;

-- ③ authenticated policy / GRANT は触らない（009 / 003 / 006 の設定を維持）

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用前の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- 1) 4 マスタの anon policy がそれぞれ 4 件存在すること
-- select tablename, count(*) as anon_policy_count
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('customers','products','sites','site_products')
--    and roles::text like '%anon%'
--  group by tablename
--  order by tablename;
-- -- 期待: 各 4
--
-- -- 2) authenticated policy が 4 件ずつ存在すること（009 適用済み確認）
-- select tablename, count(*) as auth_policy_count
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('customers','products','sites','site_products')
--    and roles::text like '%authenticated%'
--  group by tablename
--  order by tablename;
-- -- 期待: 各 4
--
-- -- 3) anon GRANT が 4 件ずつ存在すること
-- select grantee, table_name, count(*) as cnt
--   from information_schema.role_table_grants
--  where table_schema='public'
--    and table_name in ('customers','products','sites','site_products')
--    and grantee='anon'
--  group by grantee, table_name
--  order by table_name;
-- -- 期待: 各 4（SELECT/INSERT/UPDATE/DELETE）
--
-- -- 4) authenticated GRANT が 4 件ずつ存在すること
-- select grantee, table_name, count(*) as cnt
--   from information_schema.role_table_grants
--  where table_schema='public'
--    and table_name in ('customers','products','sites','site_products')
--    and grantee='authenticated'
--  group by grantee, table_name
--  order by table_name;
-- -- 期待: 各 4
--
-- -- 5) for all 残骸が無いこと（009 で削除済み確認）
-- select tablename, policyname from pg_policies
--  where schemaname='public'
--    and policyname in ('products_authenticated_all','stock_items_authenticated_all');
-- -- 期待: 0 行

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) anon policy が 0、authenticated が 4 件ずつ
-- select tablename,
--        count(*) filter (where roles::text like '%anon%') as anon_cnt,
--        count(*) filter (where roles::text like '%authenticated%') as auth_cnt
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('customers','products','sites','site_products')
--  group by tablename
--  order by tablename;
-- -- 期待: anon_cnt=0, auth_cnt=4（全テーブル）
--
-- -- (b) anon GRANT が消えている
-- select table_name, grantee, count(*) as cnt
--   from information_schema.role_table_grants
--  where table_schema='public'
--    and table_name in ('customers','products','sites','site_products')
--    and grantee in ('anon','authenticated')
--  group by table_name, grantee
--  order by table_name, grantee;
-- -- 期待: 各テーブル authenticated=4 のみ。anon は行ごと消える
--
-- -- (c) テーブルデータは無変更
-- select 'customers' as t, count(*) from public.customers
-- union all select 'products', count(*) from public.products
-- union all select 'sites', count(*) from public.sites
-- union all select 'site_products', count(*) from public.site_products;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- grant select, insert, update, delete on table public.customers to anon;
-- grant select, insert, update, delete on table public.products to anon;
-- grant select, insert, update, delete on table public.sites to anon;
-- grant select, insert, update, delete on table public.site_products to anon;
--
-- create policy "customers_anon_select"
--   on public.customers for select to anon using (true);
-- create policy "customers_anon_insert"
--   on public.customers for insert to anon with check (true);
-- create policy "customers_anon_update"
--   on public.customers for update to anon using (true) with check (true);
-- create policy "customers_anon_delete"
--   on public.customers for delete to anon using (true);
--
-- create policy "products_anon_select"
--   on public.products for select to anon using (true);
-- create policy "products_anon_insert"
--   on public.products for insert to anon with check (true);
-- create policy "products_anon_update"
--   on public.products for update to anon using (true) with check (true);
-- create policy "products_anon_delete"
--   on public.products for delete to anon using (true);
--
-- create policy "sites_anon_select"
--   on public.sites for select to anon using (true);
-- create policy "sites_anon_insert"
--   on public.sites for insert to anon with check (true);
-- create policy "sites_anon_update"
--   on public.sites for update to anon using (true) with check (true);
-- create policy "sites_anon_delete"
--   on public.sites for delete to anon using (true);
--
-- create policy "site_products_anon_select"
--   on public.site_products for select to anon using (true);
-- create policy "site_products_anon_insert"
--   on public.site_products for insert to anon with check (true);
-- create policy "site_products_anon_update"
--   on public.site_products for update to anon using (true) with check (true);
-- create policy "site_products_anon_delete"
--   on public.site_products for delete to anon using (true);
--
-- commit;
-- notify pgrst, 'reload schema';
--
-- -- rollback 後の確認
-- -- select tablename,
-- --        count(*) filter (where roles::text like '%anon%') as anon_cnt,
-- --        count(*) filter (where roles::text like '%authenticated%') as auth_cnt
-- --   from pg_policies
-- --  where schemaname='public'
-- --    and tablename in ('customers','products','sites','site_products')
-- --  group by tablename
-- --  order by tablename;
-- -- 期待: anon_cnt=4, auth_cnt=4（全テーブル）
