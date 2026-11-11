-- 009_authenticated_policies.sql
-- 008 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-2: authenticated ロールに anon 同等の開発用アクセスを保証（並走追加・正規化のみ）
-- docs/13 §7 Step S2
--
-- 注意:
-- - 既存 anon policy は変更しない
-- - vendor 制限・現場絞り込みは入れない（A-7 以降）
-- - app_users は 008 の SELECT のみポリシーを維持（本 migration では触らない）
-- - 002〜007 に既に authenticated policy がある環境でも冪等に再実行可能
-- - 002 の `products_authenticated_all` / `stock_items_authenticated_all` は
--   drop → 4 cmd 分割の create を行うため、一瞬 policy が外れる時間を避ける目的で
--   migration 全体を 1 トランザクションで実行する

begin;

-- ---------------------------------------------------------------------------
-- 0) GRANT（テーブル・RPC。既存 GRANT があっても問題なし）
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

grant select, insert, update, delete on table
  public.customers,
  public.products,
  public.stock_items,
  public.sites,
  public.site_products
  to authenticated;

grant select, insert on table
  public.stock_ledger,
  public.audit_logs
  to authenticated;

grant select, insert, update on table public.stock_requests
  to authenticated;

grant execute on function public.apply_stock_movement(uuid, text, text, numeric)
  to authenticated;

grant execute on function public.ship_stock_request(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 1) customers
-- ---------------------------------------------------------------------------
-- 旧 migration の命名差異クリーンアップ（authenticated FOR ALL ポリシーの残骸）
drop policy if exists "customers_write" on public.customers;

drop policy if exists "customers_authenticated_select" on public.customers;
drop policy if exists "customers_authenticated_insert" on public.customers;
drop policy if exists "customers_authenticated_update" on public.customers;
drop policy if exists "customers_authenticated_delete" on public.customers;

create policy "customers_authenticated_select"
  on public.customers for select to authenticated using (true);
create policy "customers_authenticated_insert"
  on public.customers for insert to authenticated with check (true);
create policy "customers_authenticated_update"
  on public.customers for update to authenticated using (true) with check (true);
create policy "customers_authenticated_delete"
  on public.customers for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2) products（002 の for all を 4 cmd に正規化）
-- ---------------------------------------------------------------------------
-- 旧 migration の命名差異クリーンアップ（authenticated FOR ALL ポリシーの残骸）
drop policy if exists "products_write" on public.products;

drop policy if exists "products_authenticated_all" on public.products;
drop policy if exists "products_authenticated_select" on public.products;
drop policy if exists "products_authenticated_insert" on public.products;
drop policy if exists "products_authenticated_update" on public.products;
drop policy if exists "products_authenticated_delete" on public.products;

create policy "products_authenticated_select"
  on public.products for select to authenticated using (true);
create policy "products_authenticated_insert"
  on public.products for insert to authenticated with check (true);
create policy "products_authenticated_update"
  on public.products for update to authenticated using (true) with check (true);
create policy "products_authenticated_delete"
  on public.products for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3) stock_items（002 の for all を 4 cmd に正規化）
-- ---------------------------------------------------------------------------
-- 旧 migration の命名差異クリーンアップ（authenticated FOR ALL ポリシーの残骸）
drop policy if exists "stock_items_write" on public.stock_items;

drop policy if exists "stock_items_authenticated_all" on public.stock_items;
drop policy if exists "stock_items_authenticated_select" on public.stock_items;
drop policy if exists "stock_items_authenticated_insert" on public.stock_items;
drop policy if exists "stock_items_authenticated_update" on public.stock_items;
drop policy if exists "stock_items_authenticated_delete" on public.stock_items;

create policy "stock_items_authenticated_select"
  on public.stock_items for select to authenticated using (true);
create policy "stock_items_authenticated_insert"
  on public.stock_items for insert to authenticated with check (true);
create policy "stock_items_authenticated_update"
  on public.stock_items for update to authenticated using (true) with check (true);
create policy "stock_items_authenticated_delete"
  on public.stock_items for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 4) sites
-- ---------------------------------------------------------------------------
drop policy if exists "sites_authenticated_select" on public.sites;
drop policy if exists "sites_authenticated_insert" on public.sites;
drop policy if exists "sites_authenticated_update" on public.sites;
drop policy if exists "sites_authenticated_delete" on public.sites;

