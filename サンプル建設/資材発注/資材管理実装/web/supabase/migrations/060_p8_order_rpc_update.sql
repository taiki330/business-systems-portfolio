-- 060_p8_order_rpc_update.sql
-- 059 適用後に Supabase SQL Editor で実行
-- P1-E: 059 で追加した納期・ヤード積込日を、RPC 経由で読み書きできるようにする。
--
-- 反映する決定（docs/20 D-20260805-01）:
--   #1 納期        : 職人（vendor）がオーダー作成時に入力 → create_order_with_requests に引数追加
--   #2 ヤード積込日: サンプル市Aセンター（center）が確認時に入力 → 専用 RPC を新設
--
-- 方針:
--   - orders に広い UPDATE policy を張らず、更新可能な列を限定した RPC を用意する
--     （055 で UPDATE policy を作らない方針とした理由と同じ。site_id や order_number を
--     事務が誤って書き換えられる経路を作らないため）。
--   - create_order_with_requests は引数が変わるため、旧シグネチャを drop してから作り直す。

begin;

-- ===========================================================================
-- 1) create_order_with_requests: 納期（p_delivery_deadline）を受け取る
--    本体ロジックは 057 と同一。納期の INSERT のみ追加。
-- ===========================================================================
drop function if exists public.create_order_with_requests(uuid, jsonb);

create or replace function public.create_order_with_requests(
  p_site_id uuid,
  p_items jsonb,
  p_delivery_deadline timestamptz default null
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

  insert into public.orders (site_id, requested_by, delivery_deadline)
  values (p_site_id, auth.uid()::text, p_delivery_deadline)
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

comment on function public.create_order_with_requests(uuid, jsonb, timestamptz) is
  'vendor が自分の担当現場に対して、オーダーと複数の出庫依頼明細を原子的に作成する。'
  ' 納期（p_delivery_deadline）は職人がオーダー時に入力する（D-20260805-01 #1）。P1-E Phase E-1。';

revoke execute on function public.create_order_with_requests(uuid, jsonb, timestamptz) from public;
revoke execute on function public.create_order_with_requests(uuid, jsonb, timestamptz) from anon;
grant execute on function public.create_order_with_requests(uuid, jsonb, timestamptz) to authenticated;

-- ===========================================================================
-- 2) update_order_yard_loading_date(): ヤード積込日の登録（center / admin）
--    ヒアリングでは「サンプル市Aの人が入力」。admin も帳票運用の代行ができるよう
--    is_admin_or_center() を条件にする（他の帳票系 RPC と同じ粒度）。
-- ===========================================================================
create or replace function public.update_order_yard_loading_date(
  p_order_id uuid,
  p_yard_loading_date date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_or_center() then
    raise exception 'permission_denied: admin or center role required'
      using errcode = '42501';
  end if;

  update public.orders
     set yard_loading_date = p_yard_loading_date
   where id = p_order_id;

  if not found then
    raise exception 'order_not_found';
  end if;
end;
$$;

comment on function public.update_order_yard_loading_date(uuid, date) is
  'admin/center 限定。ヤード積込日を登録する（D-20260805-01 #2）。NULL で取り消し可。';

revoke execute on function public.update_order_yard_loading_date(uuid, date) from public;
revoke execute on function public.update_order_yard_loading_date(uuid, date) from anon;
grant  execute on function public.update_order_yard_loading_date(uuid, date) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc
--  where proname in ('create_order_with_requests','update_order_yard_loading_date');
-- -- 期待: create_order_with_requests(uuid, jsonb, timestamp with time zone) が1件のみ
-- --       （旧 (uuid, jsonb) が残っていないこと）

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.update_order_yard_loading_date(uuid, date);
-- drop function if exists public.create_order_with_requests(uuid, jsonb, timestamptz);
-- -- 057 の本体を再作成すること（057_p8_atomic_order_creation.sql を再実行）
-- commit;
-- notify pgrst, 'reload schema';
