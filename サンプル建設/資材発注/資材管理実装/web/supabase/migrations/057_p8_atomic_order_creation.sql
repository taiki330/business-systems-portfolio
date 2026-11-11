-- 057_p8_atomic_order_creation.sql
-- 056 適用後に Supabase SQL Editor で実行
-- P1-E Phase E-1: オーダーと出庫依頼明細を同一トランザクションで登録する。
--
-- 055 時点では App 側で orders → stock_requests を順に INSERT していたため、
-- 明細の INSERT が失敗した場合に空の orders 行だけが残る余地があった。
-- この RPC は両方を一括登録し、検証エラーを含む失敗時には全てロールバックする。

begin;

create or replace function public.create_order_with_requests(
  p_site_id uuid,
  p_items jsonb
)
returns table (
  order_id uuid,
  request_id uuid,
  product_id uuid,
  quantity numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_item record;
  v_item_count integer := 0;
begin
  if public.current_app_role() <> 'vendor' then
    raise exception 'permission_denied: vendor role required'
      using errcode = '42501';
  end if;

  -- 1アカウント=1現場。vendor_sites の複数紐付けではなく、ログイン中の
  -- app_users.site_id と完全一致する現場だけに登録を許可する。
  if p_site_id is null or p_site_id is distinct from public.current_site_id() then
    raise exception 'permission_denied: site does not match account'
      using errcode = '42501';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_order_items';
  end if;

  insert into public.orders (site_id, requested_by)
  values (p_site_id, auth.uid()::text)
  returning id into v_order_id;

  for v_item in
    select item.product_id, sum(item.quantity) as requested_quantity
      from jsonb_to_recordset(p_items) as item(product_id uuid, quantity numeric)
     group by item.product_id
  loop
    if v_item.product_id is null
       or v_item.requested_quantity is null
       or v_item.requested_quantity <= 0 then
      raise exception 'invalid_quantity';
    end if;

    if not exists (select 1 from public.products p where p.id = v_item.product_id) then
      raise exception 'invalid_product_id';
    end if;

    insert into public.stock_requests (
      site_id, product_id, quantity, requested_by, order_id
    ) values (
      p_site_id, v_item.product_id, v_item.requested_quantity, auth.uid()::text, v_order_id
    )
    returning id into request_id;

    order_id := v_order_id;
    product_id := v_item.product_id;
    quantity := v_item.requested_quantity;
    v_item_count := v_item_count + 1;
    return next;
  end loop;

  if v_item_count = 0 then
    raise exception 'invalid_order_items';
  end if;
end;
$$;

comment on function public.create_order_with_requests(uuid, jsonb) is
  'vendor が自分の担当現場に対して、オーダーと複数の出庫依頼明細を原子的に作成する。P1-E Phase E-1。';

revoke execute on function public.create_order_with_requests(uuid, jsonb) from public;
revoke execute on function public.create_order_with_requests(uuid, jsonb) from anon;
grant execute on function public.create_order_with_requests(uuid, jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc where proname = 'create_order_with_requests';

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- drop function if exists public.create_order_with_requests(uuid, jsonb);
