-- 046_p6_over_returns.sql
-- 045 適用後に Supabase SQL Editor で実行
-- Phase 6-2: 過入庫（出庫数より多く返却された分）の管理
--
-- 背景（ヒアリング）:
--   現場から出庫数を超える返却が実際に発生している（出庫 100 に対し返却 150 など）。
--   旧運用ではその超過分も在庫に加算していたため、買っていないのに在庫が増え続け、
--   センターの実棚と事務のシステム値が恒常的に食い違う原因になっていた。
--   「超過分は在庫に加算せず、別枠で記録・表示する」ことで合意済み。
--
-- 方針:
--   - 返却時に入力数を分割する:
--       通常返却数 = min(返却入力数, 現在の現場在庫)
--       過入庫数   = max(返却入力数 - 現在の現場在庫, 0)
--   - 通常返却数のみを在庫（stock_items）と在庫台帳（stock_ledger）に反映する。
--     過入庫は在庫にも台帳にも一切書かない。これにより在庫がズレていかない。
--     Phase 5 の分析・稼働率（台帳を入力とする）にも過入庫は混入しない。
--   - stock_returns には通常返却数を記録する。Phase 7 の
--     「未返却数 = 出庫累計 − 通常返却累計」がそのまま成立する（過入庫は返却累計に含めない）。
--   - 過入庫は over_returns に記録し、未確認／確認済みで管理する。
--     確認済みにしても在庫数は一切変更しない（数え間違いの確認用の簡易管理）。
--   - 現場在庫行が存在しない商品の返却は、従来 site_stock_item_not_found で拒否していたが、
--     残 0 として扱い全量を過入庫として記録する。ヒアリングで「例外があった時に反映できないと困る」
--     と要望されており、拒否すると担当者が在庫を手で書き換える等の悪い回避策を誘発するため。
--     在庫には影響せず事務の過入庫一覧に必ず現れるので、誤入力は検知・是正できる。
--   - 登録・確認は operation_logs へ同一トランザクションで記録する（043 の log_operation を使用）。
--     併せて通常返却も stock_return.created として記録する。
--   - 備考は「確認時に入力する」運用に集約し、確認 RPC の引数とする
--     （確認前の備考のみの更新用 RPC は作らず、操作の種類を増やさない）。
--
-- 冪等性: create table if not exists / create or replace function / drop policy if exists。
--         再実行しても安全。

begin;

-- ===========================================================================
-- 1) over_returns テーブル
-- ===========================================================================
create table if not exists public.over_returns (
  id uuid primary key default gen_random_uuid(),

  product_id uuid not null references public.products (id) on delete restrict,
  site_id    uuid not null references public.sites (id)    on delete restrict,

  -- 過入庫数（在庫には反映されない超過分）
  quantity        numeric(12, 2) not null check (quantity > 0),
  -- 返却時に入力された数量と、そのうち在庫へ加算した通常返却数
  input_quantity  numeric(12, 2) not null check (input_quantity > 0),
  normal_quantity numeric(12, 2) not null check (normal_quantity >= 0),

  -- 対になる通常返却。通常返却が 0 件（全量が過入庫）の場合は NULL
  stock_return_id uuid references public.stock_returns (id) on delete set null,

  status text not null default 'unconfirmed'
    check (status in ('unconfirmed', 'confirmed')),
  memo text,

  reported_by  text,
  created_by   uuid references public.app_users (id) on delete set null,
  created_at   timestamptz not null default now(),
  confirmed_by uuid references public.app_users (id) on delete set null,
  confirmed_at timestamptz,

  -- 分割の整合性を DB 側でも保証する
  constraint over_returns_split_consistency
    check (quantity = input_quantity - normal_quantity),
  -- 確認状態と確認日時の整合性
  constraint over_returns_confirmed_consistency
    check ((status = 'confirmed') = (confirmed_at is not null))
);

comment on table public.over_returns is
  '過入庫（出庫数を超える返却の超過分）。在庫・在庫台帳には一切反映しない記録専用。Phase 6-2';
comment on column public.over_returns.quantity is
  '過入庫数 = 返却入力数 − 通常返却数。在庫には加算されない';
