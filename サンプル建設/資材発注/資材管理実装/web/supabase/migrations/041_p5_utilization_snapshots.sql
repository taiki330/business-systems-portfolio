-- 041_p5_utilization_snapshots.sql
-- Phase 5: 資材稼働率分析（導入日以後のみ）
--
-- 過去の stock_items 直接更新には有効日時の履歴が存在しないため、040以前の
-- 稼働率を逆算しない。適用日の現在庫を baseline として確定し、以後は JST の
-- 日末スナップショットだけを平均稼働数量の入力に使う。

begin;

create table if not exists public.inventory_snapshot_runs (
  snapshot_date date primary key,
  snapshot_type text not null check (snapshot_type in ('baseline', 'daily')),
  captured_at timestamptz not null default now(),
  owned_row_count integer not null default 0 check (owned_row_count >= 0),
  leased_row_count integer not null default 0 check (leased_row_count >= 0)
);

create table if not exists public.inventory_daily_balances (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null references public.inventory_snapshot_runs(snapshot_date) on delete cascade,
  ownership text not null check (ownership in ('owned', 'leased')),
  -- source_row_id は stock_items / lease_stock_items のそれぞれの現在庫単位。
  -- これにより site_id / 会社 / 借用明細を失わず、NULL を含む複合キーも避ける。
  source_row_id uuid not null,
  product_id uuid not null references public.products(id) on delete restrict,
  storage_kind text not null check (storage_kind in ('center', 'site')),
  site_id uuid null references public.sites(id) on delete restrict,
  lease_company_id uuid null references public.lease_companies(id) on delete restrict,
  lease_batch_item_id uuid null references public.lease_batch_items(id) on delete restrict,
  quantity numeric(12, 2) not null check (quantity >= 0),
  captured_at timestamptz not null default now(),
  constraint inventory_daily_balances_owned_shape check (
    (ownership = 'owned' and lease_company_id is null and lease_batch_item_id is null)
    or
    (ownership = 'leased' and lease_company_id is not null and lease_batch_item_id is not null)
  ),
  constraint inventory_daily_balances_site_shape check (
    (storage_kind = 'site' and site_id is not null)
    or
    (storage_kind = 'center' and site_id is null)
  ),
  constraint inventory_daily_balances_snapshot_unit_key unique (snapshot_date, ownership, source_row_id)
);

create index if not exists inventory_daily_balances_product_date_idx
  on public.inventory_daily_balances (product_id, snapshot_date);
create index if not exists inventory_daily_balances_date_kind_idx
  on public.inventory_daily_balances (snapshot_date, ownership, storage_kind);

alter table public.inventory_snapshot_runs enable row level security;
alter table public.inventory_daily_balances enable row level security;

drop policy if exists "inventory_snapshot_runs_read" on public.inventory_snapshot_runs;
drop policy if exists "inventory_daily_balances_read" on public.inventory_daily_balances;
create policy "inventory_snapshot_runs_read" on public.inventory_snapshot_runs
  for select to authenticated using (public.is_admin_or_center());
create policy "inventory_daily_balances_read" on public.inventory_daily_balances
  for select to authenticated using (public.is_admin_or_center());

revoke all on table public.inventory_snapshot_runs from public, anon, authenticated;
revoke all on table public.inventory_daily_balances from public, anon, authenticated;
grant select on table public.inventory_snapshot_runs to authenticated;
grant select on table public.inventory_daily_balances to authenticated;

