-- 001_initial.sql
-- Supabase Dashboard → SQL Editor で実行
-- テーブル: customers, products, stock_items

create extension if not exists "pgcrypto";

-- 共通: updated_at 自動更新
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 得意先
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- 商品
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  unit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- 在庫（商品 × 保管場所ごとの数量）
create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  location text not null default 'center',
  quantity numeric(12, 2) not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, location)
);

create index if not exists stock_items_product_id_idx on public.stock_items (product_id);

drop trigger if exists stock_items_set_updated_at on public.stock_items;
create trigger stock_items_set_updated_at
  before update on public.stock_items
  for each row execute function public.set_updated_at();

-- RLS + GRANT + ポリシーは 002_rls_anon_grants.sql を実行（新規プロジェクトは 001 のあと 002 を必ず実行）

comment on table public.customers is '得意先マスタ';
comment on table public.products is '商品マスタ';
comment on table public.stock_items is '在庫（商品×保管場所）';
comment on column public.stock_items.location is '例: center（センター）, site:現場ID など';
