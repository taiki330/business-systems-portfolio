-- 040_p5_analytics.sql
-- 039 適用後に Supabase SQL Editor で実行
-- Phase 5: 分析ダッシュボード／月別・年別集計／現場別・商品別・リース分析の集計 RPC
--
-- 方針:
--   - 集計は DB 側を正とする。全履歴をアプリへ引かず、SECURITY DEFINER 関数の中で
--     material_movement_ledger（033）・material_stock_breakdown（035）・
--     site_product_plan_status（034/039）・lease_batch_items（030）等を集約して返す。
--   - owned / leased を正しく区別する。出庫・返却は必ず「現場側の行」で数え、二重計上しない
--     （033 のコメント方針を踏襲: 現場行 in=出庫, 現場行 out=返却。センター行は用いない）。
--   - cancelled 等の無効データは除外する:
--       * 出庫/返却/リース受入/リース返却は台帳（ledger）ベース。cancelled 依頼は
--         そもそも台帳に行を作らないため自然に除外される。
--       * 依頼件数・未処理依頼は stock_requests.status で明示的に除外する。
--       * リース返却期限超過は lease_batches.status='cancelled' を除外する。
--   - 権限: すべて is_admin_or_center() ガード（vendor は実行不可・フェイルクローズ）。
--     画面側 access-rules でも vendor を forbidden にするが、RPC 側でも二重防御する。
--   - 5年運用を想定し、期間集計は created_at の範囲で絞る（範囲は呼び出し側が必ず渡す）。
--     現場・商品・リース会社の件数は小さいため一覧のページングは不要（期間集計も最大 ~60 行）。
--   - 既存 migration は変更しない。本ファイルは新規追加のみ。
--
-- 冪等性: create or replace function / create index if not exists。再実行しても安全。

begin;

-- ===========================================================================
-- 期間境界の定義（レビュー対応 #1）
--   月次: [date_trunc('month', p_from), date_trunc('month', p_to) + 1 month)
--   年次: [date_trunc('year',  p_from), date_trunc('year',  p_to) + 1 year)
--   これにより p_from / p_to に任意の日付を渡しても、その月末・年末までを正しく含む。
--   p_from > p_to は invalid_period_range で固定的に拒否する。
--   （外部から実行される独立ヘルパーは置かず、各期間関数の中でインラインに正規化する。）
-- ===========================================================================