create policy "sites_authenticated_select"
  on public.sites for select to authenticated using (true);
create policy "sites_authenticated_insert"
  on public.sites for insert to authenticated with check (true);
create policy "sites_authenticated_update"
  on public.sites for update to authenticated using (true) with check (true);
create policy "sites_authenticated_delete"
  on public.sites for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 5) site_products
-- ---------------------------------------------------------------------------
drop policy if exists "site_products_authenticated_select" on public.site_products;
drop policy if exists "site_products_authenticated_insert" on public.site_products;
drop policy if exists "site_products_authenticated_update" on public.site_products;
drop policy if exists "site_products_authenticated_delete" on public.site_products;

create policy "site_products_authenticated_select"
  on public.site_products for select to authenticated using (true);
create policy "site_products_authenticated_insert"
  on public.site_products for insert to authenticated with check (true);
create policy "site_products_authenticated_update"
  on public.site_products for update to authenticated using (true) with check (true);
create policy "site_products_authenticated_delete"
  on public.site_products for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 6) stock_ledger（追記のみ。UPDATE / DELETE policy は作らない）
-- ---------------------------------------------------------------------------
drop policy if exists "stock_ledger_authenticated_select" on public.stock_ledger;
drop policy if exists "stock_ledger_authenticated_insert" on public.stock_ledger;

create policy "stock_ledger_authenticated_select"
  on public.stock_ledger for select to authenticated using (true);
create policy "stock_ledger_authenticated_insert"
  on public.stock_ledger for insert to authenticated with check (true);

-- ---------------------------------------------------------------------------
-- 7) stock_requests
-- ---------------------------------------------------------------------------
drop policy if exists "stock_requests_authenticated_select" on public.stock_requests;
drop policy if exists "stock_requests_authenticated_insert" on public.stock_requests;
drop policy if exists "stock_requests_authenticated_update" on public.stock_requests;

create policy "stock_requests_authenticated_select"
  on public.stock_requests for select to authenticated using (true);
create policy "stock_requests_authenticated_insert"
  on public.stock_requests for insert to authenticated with check (true);
create policy "stock_requests_authenticated_update"
  on public.stock_requests for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 8) audit_logs（追記のみ。UPDATE / DELETE policy は作らない）
-- ---------------------------------------------------------------------------
drop policy if exists "audit_logs_authenticated_select" on public.audit_logs;
drop policy if exists "audit_logs_authenticated_insert" on public.audit_logs;

create policy "audit_logs_authenticated_select"
  on public.audit_logs for select to authenticated using (true);
create policy "audit_logs_authenticated_insert"
  on public.audit_logs for insert to authenticated with check (true);

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 実行後の確認（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- 1) authenticated policy 数（app_users 除く）
-- select tablename, count(*) as auth_policy_count
--   from pg_policies
--  where schemaname = 'public'
--    and roles::text like '%authenticated%'
--    and tablename in (
--      'customers','products','stock_items','sites','site_products',
--      'stock_ledger','stock_requests','audit_logs'
--    )
--  group by tablename
--  order by tablename;
-- -- 期待:
-- --   customers, products, stock_items, sites, site_products → 4
-- --   stock_ledger, audit_logs → 2
-- --   stock_requests → 3
--
-- -- 2) for all 名残が消えていること
-- select policyname from pg_policies
--  where policyname in ('products_authenticated_all', 'stock_items_authenticated_all');
-- -- 期待: 0 行
--
-- -- 3) anon policy が残っていること
-- select tablename, count(*) filter (where roles::text like '%anon%') as anon_count
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in (
--      'customers','products','stock_items','sites','site_products',
--      'stock_ledger','stock_requests','audit_logs'
--    )
--  group by tablename
--  order by tablename;
--
-- -- 4) app_users は変更なし（SELECT のみ）
-- select policyname, cmd from pg_policies
--  where schemaname = 'public' and tablename = 'app_users';
-- -- 期待: app_users_self_select / SELECT のみ
--
-- -- 5) RPC EXECUTE 権限
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema = 'public'
--    and routine_name in ('apply_stock_movement', 'ship_stock_request')
--    and grantee in ('anon', 'authenticated')
--  order by routine_name, grantee;