comment on column public.over_returns.normal_quantity is
  '同じ返却操作で在庫へ加算された通常返却数（stock_returns に記録された数）';
comment on column public.over_returns.status is
  'unconfirmed=未確認 / confirmed=確認済み。確認しても在庫数は変更しない';

create index if not exists over_returns_status_created_idx
  on public.over_returns (status, created_at desc);
create index if not exists over_returns_site_idx
  on public.over_returns (site_id, created_at desc);
create index if not exists over_returns_product_idx
  on public.over_returns (product_id, created_at desc);

-- ===========================================================================
-- 2) RLS / GRANT
--    参照は admin（事務）と center。書込 policy は作らず、SECURITY DEFINER RPC 経由のみ。
-- ===========================================================================
alter table public.over_returns enable row level security;

revoke all on table public.over_returns from public, anon, authenticated;
grant select on table public.over_returns to authenticated;

drop policy if exists "over_returns_read" on public.over_returns;
create policy "over_returns_read"
  on public.over_returns for select to authenticated
  using (public.is_admin_or_center());

-- ===========================================================================
-- 3) return_from_site: 通常返却と過入庫に分割する
--    033 のロジックを踏襲し、数量の分割と over_returns 追記、操作履歴記録を追加する。
-- ===========================================================================
create or replace function public.return_from_site(
  p_product_id  uuid,
  p_site_id     uuid,
  p_quantity    numeric,
  p_memo        text default null,
  p_returned_by text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site_location text;
  v_site_quantity numeric(12, 2);
  v_normal        numeric(12, 2);
  v_over          numeric(12, 2);
  v_return_id     uuid;
  v_over_id       uuid;
  v_detail        jsonb;
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  v_site_location := public.site_stock_location(p_site_id);

  -- 現場在庫行をロックして残数を得る。行が無い場合は残 0 として扱う
  -- （全量が過入庫になる。詳細はファイル冒頭の方針を参照）。
  select si.quantity
    into v_site_quantity
  from public.stock_items si
  where si.product_id = p_product_id
    and si.location   = v_site_location
    and si.storage_kind = 'site'
  for update;

  v_site_quantity := coalesce(v_site_quantity, 0);

  v_normal := least(p_quantity, v_site_quantity);
  v_over   := p_quantity - v_normal;

  v_detail := jsonb_build_object(
    'input_quantity',  p_quantity,
    'normal_quantity', v_normal,
    'over_quantity',   v_over
  );

  -- ---- 通常返却分のみ在庫・台帳へ反映する ----
  if v_normal > 0 then
    update public.stock_items
       set quantity = quantity - v_normal
     where product_id = p_product_id
       and location    = v_site_location;

    perform public.apply_stock_movement(p_product_id, 'center', 'in', v_normal);

    insert into public.stock_ledger (
      product_id, location, movement_type, quantity, site_id, created_by
    )
    values (
      p_product_id, v_site_location, 'out', v_normal,
      p_site_id, public.current_actor_id()
    );

    insert into public.stock_returns (product_id, site_id, quantity, memo, returned_by)
    values (p_product_id, p_site_id, v_normal, p_memo, p_returned_by)
    returning id into v_return_id;

    perform public.log_operation(
      'stock_return.created', 'stock_return', v_return_id,
      p_site_id, p_product_id, v_normal, v_detail
    );
  end if;

  -- ---- 過入庫分は在庫・台帳へ一切反映せず記録のみ ----
  if v_over > 0 then
    insert into public.over_returns (
      product_id, site_id, quantity, input_quantity, normal_quantity,
      stock_return_id, reported_by, created_by
    )
    values (
      p_product_id, p_site_id, v_over, p_quantity, v_normal,
      v_return_id, p_returned_by, public.current_actor_id()
    )
    returning id into v_over_id;

    perform public.log_operation(
      'over_return.created', 'over_return', v_over_id,
      p_site_id, p_product_id, v_over, v_detail
    );
  end if;

  return coalesce(v_return_id, v_over_id);
end;
$$;

comment on function public.return_from_site is
  '現場からの返却。返却入力数を「通常返却（在庫へ加算）」と「過入庫（在庫へ反映しない）」に分割し、'
  ' 1 トランザクションで在庫・台帳・stock_returns・over_returns・操作履歴を更新する。center 限定。Phase 6-2';

revoke execute on function public.return_from_site(uuid, uuid, numeric, text, text) from public;
revoke execute on function public.return_from_site(uuid, uuid, numeric, text, text) from anon;
grant  execute on function public.return_from_site(uuid, uuid, numeric, text, text) to authenticated;

-- ===========================================================================
-- 4) confirm_over_return: 過入庫の確認（admin のみ・在庫は変更しない）
-- ===========================================================================
create or replace function public.confirm_over_return(
  p_id   uuid,
  p_memo text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status     text;
  v_site_id    uuid;
  v_product_id uuid;
  v_quantity   numeric(12, 2);
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  select o.status, o.site_id, o.product_id, o.quantity
    into v_status, v_site_id, v_product_id, v_quantity
  from public.over_returns o
  where o.id = p_id
  for update;

  if not found then
    raise exception 'over_return_not_found';
  end if;

  -- 二重確認の防止
  if v_status = 'confirmed' then
    raise exception 'over_return_already_confirmed';
  end if;

  update public.over_returns
     set status       = 'confirmed',
         confirmed_at = now(),
         confirmed_by = public.current_actor_id(),
         memo         = coalesce(nullif(trim(p_memo), ''), memo)
   where id = p_id;

  perform public.log_operation(
    'over_return.confirmed', 'over_return', p_id,
    v_site_id, v_product_id, v_quantity,
    jsonb_build_object('memo', nullif(trim(p_memo), ''))
  );
end;
$$;

comment on function public.confirm_over_return is
  '過入庫を確認済みにする（admin のみ）。在庫数は一切変更しない。二重確認は拒否。Phase 6-2';

revoke execute on function public.confirm_over_return(uuid, text) from public;
revoke execute on function public.confirm_over_return(uuid, text) from anon;
grant  execute on function public.confirm_over_return(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) テーブル・制約・RLS
-- select conname, pg_get_constraintdef(c.oid)
--   from pg_constraint c join pg_class t on t.oid = c.conrelid
--  where t.relname = 'over_returns';
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='over_returns';
-- -- 期待: over_returns_read（SELECT）のみ。INSERT/UPDATE/DELETE policy は無いこと
--
-- -- (b) authenticated が直接書き込めないこと
-- select grantee, privilege_type from information_schema.table_privileges
--  where table_schema='public' and table_name='over_returns' order by grantee, privilege_type;
-- -- 期待: authenticated は SELECT のみ、anon は 0 行
--
-- -- (c) 分割ロジックの確認（center アカウントで実アプリから返却して確認するのが確実）
-- --     現場在庫 100 の商品を 150 返却した場合の期待値:
-- --       stock_items（現場）      : 0
-- --       stock_returns.quantity   : 100
-- --       over_returns.quantity    : 50, input_quantity 150, normal_quantity 100
-- --       operation_logs           : stock_return.created と over_return.created が各 1 件
-- select o.quantity as over_qty, o.input_quantity, o.normal_quantity, o.status,
--        p.name as product, s.name as site, o.created_at
--   from public.over_returns o
--   join public.products p on p.id = o.product_id
--   join public.sites s    on s.id = o.site_id
--  order by o.created_at desc limit 10;
--
-- -- (d) 確認しても在庫が変わらないこと
-- -- select quantity from public.stock_items where product_id='<pid>' and location='center';
-- -- select public.confirm_over_return('<over_return_id>', '現場に確認済み');
-- -- select quantity from public.stock_items where product_id='<pid>' and location='center';
-- -- 期待: 前後で同じ値

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合）
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.confirm_over_return(uuid, text);
-- drop policy if exists "over_returns_read" on public.over_returns;
-- drop table if exists public.over_returns;
-- -- return_from_site は 033_p3_6_movement_analytics.sql の
-- -- 「create or replace function public.return_from_site(...)」ブロックを再実行して戻す
-- -- （過入庫は拒否され insufficient_site_stock になる状態に戻る）。
-- commit;
-- notify pgrst, 'reload schema';
