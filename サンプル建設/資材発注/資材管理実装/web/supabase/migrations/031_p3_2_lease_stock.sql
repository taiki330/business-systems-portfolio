-- 031_p3_2_lease_stock.sql
-- 030 適用後に Supabase SQL Editor で実行
-- Phase 3-2: リース在庫（借用単位ごとの現在地別数量）＋ リース在庫履歴
--
-- 方針:
--   - 自社所有在庫（stock_items / stock_ledger）には一切手を加えない。
--     リース在庫は独立したテーブル系統で持ち、両者を混同しない（要件定義書 §10-2）。
--     → 同一商品について「自社所有」「リースA社」「リースB社」を常に区別して集計できる（確定事項）。
--   - 現在地は stock_items と同じ語彙（storage_kind = center / site、location 互換文字列）で表現し、
--     location の組み立ては既存 public.site_stock_location() を再利用する（ハードコーディング防止）。
--   - lease_stock_items は「借用単位（lease_batch_items）× 現在地」で一意。
--     借用単位ごとの現在地管理（要件定義書 §15-1）はこの粒度で成立する。
--   - product_id / lease_company_id は集計と vendor 参照のために非正規化して保持する。
--     いずれも借用登録後に変わらない値であり、RPC（032）が書込時に必ず同期する。
--   - lease_stock_ledger は追記専用。movement_type は stock_ledger と同じ 'in'/'out' 語彙を使い、
--     業務上の意味は reason 列で区別する（receive / ship / return_from_site / return_to_company）。
--     これにより自社履歴とリース履歴を同じ形で月別・年別集計できる（034 のビュー）。
--   - RLS: 参照=admin+center。vendor は「担当現場のリース在庫の数量」のみ参照可（会社名は非公開）。
--     直接書込 policy は作らない。数量更新は 032 の SECURITY DEFINER RPC のみ。
--
-- 冪等性: create table if not exists / drop policy if exists → create policy。再実行しても安全。

begin;

-- ===========================================================================
-- 1) lease_stock_items（借用単位 × 現在地 の数量）
-- ===========================================================================
create table if not exists public.lease_stock_items (
  id uuid primary key default gen_random_uuid(),

  lease_batch_item_id uuid not null
    references public.lease_batch_items (id) on delete restrict,

  -- 集計・vendor 参照用の非正規化列（RPC が書込時に同期）
  product_id       uuid not null references public.products (id)        on delete restrict,
  lease_company_id uuid not null references public.lease_companies (id) on delete restrict,

  storage_kind text not null check (storage_kind in ('center', 'site')),
  site_id      uuid references public.sites (id) on delete restrict,
  -- stock_items と同じ互換文字列（'center' または site_stock_location(site_id)）
  location     text not null,

  quantity numeric(12, 2) not null default 0 check (quantity >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lease_stock_items_unit_location_unique
    unique (lease_batch_item_id, location)
);

alter table public.lease_stock_items
  drop constraint if exists lease_stock_items_storage_site_consistency;
alter table public.lease_stock_items
  add constraint lease_stock_items_storage_site_consistency
  check (
    (storage_kind = 'center' and site_id is null)
    or (storage_kind = 'site' and site_id is not null)
  );

comment on table public.lease_stock_items is
  'リース在庫（借用単位 × 現在地）。自社所有在庫 stock_items とは別系統。Phase 3-2';
comment on column public.lease_stock_items.product_id is
  '集計・vendor 参照用の非正規化列。lease_batch_items.product_id と常に一致（RPC が同期）';
comment on column public.lease_stock_items.lease_company_id is
  'リース会社別集計用の非正規化列。lease_batches.lease_company_id と常に一致（RPC が同期）';
comment on column public.lease_stock_items.location is
  'stock_items と同じ互換値。center または site_stock_location(site_id)';

create index if not exists lease_stock_items_batch_item_idx
  on public.lease_stock_items (lease_batch_item_id);
create index if not exists lease_stock_items_product_idx
  on public.lease_stock_items (product_id);
create index if not exists lease_stock_items_company_idx
  on public.lease_stock_items (lease_company_id);
create index if not exists lease_stock_items_site_idx
  on public.lease_stock_items (site_id)
  where site_id is not null;

drop trigger if exists lease_stock_items_set_updated_at on public.lease_stock_items;
create trigger lease_stock_items_set_updated_at
  before update on public.lease_stock_items
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2) lease_stock_ledger（リース在庫履歴・追記専用）
-- ===========================================================================
create table if not exists public.lease_stock_ledger (
  id uuid primary key default gen_random_uuid(),

  lease_batch_item_id uuid not null
    references public.lease_batch_items (id) on delete restrict,

  product_id       uuid not null references public.products (id)        on delete restrict,
  lease_company_id uuid not null references public.lease_companies (id) on delete restrict,

  location text not null,
  site_id  uuid references public.sites (id) on delete restrict,

  movement_type text not null check (movement_type in ('in', 'out')),
  reason        text not null
    check (reason in ('receive', 'ship', 'return_from_site', 'return_to_company')),

  quantity numeric(12, 2) not null check (quantity > 0),

  created_by uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.lease_stock_ledger is
  'リース在庫の入出庫履歴（追記のみ）。月別・年別集計の基礎データ。Phase 3-2';
comment on column public.lease_stock_ledger.movement_type is
  'in=その location への入り / out=その location からの出。stock_ledger と同じ語彙';
comment on column public.lease_stock_ledger.reason is
  'receive=リース会社からの受入 / ship=センターから現場へ出庫 / return_from_site=現場からセンターへ返却 / return_to_company=リース会社へ返却';
comment on column public.lease_stock_ledger.site_id is
  '現場別集計用。location 文字列のパースを不要にするための列';

create index if not exists lease_stock_ledger_product_idx
  on public.lease_stock_ledger (product_id);
create index if not exists lease_stock_ledger_company_idx
  on public.lease_stock_ledger (lease_company_id);
create index if not exists lease_stock_ledger_site_idx
  on public.lease_stock_ledger (site_id)
  where site_id is not null;
create index if not exists lease_stock_ledger_created_at_idx
  on public.lease_stock_ledger (created_at desc);
create index if not exists lease_stock_ledger_batch_item_idx
  on public.lease_stock_ledger (lease_batch_item_id);

-- ===========================================================================
-- 3) GRANT
-- ===========================================================================
grant select on table public.lease_stock_items  to authenticated;
grant select on table public.lease_stock_ledger to authenticated;

