-- 002_rls_anon_grants.sql
-- Supabase SQL Editor で実行（permission denied 対策）
-- anon / authenticated から customers 等を CRUD できるようにする

-- 1) スキーマ・テーブルへの権限（RLS とは別に必要）
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table public.customers to anon, authenticated;
grant select, insert, update, delete on table public.products to anon, authenticated;
grant select, insert, update, delete on table public.stock_items to anon, authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;

-- 2) 旧ポリシー名の掃除（初回 SQL の名残）
drop policy if exists "customers_select_anon" on public.customers;
drop policy if exists "customers_insert_authenticated" on public.customers;
drop policy if exists "customers_select" on public.customers;
drop policy if exists "customers_write" on public.customers;
drop policy if exists "customers_write_anon_dev" on public.customers;
drop policy if exists "customers_anon_select" on public.customers;
drop policy if exists "customers_anon_insert" on public.customers;
drop policy if exists "customers_anon_update" on public.customers;
drop policy if exists "customers_anon_delete" on public.customers;
drop policy if exists "customers_authenticated_all" on public.customers;

drop policy if exists "products_select" on public.products;
drop policy if exists "products_write" on public.products;
drop policy if exists "products_write_anon_dev" on public.products;
drop policy if exists "products_anon_all" on public.products;
drop policy if exists "products_authenticated_all" on public.products;

drop policy if exists "stock_items_select" on public.stock_items;
drop policy if exists "stock_items_write" on public.stock_items;
drop policy if exists "stock_items_write_anon_dev" on public.stock_items;
drop policy if exists "stock_items_anon_all" on public.stock_items;
drop policy if exists "stock_items_authenticated_all" on public.stock_items;

-- 3) RLS 有効化
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.stock_items enable row level security;

-- 4) anon: SELECT / INSERT / UPDATE / DELETE（開発用・本番前に見直し）
create policy "customers_anon_select"
  on public.customers for select to anon using (true);

create policy "customers_anon_insert"
  on public.customers for insert to anon with check (true);

create policy "customers_anon_update"
  on public.customers for update to anon using (true) with check (true);

create policy "customers_anon_delete"
  on public.customers for delete to anon using (true);

-- 5) authenticated も同様（ログイン実装後用）
create policy "customers_authenticated_select"
  on public.customers for select to authenticated using (true);

create policy "customers_authenticated_insert"
  on public.customers for insert to authenticated with check (true);

create policy "customers_authenticated_update"
  on public.customers for update to authenticated using (true) with check (true);

create policy "customers_authenticated_delete"
  on public.customers for delete to authenticated using (true);

-- products / stock_items（同じく開発用）
create policy "products_anon_select" on public.products for select to anon using (true);
create policy "products_anon_insert" on public.products for insert to anon with check (true);
create policy "products_anon_update" on public.products for update to anon using (true) with check (true);
create policy "products_anon_delete" on public.products for delete to anon using (true);

create policy "products_authenticated_all"
  on public.products for all to authenticated using (true) with check (true);

create policy "stock_items_anon_select" on public.stock_items for select to anon using (true);
create policy "stock_items_anon_insert" on public.stock_items for insert to anon with check (true);
create policy "stock_items_anon_update" on public.stock_items for update to anon using (true) with check (true);
create policy "stock_items_anon_delete" on public.stock_items for delete to anon using (true);

create policy "stock_items_authenticated_all"
  on public.stock_items for all to authenticated using (true) with check (true);
