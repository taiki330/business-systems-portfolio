-- 042_p5_utilization_rpc_fix.sql
-- 041 適用後に Supabase SQL Editor で実行
-- Phase 5-2 レビュー修正: analytics_product_utilization が実行時に必ず失敗する不具合の修正
--
-- 背景（実機の開発 Supabase で確認した事象）:
--   select * from public.analytics_product_utilization('month', ..., 'owned_utilization', 'desc');
--     → ERROR: column reference "period" is ambiguous
--   041 の analytics_product_utilization は returns table (period date, ...) で OUT パラメータを
--   宣言している。PL/pgSQL は関数本体の SQL 中に現れる識別子を「PL/pgSQL 変数（= OUT パラメータ）」
--   としても解決しようとするため、最終 SELECT / ORDER BY の無修飾な period・product_id・
--   snapshot_days・avg_owned_holding などが OUT パラメータと result CTE の列の双方に一致し、
--   曖昧参照として実行時エラーになっていた（CTE 内部は既に別名修飾済みで問題ない）。
--   このため 041 適用済み環境でも /analytics/products は常にエラー表示となる。
--
-- 方針:
--   - 041 は適用済みのため直接変更せず、本 migration の create or replace function で置き換える。
--     シグネチャ・返却列・権限・集計ロジックは 041 と同一に保つ（挙動の変更は下記2点のみ）。
--   - 修正1（不具合修正）: 最終 SELECT / ORDER BY の全列参照を result CTE の別名 res で修飾し、
--     OUT パラメータとの曖昧さを解消する。
--   - 修正2（UI との整合）: p_sort = 'product'（商品名並び）のときに p_sort_direction が
--     無視されていた。画面は商品名でも昇順/降順を選択できるため、指定どおり並ぶようにする。
--     他の p_sort 値の並び順は 041 と同一。
--   - スナップショット2表・capture_inventory_daily_balances・pg_cron 登録には一切触れない。
--
-- 冪等性: create or replace function のみ。再実行しても安全。

begin;

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
  -- 修正1: OUT パラメータ（period 等）との曖昧参照を避けるため res. で全列を修飾する。
  select res.period, res.product_id, res.code, res.name, res.unit,
         res.available, res.snapshot_days, res.expected_days,
         case when res.available then round(res.avg_owned_holding, 2) else null end,
         case when res.available then round(res.avg_owned_site, 2) else null end,
         case when res.available and res.avg_owned_holding > 0 then round(res.avg_owned_site / res.avg_owned_holding * 100, 2) else null end,
         case when res.available then round(res.avg_leased_site, 2) else null end,
         case when res.available then round(res.avg_owned_site + res.avg_leased_site, 2) else null end,
         case when res.available and res.avg_owned_site + res.avg_leased_site > 0 then round(res.avg_leased_site / (res.avg_owned_site + res.avg_leased_site) * 100, 2) else null end,
         res.shipped, res.returned, res.shipped + res.returned,
         case when res.available then res.site_count else null end
    from result res
   order by
     res.period desc,
     case when p_sort = 'owned_utilization' and p_sort_direction = 'desc' then case when res.available and res.avg_owned_holding > 0 then res.avg_owned_site / res.avg_owned_holding end end desc nulls last,
     case when p_sort = 'owned_utilization' and p_sort_direction = 'asc' then case when res.available and res.avg_owned_holding > 0 then res.avg_owned_site / res.avg_owned_holding end end asc nulls last,
     case when p_sort = 'lease_dependency' and p_sort_direction = 'desc' then case when res.available and res.avg_owned_site + res.avg_leased_site > 0 then res.avg_leased_site / (res.avg_owned_site + res.avg_leased_site) end end desc nulls last,
     case when p_sort = 'lease_dependency' and p_sort_direction = 'asc' then case when res.available and res.avg_owned_site + res.avg_leased_site > 0 then res.avg_leased_site / (res.avg_owned_site + res.avg_leased_site) end end asc nulls last,
     case when p_sort = 'turnover' and p_sort_direction = 'desc' then res.shipped + res.returned end desc,
     case when p_sort = 'turnover' and p_sort_direction = 'asc' then res.shipped + res.returned end asc,
     -- 修正2: 商品名並びでも画面の昇順/降順指定が反映されるようにする。
     case when p_sort = 'product' and p_sort_direction = 'desc' then res.name end desc nulls last,
     case when p_sort = 'product' and p_sort_direction = 'asc' then res.name end asc nulls last,
     res.name, res.product_id;
end;
$$;

comment on function public.analytics_product_utilization is
  '商品別の平均稼働・リース依存の分析（日次確定在庫スナップショットのみを入力とする）。'
  ' admin/center 限定。Phase 5-2（042 で曖昧参照の実行時エラーと商品名並びの向き指定を修正）';

-- 041 と同一の権限設定を明示的に再適用する（create or replace は既存 ACL を保持するが、
-- 041 未適用環境での単独実行や ACL 差異を防ぐため冪等に指定しておく）。
revoke execute on function public.analytics_product_utilization(text, date, date, uuid, text, text) from public;
revoke execute on function public.analytics_product_utilization(text, date, date, uuid, text, text) from anon;
grant execute on function public.analytics_product_utilization(text, date, date, uuid, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) エラーにならずに実行できること（0 行でも成功であればよい）
-- select * from public.analytics_product_utilization(
--   'month', (date_trunc('month', now()))::date, (date_trunc('month', now()))::date,
--   null, 'owned_utilization', 'desc'
-- );
--
-- -- (b) 並び順の指定が効くこと（商品名 昇順 / 降順で先頭行が入れ替わること）
-- select product_name from public.analytics_product_utilization(
--   'month', (date_trunc('month', now()))::date, (date_trunc('month', now()))::date,
--   null, 'product', 'asc'
-- ) limit 3;
-- select product_name from public.analytics_product_utilization(
--   'month', (date_trunc('month', now()))::date, (date_trunc('month', now()))::date,
--   null, 'product', 'desc'
-- ) limit 3;
--
-- -- (c) EXECUTE 権限が authenticated のみであること
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='analytics_product_utilization'
--  order by grantee;
-- -- 期待: authenticated EXECUTE のみ（anon / public は 0 行）
--
-- -- (d) 日次スナップショットの cron が登録されているか（pg_cron 有効時のみ行が返る）
-- select jobname, schedule, active from cron.job where jobname = 'inventory-daily-snapshot-jst';

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合）
-- ---------------------------------------------------------------------------
-- 041 の定義に戻す（= 曖昧参照エラーが再発する状態に戻る）。通常は不要。
-- 041_p5_utilization_snapshots.sql の
-- 「create or replace function public.analytics_product_utilization(...)」ブロックを
-- そのまま再実行すること。