-- ===========================================================================
-- 1) analytics_dashboard: ダッシュボード KPI（今月 / 前月比較 + 現況スナップショット）
-- ===========================================================================
create or replace function public.analytics_dashboard(p_month date)
returns table (
  this_month              date,
  this_shipped            numeric,
  prev_shipped            numeric,
  this_returned           numeric,
  prev_returned           numeric,
  site_stock_owned        numeric,  -- 現場現在庫（自社所有・現在値）
  lease_outstanding       numeric,  -- リース中数量（受入済み − リース会社返却済み）
  overdue_lease_count     integer,  -- 返却期限超過（未返却が残る借用明細）件数
  over_plan_count         integer   -- 予定数量超過の現場×商品 件数
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_this_start date := date_trunc('month', p_month)::date;
  v_this_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_prev_start date := (date_trunc('month', p_month) - interval '1 month')::date;
begin
  if not public.is_admin_or_center() then
    raise exception 'permission_denied: admin or center role required'
      using errcode = '42501';
  end if;

  return query
  with mv as (
    select m.movement_type, m.reason, m.site_id, m.quantity, m.created_at
      from public.material_movement_ledger m
     where m.created_at >= v_prev_start
       and m.created_at <  v_this_end
  ),
  shipped_this as (
    select coalesce(sum(quantity), 0) q from mv
     where reason = 'ship' and site_id is not null and movement_type = 'in'
       and created_at >= v_this_start and created_at < v_this_end
  ),
  shipped_prev as (
    select coalesce(sum(quantity), 0) q from mv
     where reason = 'ship' and site_id is not null and movement_type = 'in'
       and created_at >= v_prev_start and created_at < v_this_start
  ),
  returned_this as (
    select coalesce(sum(quantity), 0) q from mv
     where reason = 'return_from_site' and site_id is not null and movement_type = 'out'
       and created_at >= v_this_start and created_at < v_this_end
  ),
  returned_prev as (
    select coalesce(sum(quantity), 0) q from mv
     where reason = 'return_from_site' and site_id is not null and movement_type = 'out'
       and created_at >= v_prev_start and created_at < v_this_start
  ),
  site_stock as (
    select coalesce(sum(b.quantity), 0) q
      from public.material_stock_breakdown b
     where b.storage_kind = 'site' and b.ownership = 'owned'
  ),
  lease_out as (
    select coalesce(sum(bi.return_obligation_quantity), 0) q
      from public.lease_batch_items bi
      join public.lease_batches lb on lb.id = bi.lease_batch_id
     where lb.status <> 'cancelled'
  ),
  overdue as (
    select count(*)::int c
      from public.lease_batch_items bi
      join public.lease_batches lb on lb.id = bi.lease_batch_id
     where lb.status <> 'cancelled'
       and bi.return_obligation_quantity > 0
       and bi.return_due_date is not null
       and bi.return_due_date < current_date
  ),
  over_plan as (
    select count(*)::int c
      from public.site_product_plan_status s
     where s.is_over
  )
  select
    v_this_start,
    (select q from shipped_this),
    (select q from shipped_prev),
    (select q from returned_this),
    (select q from returned_prev),
    (select q from site_stock),
    (select q from lease_out),
    (select c from overdue),
    (select c from over_plan);
end;
$$;

comment on function public.analytics_dashboard is
  'Phase 5 ダッシュボード KPI。今月/前月の出庫・返却、現場現在庫（自社）、リース中数量、'
  ' 返却期限超過件数、予定数量超過件数を返す。admin/center のみ。';

-- ===========================================================================
-- 2) analytics_period_summary: 月別・年別の全体集計
-- ===========================================================================
create or replace function public.analytics_period_summary(
  p_kind text,
  p_from date,
  p_to   date
)
returns table (
  period                     date,
  shipped_quantity           numeric,
  returned_quantity          numeric,
  net_quantity               numeric,
  lease_received_quantity    numeric,
  lease_returned_to_company  numeric,
  site_count                 integer,
  request_count              integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
-- RETURNS TABLE の OUT 列 period と、CTE 内の列 period が同名で衝突するため、
-- 曖昧参照はカラム側に解決する（'column reference "period" is ambiguous' 対策）。
#variable_conflict use_column
declare
  v_from  date;
  v_upper date;
begin
  if not public.is_admin_or_center() then
    raise exception 'permission_denied: admin or center role required'
      using errcode = '42501';
  end if;
  if p_kind not in ('month', 'year') then
    raise exception 'invalid_period_kind';
  end if;
  if p_from > p_to then
    raise exception 'invalid_period_range';
  end if;
  -- 期間境界の正規化: 開始は期間頭へ丸め、終了は期間頭 + 1 期間（排他的上限）
  v_from  := date_trunc(p_kind, p_from)::date;
  v_upper := (date_trunc(p_kind, p_to)
              + case p_kind when 'year' then interval '1 year' else interval '1 month' end)::date;

  return query
  with mv as (
    select date_trunc(p_kind, m.created_at)::date as period,
           m.movement_type, m.reason, m.site_id, m.quantity
      from public.material_movement_ledger m
     where m.created_at >= v_from and m.created_at < v_upper
  ),
  flows as (
    select period,
           coalesce(sum(quantity) filter (
             where reason = 'ship' and site_id is not null and movement_type = 'in'), 0) as shipped,
           coalesce(sum(quantity) filter (
             where reason = 'return_from_site' and site_id is not null and movement_type = 'out'), 0) as returned,
           coalesce(sum(quantity) filter (
             where reason = 'receive' and movement_type = 'in'), 0) as lease_received,
           coalesce(sum(quantity) filter (
             where reason = 'return_to_company' and movement_type = 'out'), 0) as lease_ret,
           count(distinct site_id) filter (where site_id is not null) as sites
      from mv
     group by period
  ),
  reqs as (
    select date_trunc(p_kind, r.requested_at)::date as period,
           count(*)::int as req_count
      from public.stock_requests r
     where r.requested_at >= v_from and r.requested_at < v_upper
       and r.status <> 'cancelled'
     group by 1
  )
  select
    coalesce(f.period, rq.period) as period,
    coalesce(f.shipped, 0),
    coalesce(f.returned, 0),
    coalesce(f.shipped, 0) - coalesce(f.returned, 0),
    coalesce(f.lease_received, 0),
    coalesce(f.lease_ret, 0),
    coalesce(f.sites, 0)::int,
    coalesce(rq.req_count, 0)
  from flows f
  full outer join reqs rq on rq.period = f.period
  order by 1 desc;
end;
$$;

comment on function public.analytics_period_summary is
  'Phase 5 月別・年別集計。出庫/返却/純増減/リース受入/リース会社返却/現場数/依頼件数。'
  ' cancelled 依頼は除外。admin/center のみ。';

-- ===========================================================================
-- 3) analytics_site_summary: 現場別分析（期間フロー + 現況）
-- ===========================================================================
create or replace function public.analytics_site_summary(
  p_from date,
  p_to   date
)
returns table (
  site_id           uuid,
  site_name         text,
  shipped_quantity  numeric,
  returned_quantity numeric,
  current_stock     numeric,  -- 現場現在庫（自社 + リース）
  pending_requests  numeric,  -- 未処理依頼（requested/accepted）
  planned_total     numeric,  -- 予定数量合計
  over_quantity     numeric   -- 超過数量合計
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_upper date := (p_to + interval '1 day')::date;
begin
  if not public.is_admin_or_center() then
    raise exception 'permission_denied: admin or center role required'
      using errcode = '42501';
  end if;
  if p_from > p_to then
    raise exception 'invalid_period_range';
  end if;

  return query
  with flows as (
    select m.site_id,
           coalesce(sum(m.quantity) filter (
             where m.reason = 'ship' and m.movement_type = 'in'), 0) as shipped,
           coalesce(sum(m.quantity) filter (
             where m.reason = 'return_from_site' and m.movement_type = 'out'), 0) as returned
      from public.material_movement_ledger m
     where m.site_id is not null
       and m.created_at >= p_from and m.created_at < v_upper
     group by m.site_id
  ),
  stock as (
    select b.site_id, coalesce(sum(b.quantity), 0) as qty
      from public.material_stock_breakdown b
     where b.storage_kind = 'site' and b.site_id is not null
     group by b.site_id
  ),
  pending as (
    select r.site_id, coalesce(sum(r.quantity), 0) as qty
      from public.stock_requests r
     where r.status in ('requested', 'accepted')
     group by r.site_id
  ),
  plan as (
    select s.site_id,
           coalesce(sum(s.planned_quantity), 0) as planned,
           coalesce(sum(s.over_quantity) filter (where s.is_over), 0) as over_qty
      from public.site_product_plan_status s
     group by s.site_id
  )
  select
    st.id,
    st.name,
    coalesce(f.shipped, 0),
    coalesce(f.returned, 0),
    coalesce(sk.qty, 0),
    coalesce(p.qty, 0),
    coalesce(pl.planned, 0),
    coalesce(pl.over_qty, 0)
  from public.sites st
  left join flows   f  on f.site_id  = st.id
  left join stock   sk on sk.site_id = st.id
  left join pending p  on p.site_id  = st.id
  left join plan    pl on pl.site_id = st.id
  order by st.name;
end;
$$;

comment on function public.analytics_site_summary is
  'Phase 5 現場別分析。期間の出庫/返却 + 現在庫/未処理依頼/予定数量/超過数量。admin/center のみ。';

-- ===========================================================================
-- 4) analytics_product_summary: 商品別分析（owned/leased 区別）
-- ===========================================================================
create or replace function public.analytics_product_summary(
  p_from date,
  p_to   date
)
returns table (
  product_id           uuid,
  product_code         text,
  product_name         text,
  product_unit         text,
  shipped_quantity     numeric,
  shipped_owned        numeric,
  shipped_leased       numeric,
  returned_quantity    numeric,
  current_stock        numeric,
  current_owned        numeric,
  current_leased       numeric,
  using_site_count     integer,
  planned_total        numeric,
  over_quantity        numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_upper date := (p_to + interval '1 day')::date;
begin
  if not public.is_admin_or_center() then
    raise exception 'permission_denied: admin or center role required'
      using errcode = '42501';
  end if;
  if p_from > p_to then
    raise exception 'invalid_period_range';
  end if;

  return query
  with flows as (
    select m.product_id,
           coalesce(sum(m.quantity) filter (
             where m.reason = 'ship' and m.site_id is not null and m.movement_type = 'in'), 0) as shipped,
           coalesce(sum(m.quantity) filter (
             where m.reason = 'ship' and m.site_id is not null and m.movement_type = 'in'
               and m.ownership = 'owned'), 0) as shipped_owned,
           coalesce(sum(m.quantity) filter (
             where m.reason = 'ship' and m.site_id is not null and m.movement_type = 'in'
               and m.ownership = 'leased'), 0) as shipped_leased,
           coalesce(sum(m.quantity) filter (
             where m.reason = 'return_from_site' and m.site_id is not null and m.movement_type = 'out'), 0) as returned
      from public.material_movement_ledger m
     where m.created_at >= p_from and m.created_at < v_upper
     group by m.product_id
  ),
  stock as (
    select b.product_id,
           coalesce(sum(b.quantity), 0) as total,
           coalesce(sum(b.quantity) filter (where b.ownership = 'owned'), 0) as owned,
           coalesce(sum(b.quantity) filter (where b.ownership = 'leased'), 0) as leased,
           count(distinct b.site_id) filter (
             where b.storage_kind = 'site' and b.site_id is not null and b.quantity > 0) as sites
      from public.material_stock_breakdown b
     group by b.product_id
  ),
  plan as (
    select s.product_id,
           coalesce(sum(s.planned_quantity), 0) as planned,
           coalesce(sum(s.over_quantity) filter (where s.is_over), 0) as over_qty
      from public.site_product_plan_status s
     group by s.product_id
  )
  select
    pr.id,
    pr.code,
    pr.name,
    pr.unit,
    coalesce(f.shipped, 0),
    coalesce(f.shipped_owned, 0),
    coalesce(f.shipped_leased, 0),
    coalesce(f.returned, 0),
    coalesce(sk.total, 0),
    coalesce(sk.owned, 0),
    coalesce(sk.leased, 0),
    coalesce(sk.sites, 0)::int,
    coalesce(pl.planned, 0),
    coalesce(pl.over_qty, 0)
  from public.products pr
  left join flows f  on f.product_id  = pr.id
  left join stock sk on sk.product_id = pr.id
  left join plan  pl on pl.product_id = pr.id
  order by pr.code nulls last, pr.name;
end;
$$;

comment on function public.analytics_product_summary is
  'Phase 5 商品別分析。owned/leased 区別の出庫・現在庫、利用現場数、予定数量、超過数量。admin/center のみ。';

-- ===========================================================================
-- 5) analytics_lease_company_summary: リース会社別 現況 + 期間フロー
-- ===========================================================================
create or replace function public.analytics_lease_company_summary(
  p_from       date,
  p_to         date,
  p_product_id uuid default null
)
returns table (
  lease_company_id   uuid,
  lease_company_name text,
  received_quantity  numeric,  -- 期間の受入
  shipped_quantity   numeric,  -- 期間の現場出庫
  returned_quantity  numeric,  -- 期間のリース会社返却
  site_stock         numeric,  -- 現在の現場リース在庫
  overdue_count      integer   -- 返却期限超過件数（現況）
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_upper date := (p_to + interval '1 day')::date;
begin
  if not public.is_admin_or_center() then
    raise exception 'permission_denied: admin or center role required'
      using errcode = '42501';
  end if;
  if p_from > p_to then
    raise exception 'invalid_period_range';
  end if;

  return query
  with flows as (
    select lsl.lease_company_id,
           coalesce(sum(lsl.quantity) filter (
             where lsl.reason = 'receive' and lsl.movement_type = 'in'), 0) as received,
           coalesce(sum(lsl.quantity) filter (
             where lsl.reason = 'ship' and lsl.site_id is not null and lsl.movement_type = 'in'), 0) as shipped,
           coalesce(sum(lsl.quantity) filter (
             where lsl.reason = 'return_to_company' and lsl.movement_type = 'out'), 0) as returned
      from public.lease_stock_ledger lsl
     where lsl.created_at >= p_from and lsl.created_at < v_upper
       and (p_product_id is null or lsl.product_id = p_product_id)
     group by lsl.lease_company_id
  ),
  site_stock as (
    select lsi.lease_company_id, coalesce(sum(lsi.quantity), 0) as qty
      from public.lease_stock_items lsi
     where lsi.storage_kind = 'site'
       and (p_product_id is null or lsi.product_id = p_product_id)
     group by lsi.lease_company_id
  ),
  overdue as (
    select lb.lease_company_id, count(*)::int as c
      from public.lease_batch_items bi
      join public.lease_batches lb on lb.id = bi.lease_batch_id
     where lb.status <> 'cancelled'
       and bi.return_obligation_quantity > 0
       and bi.return_due_date is not null
       and bi.return_due_date < current_date
       and (p_product_id is null or bi.product_id = p_product_id)
     group by lb.lease_company_id
  )
  select
    lc.id,
    lc.name,
    coalesce(f.received, 0),
    coalesce(f.shipped, 0),
    coalesce(f.returned, 0),
    coalesce(ss.qty, 0),
    coalesce(od.c, 0)
  from public.lease_companies lc
  left join flows      f  on f.lease_company_id  = lc.id
  left join site_stock ss on ss.lease_company_id = lc.id
  left join overdue    od on od.lease_company_id = lc.id
  order by lc.name;
end;
$$;

comment on function public.analytics_lease_company_summary is
  'Phase 5 リース会社別分析。期間の受入/出庫/返却 + 現在の現場在庫 + 返却期限超過件数。admin/center のみ。';

-- ===========================================================================
-- 6) analytics_lease_period: リース会社別 月別・年別フロー
-- ===========================================================================
create or replace function public.analytics_lease_period(
  p_kind       text,
  p_from       date,
  p_to         date,
  p_product_id uuid default null
)
returns table (
  period                    date,
  lease_company_id          uuid,
  lease_company_name        text,
  received_quantity         numeric,
  shipped_quantity          numeric,
  returned_to_company       numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from  date;
  v_upper date;
begin
  if not public.is_admin_or_center() then
    raise exception 'permission_denied: admin or center role required'
      using errcode = '42501';
  end if;
  if p_kind not in ('month', 'year') then
    raise exception 'invalid_period_kind';
  end if;
  if p_from > p_to then
    raise exception 'invalid_period_range';
  end if;
  v_from  := date_trunc(p_kind, p_from)::date;
  v_upper := (date_trunc(p_kind, p_to)
              + case p_kind when 'year' then interval '1 year' else interval '1 month' end)::date;

  return query
  select
    date_trunc(p_kind, lsl.created_at)::date as period,
    lsl.lease_company_id,
    lc.name,
    coalesce(sum(lsl.quantity) filter (
      where lsl.reason = 'receive' and lsl.movement_type = 'in'), 0),
    coalesce(sum(lsl.quantity) filter (
      where lsl.reason = 'ship' and lsl.site_id is not null and lsl.movement_type = 'in'), 0),
    coalesce(sum(lsl.quantity) filter (
      where lsl.reason = 'return_to_company' and lsl.movement_type = 'out'), 0)
  from public.lease_stock_ledger lsl
  join public.lease_companies lc on lc.id = lsl.lease_company_id
  where lsl.created_at >= v_from and lsl.created_at < v_upper
    and (p_product_id is null or lsl.product_id = p_product_id)
  group by 1, 2, 3
  order by 1 desc, 3;
end;
$$;

comment on function public.analytics_lease_period is
  'Phase 5 リース会社別 月別・年別フロー（受入/出庫/リース会社返却）。admin/center のみ。';

-- ===========================================================================
-- 7) EXECUTE 権限（anon/public 剥奪・authenticated 付与）
-- ===========================================================================
do $grant$
declare
  v_sig text;
  v_sigs text[] := array[
    'public.analytics_dashboard(date)',
    'public.analytics_period_summary(text, date, date)',
    'public.analytics_site_summary(date, date)',
    'public.analytics_product_summary(date, date)',
    'public.analytics_lease_company_summary(date, date, uuid)',
    'public.analytics_lease_period(text, date, date, uuid)'
  ];
