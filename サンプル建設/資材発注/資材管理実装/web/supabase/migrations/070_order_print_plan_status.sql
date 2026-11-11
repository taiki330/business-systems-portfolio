-- 070_order_print_plan_status.sql
-- 069 適用後に Supabase SQL Editor で実行
-- 資材発注書へ、予定数量超過の判定を明示表示するための帳票専用 RPC。
-- center は site_product_plans / 在庫台帳を直接参照させず、印刷対象オーダーの
-- 判定結果だけを受け取る。

begin;

create or replace function public.get_order_plan_status(p_order_id uuid)
returns table (
  request_id uuid,
  planned_quantity numeric,
  expected_quantity numeric,
  over_quantity numeric,
  is_over boolean,
  plan_missing boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.request_id,
    s.planned_quantity,
    s.expected_quantity,
    s.over_quantity,
    s.is_over,
    s.plan_missing
  from public.stock_request_plan_status s
  join public.stock_requests r on r.id = s.request_id
  where r.order_id = p_order_id
    and public.current_app_role() in ('admin', 'center', 'internal')
  order by s.request_id;
$$;

comment on function public.get_order_plan_status(uuid) is
  '資材発注書の予定数量判定用。見込数量=既出庫+全未処理オーダー。admin/center の印刷用途のみ。D-20260806-05。';

revoke execute on function public.get_order_plan_status(uuid) from public;
revoke execute on function public.get_order_plan_status(uuid) from anon;
grant execute on function public.get_order_plan_status(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ROLLBACK:
-- drop function if exists public.get_order_plan_status(uuid);
