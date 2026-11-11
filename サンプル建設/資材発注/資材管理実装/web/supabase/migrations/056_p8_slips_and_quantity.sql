-- 056_p8_slips_and_quantity.sql
-- 055 適用後に Supabase SQL Editor で実行
-- P1-E Phase E-2: 伝票番号入力・確定数量修正（docs/18 E-REQ-02〜05）
--
-- 背景:
--   - E-REQ-02: 事務/センターが依頼内容の確定数量を修正できる
--     （stock_requests.quantity は既に Phase 3-7 で「center調整後の現在値」の
--     意味を持っている。original_quantity が当初依頼数量。今回は「修正する画面」
--     を追加するだけで、列は追加しない）
--   - E-REQ-03/04: 処理後に伝票番号を入力する。1オーダーに複数の伝票を紐付け可能
--   - E-REQ-05: 伝票明細とオーダー明細を相互に追跡できる
--     （slips.order_id → orders、orders から stock_requests への集計で実現）
--   - D-20260801-11: 1オーダー＝1回の出庫が基本。複数伝票は例外運用として許容するのみ
--
-- 方針:
--   - slips は「オーダーに何番の伝票を紐付けたか」を記録する最小テーブル。
--     明細（伝票のどの行がどの商品か）までは持たない（1オーダー＝1回出庫が基本のため、
--     オーダー単位の紐付けで足りる。将来必要になれば slip_items を別途追加する）。
--   - 確定数量の修正は RLS の直接 UPDATE ではなく、他の書込系（ship_stock_request 等）と
--     同じく SECURITY DEFINER RPC 経由にする。理由:
--       ① status が requested/accepted のときだけに限定したい（RLS のみだと
--          「どのステータスなら更新可か」を都度 USING/CHECK に書く必要があり事故りやすい）
--       ② quantity 以外の列（status 等）を admin/center が誤って書き換えられる
--          広い UPDATE policy を作りたくない

begin;

-- ===========================================================================
-- 1) slips テーブル
-- ===========================================================================
create table if not exists public.slips (
  id uuid primary key default gen_random_uuid(),

  order_id uuid not null references public.orders (id) on delete cascade,
  slip_number text not null,

  issued_at timestamptz not null default now(),
  created_by text,

  created_at timestamptz not null default now()
);

comment on table public.slips is
  'オーダー（orders）に紐づく伝票番号。1オーダーに複数可（E-REQ-04）。P1-E Phase E-2';
comment on column public.slips.slip_number is
  '事務が処理後に手入力する伝票番号（自由入力・重複チェックなし）';

create index if not exists slips_order_id_idx on public.slips (order_id);

-- ===========================================================================
-- 2) RLS: orders と同じ権限方針（参照=admin+center+自分の現場のvendor / 登録・削除=admin+center）
-- ===========================================================================
grant select, insert, delete on table public.slips to authenticated;

alter table public.slips enable row level security;

drop policy if exists "slips_read" on public.slips;
create policy "slips_read" on public.slips for select to authenticated
  using (public.is_admin_or_center());

drop policy if exists "slips_vendor_select" on public.slips;
create policy "slips_vendor_select" on public.slips for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and exists (
      select 1
        from public.orders o
       where o.id = slips.order_id
         and (
           o.site_id = public.current_site_id()
           or o.site_id in (
             select vs.site_id
               from public.vendor_sites vs
              where vs.vendor_id = public.current_vendor_id()
           )
         )
    )
  );

drop policy if exists "slips_admin_center_insert" on public.slips;
create policy "slips_admin_center_insert" on public.slips for insert to authenticated
  with check (public.is_admin_or_center());

drop policy if exists "slips_admin_center_delete" on public.slips;
create policy "slips_admin_center_delete" on public.slips for delete to authenticated
  using (public.is_admin_or_center());

-- ===========================================================================
-- 3) update_stock_request_quantity(): 確定数量の修正（E-REQ-02）
--    status が requested/accepted のときのみ、admin/center が quantity を修正できる。
--    original_quantity（当初依頼数量）は変更しない。
-- ===========================================================================
create or replace function public.update_stock_request_quantity(
  p_request_id uuid,
  p_quantity   numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if not public.is_admin_or_center() then
    raise exception 'permission_denied: admin or center role required'
      using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity';
  end if;

  select status into v_status
    from public.stock_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'stock_request_not_found';
  end if;

  if v_status not in ('requested', 'accepted') then
    raise exception 'quantity_edit_not_allowed';
  end if;

  update public.stock_requests
     set quantity = p_quantity
   where id = p_request_id;
end;
$$;

comment on function public.update_stock_request_quantity is
  'admin/center 限定。requested/accepted の依頼の quantity（確定数量）を修正する。'
  ' original_quantity は変更しない。E-REQ-02 / P1-E Phase E-2';

revoke execute on function public.update_stock_request_quantity(uuid, numeric) from public;
revoke execute on function public.update_stock_request_quantity(uuid, numeric) from anon;
grant  execute on function public.update_stock_request_quantity(uuid, numeric) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='slips' order by ordinal_position;
--
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='slips' order by policyname;
--
-- select proname from pg_proc where proname='update_stock_request_quantity';

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.update_stock_request_quantity(uuid, numeric);
-- drop table if exists public.slips;
-- commit;
-- notify pgrst, 'reload schema';
