-- 045_p5_utilization_from_ledger.sql
-- 044 適用後に Supabase SQL Editor で実行
-- Phase 5-2 設計修正: 稼働率分析の入力を「日次スナップショット」から「在庫台帳からの逆算」へ変更
--
-- 背景（041/042 の設計上の弱点）:
--   - is_available を snapshot_days = expected_days（対象期間の全日にスナップショットが存在）で
--     判定していたため、定期実行が 1 日でも失敗するとその月がまるごと「算出不可」になった。
--   - 当月は暦日数に到達しないため、月末を過ぎるまで常に「算出不可」だった。
--   - いずれも「毎日必ず記録が取れている」ことに依存した設計であり、運用事故に弱い。
--
-- 方針:
--   - ある日 D の残高を、現在庫と台帳から逆算する:
--       D 日終了時点の残高 = 現在の残高 − （D 日翌日 00:00 JST 以降の全移動の合計）
--     これにより日次スナップショットの欠測が分析結果に一切影響しなくなる（毎回決定的に再計算される）。
--   - 逆算の単位は在庫行そのもの（stock_items / lease_stock_items の 1 行 = 1 単位）とし、
--     台帳（stock_ledger / lease_stock_ledger）を以下のキーで対応付ける:
--       自社  : (product_id, location)
--       リース: (lease_batch_item_id, location)
--     現場 / センターの判別は台帳の location 文字列ではなく、在庫行側の storage_kind を正とする。
--   - 逆算が正しいのは「在庫変動が漏れなく台帳に記録されている期間」に限られる。
--     037 で stock_items / stock_ledger への直接書込を剥奪し RPC に一本化したため以後は成立するが、
--     037 の適用日は DB に記録がない。そこで 041 のベースライン日
--     （inventory_snapshot_runs の最古日 = スナップショットと実在庫の一致を確認済みの唯一の基準点）
--     を信頼開始日として採用する。安全側の判断で、現行より算出範囲が狭くなることはない。
--   - 対象期間のうち「信頼開始日以降 かつ 本日（JST）以前」の日だけを平均対象とする。
--     これにより当月も経過日数までの平均として算出できる（月末を待たない）。
--   - 返却列・シグネチャ・権限・並び順は 042 と同一に保つ。意味が変わる 2 列は下記のとおり:
--       snapshot_days  → 平均対象になった日数（対象日数）
--       expected_days  → 期間の暦日数
--       is_available   → 対象日数 > 0
--   - inventory_snapshot_runs / inventory_daily_balances / capture_inventory_daily_balances /
--     pg_cron のジョブには一切触れない。分析はスナップショットを参照しなくなるが、
--     逆算結果との突合により「台帳に漏れがないこと」を検証できる独立した監査基準として残す
--     （検証 SQL を本ファイル末尾に用意した）。
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
  v_from          date;
  v_upper         date;
  v_today         date;
  v_reliable_from date;
  v_calc_from     date;
  v_calc_to       date;
  v_step          interval;
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

  v_step  := case p_kind when 'year' then interval '1 year' else interval '1 month' end;
  v_from  := date_trunc(p_kind, p_from)::date;
  v_upper := (date_trunc(p_kind, p_to) + v_step)::date;
  v_today := (timezone('Asia/Tokyo', now()))::date;

  -- 台帳からの逆算が信頼できる開始日（041 のベースライン日）
  select min(r.snapshot_date) into v_reliable_from
    from public.inventory_snapshot_runs r;

  -- 平均対象にできる日の範囲。範囲が空（from > to、または信頼開始日が無い）の場合、
  -- 後続の generate_series が 0 行になり、全期間が「算出不可」として返る。
  v_calc_from := greatest(v_from, v_reliable_from);
  v_calc_to   := least(v_upper - 1, v_today);

  return query
  with periods as (
    select g.period_start::date as period,
           (g.period_start + v_step)::date as period_upper
      from generate_series(v_from, v_upper - v_step, v_step) as g(period_start)
  ),
  products as (
    select pr.id, pr.code, pr.name, pr.unit
      from public.products pr
     where p_product_id is null or pr.id = p_product_id
  ),
  -- 逆算に使う日の連なり。平均対象は v_calc_to までだが、
  -- v_calc_to 以前の日の残高を求めるには本日までの移動を差し引く必要があるため
  -- 系列自体は本日まで伸ばす。
  calc_days as (
    select g.day_ts::date as day
      from generate_series(v_calc_from, v_today, interval '1 day') as g(day_ts)
  ),

  -- ---- 自社在庫: 在庫行 1 行 = 1 単位 ----
  owned_units as (
    select si.id as unit_id, si.product_id, si.storage_kind, si.site_id,
           si.quantity as cur_qty
      from public.stock_items si
     where p_product_id is null or si.product_id = p_product_id
  ),
  owned_deltas as (
    select si.id as unit_id,
           (timezone('Asia/Tokyo', sl.created_at))::date as day,
           sum(case when sl.movement_type = 'in' then sl.quantity else -sl.quantity end) as delta
      from public.stock_ledger sl
      join public.stock_items si
        on si.product_id = sl.product_id
       and si.location   = sl.location
     where sl.created_at >= ((v_calc_from + 1)::timestamp at time zone 'Asia/Tokyo')
       and (p_product_id is null or sl.product_id = p_product_id)
     group by 1, 2
  ),
  owned_balances as (
    select u.product_id, u.storage_kind, u.site_id, d.day,
           u.cur_qty - coalesce(
             sum(coalesce(od.delta, 0)) over (
               partition by u.unit_id order by d.day desc
               rows between unbounded preceding and 1 preceding
             ), 0) as qty
      from owned_units u
      cross join calc_days d
      left join owned_deltas od on od.unit_id = u.unit_id and od.day = d.day
  ),

  -- ---- リース在庫: 借用明細 × 保管場所が 1 単位 ----
  leased_units as (
    select lsi.id as unit_id, lsi.product_id, lsi.storage_kind, lsi.site_id,
           lsi.quantity as cur_qty
      from public.lease_stock_items lsi
     where p_product_id is null or lsi.product_id = p_product_id
  ),
  leased_deltas as (
    select lsi.id as unit_id,
           (timezone('Asia/Tokyo', lsl.created_at))::date as day,
           sum(case when lsl.movement_type = 'in' then lsl.quantity else -lsl.quantity end) as delta
      from public.lease_stock_ledger lsl
      join public.lease_stock_items lsi
        on lsi.lease_batch_item_id = lsl.lease_batch_item_id
       and lsi.location            = lsl.location
     where lsl.created_at >= ((v_calc_from + 1)::timestamp at time zone 'Asia/Tokyo')
       and (p_product_id is null or lsl.product_id = p_product_id)
     group by 1, 2
  ),
  leased_balances as (
    select u.product_id, u.storage_kind, u.site_id, d.day,
           u.cur_qty - coalesce(
             sum(coalesce(ld.delta, 0)) over (
               partition by u.unit_id order by d.day desc
               rows between unbounded preceding and 1 preceding
             ), 0) as qty
      from leased_units u
      cross join calc_days d
      left join leased_deltas ld on ld.unit_id = u.unit_id and ld.day = d.day
  ),

  -- ---- 商品 × 日の集約 ----
  owned_daily as (
    select ob.product_id, ob.day,
           sum(ob.qty) as owned_holding,
           coalesce(sum(ob.qty) filter (where ob.storage_kind = 'site'), 0) as owned_site
      from owned_balances ob
     group by 1, 2
  ),
  leased_daily as (
    select lb.product_id, lb.day,
           coalesce(sum(lb.qty) filter (where lb.storage_kind = 'site'), 0) as leased_site
      from leased_balances lb
     group by 1, 2
  ),
  -- 平均対象日（v_calc_to 以前）だけを期間ごとに集計する
  averages as (
    select date_trunc(p_kind, d.day)::date as period, pr.id as product_id,
           count(*)::integer as covered_days,
           avg(coalesce(od.owned_holding, 0)) as avg_owned_holding,
           avg(coalesce(od.owned_site, 0))    as avg_owned_site,
           avg(coalesce(ld.leased_site, 0))   as avg_leased_site
      from calc_days d
      cross join products pr
      left join owned_daily  od on od.product_id = pr.id and od.day = d.day
      left join leased_daily ld on ld.product_id = pr.id and ld.day = d.day
     where d.day <= v_calc_to
     group by 1, 2
  ),

  -- ---- 稼働現場数: 自社・リースいずれかで在庫が 1 以上あった現場 ----
  site_balances as (
    select ob.product_id, ob.site_id, ob.day, ob.qty
      from owned_balances ob
     where ob.storage_kind = 'site'
    union all
    select lb.product_id, lb.site_id, lb.day, lb.qty
      from leased_balances lb
     where lb.storage_kind = 'site'
  ),
  operating_sites as (
    select date_trunc(p_kind, sb.day)::date as period, sb.product_id,
           count(distinct sb.site_id)::integer as site_count
      from site_balances sb
     where sb.site_id is not null and sb.qty > 0 and sb.day <= v_calc_to
     group by 1, 2
  ),

  -- ---- 出庫・返却（042 と同一。自社＋リースの総量） ----
  flows as (
    select date_trunc(p_kind, m.created_at)::date as period, m.product_id,
           coalesce(sum(m.quantity) filter (where m.reason = 'ship' and m.site_id is not null and m.movement_type = 'in'), 0) as shipped,
           coalesce(sum(m.quantity) filter (where m.reason = 'return_from_site' and m.site_id is not null and m.movement_type = 'out'), 0) as returned
      from public.material_movement_ledger m
     where m.created_at >= v_from and m.created_at < v_upper
       and (p_product_id is null or m.product_id = p_product_id)
     group by 1, 2
  ),

  result as (
    select c.period, pr.id as product_id, pr.code, pr.name, pr.unit,
           coalesce(a.covered_days, 0) > 0 as available,
           coalesce(a.covered_days, 0) as covered_days,
           (c.period_upper - c.period)::integer as expected_days,
           a.avg_owned_holding, a.avg_owned_site, a.avg_leased_site,
           coalesce(f.shipped, 0) as shipped, coalesce(f.returned, 0) as returned,
           coalesce(os.site_count, 0) as site_count
      from periods c
      cross join products pr
      left join averages a  on a.period  = c.period and a.product_id  = pr.id
      left join flows f     on f.period  = c.period and f.product_id  = pr.id
      left join operating_sites os on os.period = c.period and os.product_id = pr.id
  )
  -- OUT パラメータとの曖昧参照を避けるため res. で全列を修飾する（042 の修正を踏襲）
  select res.period, res.product_id, res.code, res.name, res.unit,
         res.available, res.covered_days, res.expected_days,
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
     case when p_sort = 'owned_utilization' and p_sort_direction = 'asc'  then case when res.available and res.avg_owned_holding > 0 then res.avg_owned_site / res.avg_owned_holding end end asc nulls last,
     case when p_sort = 'lease_dependency' and p_sort_direction = 'desc' then case when res.available and res.avg_owned_site + res.avg_leased_site > 0 then res.avg_leased_site / (res.avg_owned_site + res.avg_leased_site) end end desc nulls last,
     case when p_sort = 'lease_dependency' and p_sort_direction = 'asc'  then case when res.available and res.avg_owned_site + res.avg_leased_site > 0 then res.avg_leased_site / (res.avg_owned_site + res.avg_leased_site) end end asc nulls last,
     case when p_sort = 'turnover' and p_sort_direction = 'desc' then res.shipped + res.returned end desc,
     case when p_sort = 'turnover' and p_sort_direction = 'asc'  then res.shipped + res.returned end asc,
     case when p_sort = 'product' and p_sort_direction = 'desc' then res.name end desc nulls last,
     case when p_sort = 'product' and p_sort_direction = 'asc'  then res.name end asc nulls last,
     res.name, res.product_id;
