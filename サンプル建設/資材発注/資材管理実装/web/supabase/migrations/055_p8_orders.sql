-- 055_p8_orders.sql
-- 054 適用後に Supabase SQL Editor で実行
-- P1-E Phase E-1: 出庫依頼を複数商品まとめて登録できるようにする（docs/20 D-20260801-08, 09）
--
-- 背景:
--   - 「オーダー」＝「出庫依頼」であることが確定した（docs/20 D-20260801-07）。
--   - 紙の資材発注書は1オーダー番号の下に商品が複数行並ぶが、現行の
--     stock_requests は「現場1つ＋商品1つ＋数量1つ」の単票のみ。
--   - 1回の登録操作で複数の stock_requests をまとめて作るためのヘッダとして
--     orders を新設する。stock_requests 自体のステータス遷移（requested→
--     accepted→shipped/cancelled）は行単位のまま変更しない（docs/09 を壊さない）。
--   - オーダー番号（order_number）は旧システム由来の参照キーで、採番規則は
--     クライアントが後日決める（docs/20 D-20260801-04）。今は型（text, NULL可）
--     だけ用意する。
--
-- 方針:
--   - orders は「グルーピングのための最小ヘッダ」に留め、伝票・帳票関連の列は
--     Phase E-2/E-3 で追加する（本 migration では作らない）。
--   - stock_requests.order_id は NULL 可（既存の単品依頼・過去データは
--     order 無しのまま扱える。後方互換）。
--   - RLS は stock_requests と同じ形（admin/center は全件参照、vendor は
--     自分の現場のみ参照・作成）にする。

begin;

-- ===========================================================================
-- 1) orders テーブル
-- ===========================================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),

  site_id uuid not null references public.sites (id) on delete restrict,

  -- 旧システム由来のオーダー番号。採番規則は未定のため当面 NULL 可・自由入力。
  order_number text,

  -- stock_requests と同じく認証 user_id を text で保持する既存方針に合わせる。
  requested_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.orders is
  '出庫依頼（stock_requests）を複数商品まとめて登録するためのグルーピングヘッダ。P1-E Phase E-1。'
  ' オーダー＝出庫依頼（docs/20 D-20260801-07）。stock_requests 自体のライフサイクルは変更しない';
comment on column public.orders.order_number is
  '旧システム由来のオーダー番号（参照キー）。採番規則未定のため当面 NULL 可・重複チェックなし（D-20260801-04）';

create index if not exists orders_site_id_idx on public.orders (site_id);
create index if not exists orders_order_number_idx on public.orders (order_number);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2) stock_requests.order_id（NULL可・後方互換）
-- ===========================================================================
alter table public.stock_requests
  add column if not exists order_id uuid references public.orders (id) on delete set null;

comment on column public.stock_requests.order_id is
  '所属するオーダー（orders.id）。1回の登録操作でまとめて作られた行は同じ order_id を持つ。'
  ' 既存の単品依頼・過去データは NULL のまま（後方互換）。P1-E Phase E-1';

create index if not exists stock_requests_order_id_idx on public.stock_requests (order_id);

-- ===========================================================================
-- 3) RLS: stock_requests と同じ権限方針
--    参照=admin+center / vendor は自分が作った現場のオーダーのみ参照・作成
-- ===========================================================================
grant select, insert on table public.orders to authenticated;

alter table public.orders enable row level security;

drop policy if exists "orders_read" on public.orders;
create policy "orders_read" on public.orders for select to authenticated
  using (public.is_admin_or_center());

drop policy if exists "orders_vendor_select" on public.orders;
create policy "orders_vendor_select" on public.orders for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and (
      site_id = public.current_site_id()
      or site_id in (
        select vs.site_id
          from public.vendor_sites vs
         where vs.vendor_id = public.current_vendor_id()
      )
    )
  );

drop policy if exists "orders_vendor_insert" on public.orders;
create policy "orders_vendor_insert" on public.orders for insert to authenticated
  with check (
    public.current_app_role() = 'vendor'
    and requested_by = auth.uid()::text
    and (
      site_id = public.current_site_id()
      or site_id in (
        select vs.site_id
          from public.vendor_sites vs
         where vs.vendor_id = public.current_vendor_id()
      )
    )
  );

-- UPDATE/DELETE policy は作らない（MVP では orders ヘッダの編集・削除を提供しない。
-- 個々の依頼の受付/出庫/キャンセルは既存どおり stock_requests 側で行う）。

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) テーブル・列の存在確認
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name='orders'
--  order by ordinal_position;
--
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='stock_requests' and column_name='order_id';
--
-- -- (b) policy 一覧
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='orders' order by policyname;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
-- alter table public.stock_requests drop column if exists order_id;
-- drop table if exists public.orders;
-- commit;
-- notify pgrst, 'reload schema';