-- 定期実行専用。PUBLIC / anon / authenticated に EXECUTE を与えないため、API から
-- 任意の日付のスナップショットを作ることはできない。関数全体が1トランザクションで
-- 動くため、途中失敗なら run 行・明細ともロールバックされ、再実行しても二重登録しない。
create or replace function public.capture_inventory_daily_balances(
  p_snapshot_date date,
  p_snapshot_type text default 'daily'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owned_count integer := 0;
  v_leased_count integer := 0;
begin
  if p_snapshot_date is null then
    raise exception 'snapshot_date_required';
  end if;
  if p_snapshot_type not in ('baseline', 'daily') then
    raise exception 'invalid_snapshot_type';
  end if;
  if p_snapshot_date > (timezone('Asia/Tokyo', now()))::date then
    raise exception 'future_snapshot_date_not_allowed';
  end if;

  -- 同一日の並行実行を直列化する。date の整数表現を advisory lock のキーに使う。
  perform pg_advisory_xact_lock(41041, (p_snapshot_date - date '2000-01-01'));

  insert into public.inventory_snapshot_runs (snapshot_date, snapshot_type)
  values (p_snapshot_date, p_snapshot_type)
  on conflict (snapshot_date) do nothing;

  if not found then
    return;
  end if;

  insert into public.inventory_daily_balances (
    snapshot_date, ownership, source_row_id, product_id, storage_kind, site_id,
    lease_company_id, lease_batch_item_id, quantity
  )
  select
    p_snapshot_date, 'owned', si.id, si.product_id, si.storage_kind, si.site_id,
    null, null, si.quantity
  from public.stock_items si;
  get diagnostics v_owned_count = row_count;

  insert into public.inventory_daily_balances (
    snapshot_date, ownership, source_row_id, product_id, storage_kind, site_id,
    lease_company_id, lease_batch_item_id, quantity
  )
  select
    p_snapshot_date, 'leased', lsi.id, lsi.product_id, lsi.storage_kind, lsi.site_id,
    lsi.lease_company_id, lsi.lease_batch_item_id, lsi.quantity
  from public.lease_stock_items lsi;
  get diagnostics v_leased_count = row_count;

  update public.inventory_snapshot_runs
     set owned_row_count = v_owned_count,
         leased_row_count = v_leased_count,
         captured_at = now()
   where snapshot_date = p_snapshot_date;
end;
$$;

revoke execute on function public.capture_inventory_daily_balances(date, text) from public;
revoke execute on function public.capture_inventory_daily_balances(date, text) from anon;
revoke execute on function public.capture_inventory_daily_balances(date, text) from authenticated;

-- 導入時の確定ベースライン。導入日前はこの表に行がないため、分析RPCは算出不可を返す。
select public.capture_inventory_daily_balances(
  (timezone('Asia/Tokyo', now()))::date,
  'baseline'
);

create or replace function public.analytics_product_utilization(
  p_kind text,
  p_from date,
  p_to date,
  p_product_id uuid default null,
  p_sort text default 'owned_utilization',
  p_sort_direction text default 'desc'
)
returns table (
  period date,
  product_id uuid,
  product_code text,
  product_name text,
  product_unit text,
  is_available boolean,
  snapshot_days integer,
  expected_days integer,
  avg_owned_holding numeric,
  avg_owned_site_quantity numeric,
  owned_utilization_rate numeric,
  avg_leased_site_quantity numeric,
  avg_total_site_quantity numeric,
  lease_dependency_rate numeric,
  shipped_quantity numeric,
  returned_quantity numeric,
  turnover_quantity numeric,
  operating_site_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from date;
  v_upper date;
begin
  if not public.is_admin_or_center() then
    raise exception 'permission_denied: admin or center role required' using errcode = '42501';
  end if;
  if p_kind not in ('month', 'year') then
    raise exception 'invalid_period_kind';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid_period_range';
  end if;
  if p_sort not in ('owned_utilization', 'lease_dependency', 'turnover', 'product') then
    raise exception 'invalid_sort';
  end if;
  if p_sort_direction not in ('asc', 'desc') then
    raise exception 'invalid_sort_direction';
  end if;

  v_from := date_trunc(p_kind, p_from)::date;
  v_upper := (date_trunc(p_kind, p_to)
              + case p_kind when 'year' then interval '1 year' else interval '1 month' end)::date;

  return query
  with periods as (
    select g.period_start::date as period,
           (g.period_start + case p_kind when 'year' then interval '1 year' else interval '1 month' end)::date as period_upper
      from generate_series(v_from, v_upper - case p_kind when 'year' then interval '1 year' else interval '1 month' end,
                           case p_kind when 'year' then interval '1 year' else interval '1 month' end) as g(period_start)
  ),
  products as (
    select pr.id, pr.code, pr.name, pr.unit
      from public.products pr
     where p_product_id is null or pr.id = p_product_id
  ),
  coverage as (
    select p.period, p.period_upper,
           (p.period_upper - p.period)::integer as expected_days,
           count(r.snapshot_date)::integer as snapshot_days
      from periods p
      left join public.inventory_snapshot_runs r
        on r.snapshot_date >= p.period and r.snapshot_date < p.period_upper
     group by p.period, p.period_upper
  ),
  daily as (
    select b.snapshot_date, b.product_id,
           coalesce(sum(b.quantity) filter (where b.ownership = 'owned'), 0) as owned_holding,
           coalesce(sum(b.quantity) filter (where b.ownership = 'owned' and b.storage_kind = 'site'), 0) as owned_site,
           coalesce(sum(b.quantity) filter (where b.ownership = 'leased' and b.storage_kind = 'site'), 0) as leased_site
      from public.inventory_daily_balances b
     where b.snapshot_date >= v_from and b.snapshot_date < v_upper
       and (p_product_id is null or b.product_id = p_product_id)
     group by b.snapshot_date, b.product_id
  ),
  averages as (
    select c.period, pr.id as product_id,
           avg(coalesce(d.owned_holding, 0)) as avg_owned_holding,
           avg(coalesce(d.owned_site, 0)) as avg_owned_site,
           avg(coalesce(d.leased_site, 0)) as avg_leased_site
      from coverage c
      cross join products pr
      join lateral generate_series(c.period, c.period_upper - 1, interval '1 day') as day(snapshot_date) on true
      left join daily d on d.snapshot_date = day.snapshot_date::date and d.product_id = pr.id
     group by c.period, pr.id
  ),
  flows as (
    select date_trunc(p_kind, m.created_at)::date as period, m.product_id,
           coalesce(sum(m.quantity) filter (where m.reason = 'ship' and m.site_id is not null and m.movement_type = 'in'), 0) as shipped,
           coalesce(sum(m.quantity) filter (where m.reason = 'return_from_site' and m.site_id is not null and m.movement_type = 'out'), 0) as returned
      from public.material_movement_ledger m
     where m.created_at >= v_from and m.created_at < v_upper
       and (p_product_id is null or m.product_id = p_product_id)
     group by 1, 2
  ),
  operating_sites as (
    select date_trunc(p_kind, b.snapshot_date)::date as period, b.product_id,
           count(distinct b.site_id)::integer as site_count
      from public.inventory_daily_balances b
     where b.snapshot_date >= v_from and b.snapshot_date < v_upper
       and b.storage_kind = 'site' and b.site_id is not null and b.quantity > 0
       and (p_product_id is null or b.product_id = p_product_id)
     group by 1, 2
  ),
  result as (
    select c.period, pr.id as product_id, pr.code, pr.name, pr.unit,
           c.snapshot_days = c.expected_days and c.expected_days > 0 as available,
           c.snapshot_days, c.expected_days,
           a.avg_owned_holding, a.avg_owned_site, a.avg_leased_site,
           coalesce(f.shipped, 0) as shipped, coalesce(f.returned, 0) as returned,
           coalesce(os.site_count, 0) as site_count
      from coverage c
      cross join products pr
      join averages a on a.period = c.period and a.product_id = pr.id
      left join flows f on f.period = c.period and f.product_id = pr.id
      left join operating_sites os on os.period = c.period and os.product_id = pr.id
  )
  select period, product_id, code, name, unit,
         available, snapshot_days, expected_days,
         case when available then round(avg_owned_holding, 2) else null end,
         case when available then round(avg_owned_site, 2) else null end,
         case when available and avg_owned_holding > 0 then round(avg_owned_site / avg_owned_holding * 100, 2) else null end,
         case when available then round(avg_leased_site, 2) else null end,
         case when available then round(avg_owned_site + avg_leased_site, 2) else null end,
         case when available and avg_owned_site + avg_leased_site > 0 then round(avg_leased_site / (avg_owned_site + avg_leased_site) * 100, 2) else null end,
         shipped, returned, shipped + returned,
         case when available then site_count else null end
    from result
   order by
     period desc,
     case when p_sort = 'owned_utilization' and p_sort_direction = 'desc' then case when available and avg_owned_holding > 0 then avg_owned_site / avg_owned_holding end end desc nulls last,
     case when p_sort = 'owned_utilization' and p_sort_direction = 'asc' then case when available and avg_owned_holding > 0 then avg_owned_site / avg_owned_holding end end asc nulls last,
     case when p_sort = 'lease_dependency' and p_sort_direction = 'desc' then case when available and avg_owned_site + avg_leased_site > 0 then avg_leased_site / (avg_owned_site + avg_leased_site) end end desc nulls last,
     case when p_sort = 'lease_dependency' and p_sort_direction = 'asc' then case when available and avg_owned_site + avg_leased_site > 0 then avg_leased_site / (avg_owned_site + avg_leased_site) end end asc nulls last,
     case when p_sort = 'turnover' and p_sort_direction = 'desc' then shipped + returned end desc,
     case when p_sort = 'turnover' and p_sort_direction = 'asc' then shipped + returned end asc,
     name, product_id;
end;
$$;

revoke execute on function public.analytics_product_utilization(text, date, date, uuid, text, text) from public;
revoke execute on function public.analytics_product_utilization(text, date, date, uuid, text, text) from anon;
grant execute on function public.analytics_product_utilization(text, date, date, uuid, text, text) to authenticated;

-- pg_cron が有効な環境では 23:59 JST (= 14:59 UTC) に当日日付を確定する。
-- pg_cron がない環境でも migration は成功する。導入後に extension を有効化した場合は
-- 下記と同じ cron.schedule を一度実行すること。
do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      select jobid into v_job_id from cron.job where jobname = 'inventory-daily-snapshot-jst' limit 1;
      if v_job_id is not null then
        perform cron.unschedule(v_job_id);
      end if;
      perform cron.schedule(
        'inventory-daily-snapshot-jst',
        '59 14 * * *',
        $cron$select public.capture_inventory_daily_balances((timezone('Asia/Tokyo', now()))::date, 'daily');$cron$
      );
    exception when insufficient_privilege then
      raise notice 'pg_cron exists but this migration role cannot schedule jobs. Schedule inventory-daily-snapshot-jst as a project administrator.';
    end;
  else
    raise notice 'pg_cron is not enabled. Schedule capture_inventory_daily_balances(current JST date, ''daily'') at 23:59 Asia/Tokyo.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 適用後の確認・手計算比較（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- 1. ベースラインと適用時点の現在庫が一致すること（差分 0 件が期待値）
-- with base as (
--   select min(snapshot_date) as d from public.inventory_snapshot_runs
-- ), live as (
--   select ownership, row_id as source_row_id, quantity from public.material_stock_breakdown
-- ), snap as (
--   select b.ownership, b.source_row_id, b.quantity
--     from public.inventory_daily_balances b, base
--    where b.snapshot_date = base.d
-- )
-- select coalesce(l.ownership, s.ownership) as ownership,
--        coalesce(l.source_row_id, s.source_row_id) as source_row_id,
--        l.quantity as live_quantity, s.quantity as snapshot_quantity
--   from live l full join snap s using (ownership, source_row_id)
--  where l.quantity is distinct from s.quantity;
--
-- 2. 同日再実行が冪等であること（行数増加なしが期待値）
-- select public.capture_inventory_daily_balances(
--   (timezone('Asia/Tokyo', now()))::date, 'daily'
-- );
-- select snapshot_date, ownership, source_row_id, count(*)
--   from public.inventory_daily_balances
--  group by 1,2,3 having count(*) > 1;
--
-- 3. 任意の商品・月について、日別owned現場在庫を手計算した平均とRPCの
--    avg_owned_site_quantity が一致することを確認する。
-- select snapshot_date, sum(quantity) as owned_site_quantity
--   from public.inventory_daily_balances
--  where product_id = '<product_id>' and ownership='owned' and storage_kind='site'
--    and snapshot_date >= date '2026-01-01' and snapshot_date < date '2026-02-01'
--  group by snapshot_date order by snapshot_date;
-- select * from public.analytics_product_utilization(
--   'month', date '2026-01-01', date '2026-01-01', '<product_id>', 'owned_utilization', 'desc'
-- );
--
-- pg_cron が未導入の場合は、プロジェクト管理者が UTC 基準で次を登録する。
-- select cron.schedule(
--   'inventory-daily-snapshot-jst', '59 14 * * *',
--   $cron$select public.capture_inventory_daily_balances((timezone('Asia/Tokyo', now()))::date, 'daily');$cron$
-- );

commit;

notify pgrst, 'reload schema';