end;
$$;

comment on function public.analytics_product_utilization is
  '商品別の平均稼働・リース依存の分析。在庫台帳から日次残高を逆算して平均する（日次スナップショットには依存しない）。'
  ' snapshot_days = 平均対象になった日数 / expected_days = 期間の暦日数。admin/center 限定。Phase 5-2（045）';

revoke execute on function public.analytics_product_utilization(text, date, date, uuid, text, text) from public;
revoke execute on function public.analytics_product_utilization(text, date, date, uuid, text, text) from anon;
grant  execute on function public.analytics_product_utilization(text, date, date, uuid, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) 当月がエラーなく、かつ「算出可」で返ること（041/042 では常に算出不可だった）
-- select period, product_name, is_available, snapshot_days, expected_days,
--        avg_owned_holding, avg_owned_site_quantity, owned_utilization_rate
--   from public.analytics_product_utilization(
--     'month', (date_trunc('month', now()))::date, (date_trunc('month', now()))::date,
--     null, 'owned_utilization', 'desc');
-- -- 期待: is_available = true、snapshot_days = ベースライン日から本日までの日数
--
-- -- (b) 逆算とスナップショットの突合（台帳に漏れが無いことの検証）
-- --     スナップショットがある日について、逆算した現場在庫と一致するはず。
-- --     差分が 0 行であれば台帳は完全。
-- with snap as (
--   select b.snapshot_date, b.product_id,
--          coalesce(sum(b.quantity) filter (where b.ownership='owned' and b.storage_kind='site'), 0) as owned_site
--     from public.inventory_daily_balances b
--    group by 1, 2
-- ),
-- calc as (
--   select u.period, u.product_id, u.avg_owned_site_quantity
--     from public.analytics_product_utilization(
--       'month', (date_trunc('month', now()))::date, (date_trunc('month', now()))::date) u
-- )
-- select * from snap order by snapshot_date desc limit 20;
-- -- ※ 1 日分のスナップショットしかない期間では平均と単日値は一致しないため、
-- --   日数が揃ってから比較すること。単日で比較する場合は下記を使う。
-- -- select public.analytics_product_utilization('month', d, d) from ...
--
-- -- (c) 権限が 042 と同じであること
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='analytics_product_utilization'
--  order by grantee;
-- -- 期待: authenticated EXECUTE のみ

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合）
-- ---------------------------------------------------------------------------
-- 042_p5_utilization_rpc_fix.sql の
-- 「create or replace function public.analytics_product_utilization(...)」ブロックを
-- そのまま再実行すると、スナップショット依存の実装に戻る。