-- ===========================================================================
-- 4) RLS
--    - 参照: admin + center は全件。vendor は担当現場の行のみ（会社名は join できない）
--    - 書込 policy は作らない（INSERT/UPDATE は 032 の SECURITY DEFINER RPC のみ）
-- ===========================================================================
alter table public.lease_stock_items  enable row level security;
alter table public.lease_stock_ledger enable row level security;

drop policy if exists "lease_stock_items_read"          on public.lease_stock_items;
drop policy if exists "lease_stock_items_vendor_select" on public.lease_stock_items;

create policy "lease_stock_items_read" on public.lease_stock_items
  for select to authenticated using (public.is_admin_or_center());

-- vendor: 自分の業者に紐付く現場の行のみ。センター在庫・他業者現場は見えない。
create policy "lease_stock_items_vendor_select" on public.lease_stock_items
  for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and storage_kind = 'site'
    and site_id in (
      select vs.site_id
        from public.vendor_sites vs
       where vs.vendor_id = public.current_vendor_id()
    )
  );

drop policy if exists "lease_stock_ledger_read" on public.lease_stock_ledger;

create policy "lease_stock_ledger_read" on public.lease_stock_ledger
  for select to authenticated using (public.is_admin_or_center());

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) テーブル・列
-- select table_name, column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name in ('lease_stock_items','lease_stock_ledger')
--  order by table_name, ordinal_position;
--
-- -- (b) policy（lease_stock_items=2 / lease_stock_ledger=1。いずれも SELECT のみ）
-- select tablename, policyname, cmd from pg_policies
--  where schemaname='public' and tablename in ('lease_stock_items','lease_stock_ledger')
--  order by tablename, cmd, policyname;
-- -- 期待: cmd はすべて SELECT（書込 policy が存在しないこと）
--
-- -- (c) GRANT（select のみ。insert/update/delete が付いていないこと）
-- select table_name, grantee, privilege_type
--   from information_schema.table_privileges
--  where table_schema='public' and table_name in ('lease_stock_items','lease_stock_ledger')
--  order by table_name, grantee, privilege_type;
--
-- -- (d) 自社在庫テーブルが無変更であること
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid='public.stock_items'::regclass and contype='u';
-- -- 期待: stock_items_product_id_location_key が従来どおり存在

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop table if exists public.lease_stock_ledger;
-- drop table if exists public.lease_stock_items;
-- commit;
-- notify pgrst, 'reload schema';