begin
  foreach v_sig in array v_sigs loop
    execute format('revoke execute on function %s from public', v_sig);
    execute format('revoke execute on function %s from anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end;
$grant$;

-- ===========================================================================
-- 8) 集計を効かせるためのインデックス（レビュー #7）
--    リース会社別の期間集計に効く (lease_company_id, created_at)。
--    stock_ledger は 037 の (product_id, site_id, created_at desc) と
--    004 の created_at index があり、期間・現場・商品集計は既存で足りるため追加しない。
-- ===========================================================================
create index if not exists lease_stock_ledger_company_created_idx
  on public.lease_stock_ledger (lease_company_id, created_at);

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) 全 RPC の EXECUTE が authenticated のみ
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public' and routine_name like 'analytics_%'
--  order by routine_name, grantee;
--
-- -- (b) admin/center セッションでの動作（今月）
-- -- select * from public.analytics_dashboard(current_date);
-- -- select * from public.analytics_period_summary('month', (current_date - interval '11 months')::date, current_date);
-- -- select * from public.analytics_site_summary((current_date - interval '1 year')::date, current_date);
-- -- select * from public.analytics_product_summary((current_date - interval '1 year')::date, current_date);
-- -- select * from public.analytics_lease_company_summary((current_date - interval '1 year')::date, current_date);
-- -- select * from public.analytics_lease_period('month', (current_date - interval '11 months')::date, current_date);
--
-- -- (c) vendor セッションでは permission_denied になること（要手動確認）
--
-- -- (d) search_path 固定
-- select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and p.proname like 'analytics_%';

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop index if exists public.lease_stock_ledger_company_created_idx;
-- drop function if exists public.analytics_lease_period(text, date, date, uuid);
-- drop function if exists public.analytics_lease_company_summary(date, date, uuid);
-- drop function if exists public.analytics_product_summary(date, date);
-- drop function if exists public.analytics_site_summary(date, date);
-- drop function if exists public.analytics_period_summary(text, date, date);
-- drop function if exists public.analytics_dashboard(date);
-- commit;
-- notify pgrst, 'reload schema';
