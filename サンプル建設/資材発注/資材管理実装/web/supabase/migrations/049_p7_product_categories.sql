-- 049_p7_product_categories.sql
-- 048 適用後に Supabase SQL Editor で実行
-- Phase 7-1: 資材種別（カテゴリ）マスタ
--
-- 背景:
--   Phase 7 の進捗レポートで「資材種別・資材ごとの内訳」を出す必要があるが、
--   products は code / name / unit のみで種別を持っていない。
--
-- 方針:
--   - 種別の数は「3〜4 種類ほどあるらしい」と確定していないため、選択肢をコードや
--     CHECK 制約に埋め込まず、product_categories マスタとして持つ。
--     事務が後から追加・改名でき、migration を追わずに運用できる（ハードコーディング回避）。
--   - products.category_id は NULL 可。既存資材は未分類のまま登録済みであり、
--     NOT NULL にすると既存データの更新を強制してしまうため。画面では「未分類」と表示する。
--   - 削除は on delete restrict。使用中の種別を消して既存資材の分類が失われるのを防ぐ。
--     使わなくなった種別は is_active = false で選択肢から外す（リース会社マスタ 029 と同方針）。
--   - RLS は既存マスタと同じ「参照は認証済み全ロール / 書込は admin のみ」。
--   - 種別の変更そのものは操作履歴の対象外（要件の 12 カテゴリに含まれない）。
--     資材の種別変更は products の UPDATE として既存トリガ（043/044）が
--     product.updated で before/after 付きで記録するため、追跡は担保される。
--
-- 冪等性: create table if not exists / add column if not exists / drop policy if exists。

begin;

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_categories is
  '資材種別マスタ（例: 枠組足場 / くさび足場 / 単管 など）。選択肢は運用で追加・改名できる。Phase 7-1';
comment on column public.product_categories.sort_order is
  '画面の並び順。小さいほど先頭。同値なら名称順';
comment on column public.product_categories.is_active is
  'false で新規選択肢から外す（既存資材の分類は保持したいため削除ではなく無効化を使う）';

create index if not exists product_categories_active_idx
  on public.product_categories (is_active, sort_order, name);

drop trigger if exists product_categories_set_updated_at on public.product_categories;
create trigger product_categories_set_updated_at
  before update on public.product_categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- products への紐付け
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists category_id uuid
    references public.product_categories (id) on delete restrict;

comment on column public.products.category_id is
  '資材種別。既存資材は NULL（未分類）を許容する。Phase 7-1';

create index if not exists products_category_idx
  on public.products (category_id);

-- ---------------------------------------------------------------------------
-- RLS / GRANT（既存マスタと同方針: 参照は全ロール / 書込は admin のみ）
-- ---------------------------------------------------------------------------
alter table public.product_categories enable row level security;

revoke all on table public.product_categories from public, anon, authenticated;
grant select, insert, update, delete on table public.product_categories to authenticated;

drop policy if exists "product_categories_read" on public.product_categories;
drop policy if exists "product_categories_admin_insert" on public.product_categories;
drop policy if exists "product_categories_admin_update" on public.product_categories;
drop policy if exists "product_categories_admin_delete" on public.product_categories;

create policy "product_categories_read"
  on public.product_categories for select to authenticated
  using (true);

create policy "product_categories_admin_insert"
  on public.product_categories for insert to authenticated
  with check (public.is_admin());

create policy "product_categories_admin_update"
  on public.product_categories for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "product_categories_admin_delete"
  on public.product_categories for delete to authenticated
  using (public.is_admin());

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='product_categories' order by cmd;
-- -- 期待: read(SELECT) / admin_insert / admin_update / admin_delete
--
-- select column_name, data_type, is_nullable from information_schema.columns
--  where table_schema='public' and table_name='products' and column_name='category_id';
-- -- 期待: uuid / YES（NULL 可）
--
-- -- 種別は画面（/products/categories）から登録する。SQL で入れる場合の例:
-- -- insert into public.product_categories (name, sort_order) values ('枠組足場', 10);

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- alter table public.products drop column if exists category_id;
-- drop policy if exists "product_categories_read" on public.product_categories;
-- drop policy if exists "product_categories_admin_insert" on public.product_categories;
-- drop policy if exists "product_categories_admin_update" on public.product_categories;
-- drop policy if exists "product_categories_admin_delete" on public.product_categories;
-- drop table if exists public.product_categories;
-- commit;
-- notify pgrst, 'reload schema';
