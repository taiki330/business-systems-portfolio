-- 006_site_products.sql
-- 001〜005 実行後に Supabase SQL Editor で実行
-- 現場×商品の補助マスタ（並び替え用）。docs/11 / docs/10 §2-5 参照
-- 制限ではなく補助。所有軸（ownership / lease）は本テーブルでは扱わない。

-- ① 現場×商品（補助）
create table if not exists public.site_products (
  id uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,

  display_order integer,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint site_products_site_product_unique unique (site_id, product_id)
);

-- ② 索引
create index if not exists site_products_site_id_idx
  on public.site_products (site_id);
create index if not exists site_products_product_id_idx
  on public.site_products (product_id);
create index if not exists site_products_site_order_idx
  on public.site_products (site_id, display_order nulls last);

-- ③ updated_at（既存 set_updated_at を再利用）
drop trigger if exists site_products_set_updated_at on public.site_products;
create trigger site_products_set_updated_at
  before update on public.site_products
  for each row execute function public.set_updated_at();

comment on table public.site_products is
  '現場×商品の補助マスタ（並び替え用。制限ではなく補助）';
comment on column public.site_products.display_order is
  '並び順。NULL は順序未指定（一覧では下位扱い）';
comment on column public.site_products.note is '補助メモ（TS材等）';

-- ④ GRANT（開発用）
grant select, insert, update, delete on table public.site_products
  to anon, authenticated;

-- ⑤ RLS（開発用・002〜005 と同様 anon 全許可）
alter table public.site_products enable row level security;

drop policy if exists "site_products_anon_select" on public.site_products;
drop policy if exists "site_products_anon_insert" on public.site_products;
drop policy if exists "site_products_anon_update" on public.site_products;
drop policy if exists "site_products_anon_delete" on public.site_products;
drop policy if exists "site_products_authenticated_select" on public.site_products;
drop policy if exists "site_products_authenticated_insert" on public.site_products;
drop policy if exists "site_products_authenticated_update" on public.site_products;
drop policy if exists "site_products_authenticated_delete" on public.site_products;

create policy "site_products_anon_select"
  on public.site_products for select to anon using (true);

create policy "site_products_anon_insert"
  on public.site_products for insert to anon with check (true);

create policy "site_products_anon_update"
  on public.site_products for update to anon using (true) with check (true);

create policy "site_products_anon_delete"
  on public.site_products for delete to anon using (true);

create policy "site_products_authenticated_select"
  on public.site_products for select to authenticated using (true);

create policy "site_products_authenticated_insert"
  on public.site_products for insert to authenticated with check (true);

create policy "site_products_authenticated_update"
  on public.site_products for update to authenticated using (true) with check (true);

create policy "site_products_authenticated_delete"
  on public.site_products for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 実行後の確認（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select to_regclass('public.site_products') as site_products_table;
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'site_products'
--  order by ordinal_position;
-- select indexname from pg_indexes
--  where schemaname = 'public' and tablename = 'site_products';
-- notify pgrst, 'reload schema';
