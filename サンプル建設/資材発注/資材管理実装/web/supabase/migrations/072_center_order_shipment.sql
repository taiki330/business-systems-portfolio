-- 072_center_order_shipment.sql
-- 071 適用後に Supabase SQL Editor で実行
-- センターがオーダー詳細から、未出庫の全明細を一度だけ出庫完了できるようにする。

begin;

-- 069/071 の最終防衛トリガーに、下記 SECURITY DEFINER RPC の実行中だけを追加する。
-- クライアントからの通常の更新は、引き続き yard_loading_date 以外拒否する。
create or replace function public.prevent_center_data_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_app_role() = 'center' then
    if current_setting('app.center_order_shipping', true) = 'on'
       and tg_table_name in ('stock_requests', 'stock_items', 'stock_ledger') then
      if tg_op = 'DELETE' then
        return old;
      end if;
      return new;
    end if;

    if tg_table_name = 'orders'
       and tg_op = 'UPDATE'
       and (to_jsonb(new) - 'yard_loading_date') is not distinct from
           (to_jsonb(old) - 'yard_loading_date') then
      return new;
    end if;

    raise exception 'permission_denied: center role is read only except yard loading date and order shipment'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.ship_order_to_site(
  p_order_id uuid,
  p_shipped_by text default null
)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request record;
  v_request_ids uuid[] := '{}';
  v_count integer := 0;
begin
  if public.current_app_role() not in ('center', 'internal') then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  -- この関数内で起きる在庫・依頼更新だけをトリガーに識別させる。
  perform set_config('app.center_order_shipping', 'on', true);

  -- 先に全明細をロックして状態を検証する。1行でも出庫済み等なら何も動かさない。
  for v_request in
    select id, status
      from public.stock_requests
     where order_id = p_order_id
     order by id
     for update
  loop
    v_count := v_count + 1;
    if v_request.status = 'shipped' then
      raise exception 'order_already_shipped';
    end if;
    if v_request.status not in ('requested', 'accepted') then
      raise exception 'order_contains_unshippable_items';
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'order_has_no_items';
  end if;

  -- requested は同じトランザクション内で受付済みにして、既存の在庫移動処理を再利用する。
  update public.stock_requests
     set status = 'accepted',
         accepted_at = coalesce(accepted_at, now()),
         accepted_by = coalesce(accepted_by, p_shipped_by)
   where order_id = p_order_id
     and status = 'requested';

  for v_request in
    select id
      from public.stock_requests
     where order_id = p_order_id
     order by id
  loop
    perform public.ship_stock_request(v_request.id, p_shipped_by);
    v_request_ids := array_append(v_request_ids, v_request.id);
  end loop;

  return v_request_ids;
end;
$$;

comment on function public.prevent_center_data_changes() is
  'center を原則参照専用にする最終防衛。ヤード積込日とセンター出庫完了RPC内部の在庫反映のみ許可する。D-20260806-07。';

comment on function public.ship_order_to_site(uuid, text) is
  'center 限定。オーダーの全明細を原子的に出庫し、センター在庫と現場在庫を更新する。D-20260806-07。';

grant execute on function public.ship_order_to_site(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ROLLBACK:
-- 071 の prevent_center_data_changes を再実行し、
-- drop function public.ship_order_to_site(uuid, text); を実行すること。
