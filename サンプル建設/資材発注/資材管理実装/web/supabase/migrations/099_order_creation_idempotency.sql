-- 099_order_creation_idempotency.sql
-- 現場発注の再送・二重タップで、同じオーダーと明細を二重作成しない。

begin;

alter table public.orders
  add column if not exists create_operation_id uuid;

alter table public.stock_requests
  add column if not exists create_operation_id uuid;

create unique index if not exists orders_create_operation_id_uidx
  on public.orders (create_operation_id)
  where create_operation_id is not null;

create unique index if not exists stock_requests_create_operation_product_uidx
  on public.stock_requests (create_operation_id, product_id)
  where create_operation_id is not null;

create or replace function public.create_order_with_requests(
  p_site_id uuid,
  p_items jsonb,
  p_delivery_deadline timestamptz default null,
  p_yard_loading_date date default null,
  p_operation_id uuid default null
)
returns table (
  order_id uuid,
  request_id uuid,
  product_id uuid,
  quantity numeric,
  created_new boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_site_name text;
  v_requester_label text;
  v_prime_contractor_name text;
  v_prime_contractor_slip_number text;
  v_slip_site_number integer;
  v_item record;
  v_item_count integer := 0;
  v_product_code text;
  v_product_name text;
  v_product_unit text;
  v_product_weight_kg numeric(12, 3);
  v_product_category_name text;
  v_ownership_auto text;
  v_expected_items jsonb;
  v_existing_items jsonb;
  v_existing_order record;
begin
  if public.current_app_role() is distinct from 'vendor' then
    raise exception 'permission_denied: vendor role required' using errcode = '42501';
  end if;
  if p_operation_id is null then
    raise exception 'operation_id_required';
  end if;
  if p_site_id is null or not public.user_can_access_site(p_site_id) then
    raise exception 'permission_denied: site does not match account' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_order_items';
  end if;

  select jsonb_agg(
           jsonb_build_object('product_id', grouped.product_id, 'quantity', grouped.quantity)
           order by grouped.product_id
         )
    into v_expected_items
    from (
      select item.product_id, sum(item.quantity) as quantity
        from jsonb_to_recordset(p_items) as item(product_id uuid, quantity numeric)
       group by item.product_id
    ) grouped;

  if v_expected_items is null then
    raise exception 'invalid_order_items';
  end if;

  select id, site_id, requested_by, delivery_deadline, yard_loading_date
    into v_existing_order
    from public.orders
   where create_operation_id = p_operation_id;

  if found then
    select jsonb_agg(
             jsonb_build_object('product_id', r.product_id, 'quantity', r.quantity)
             order by r.product_id
           )
      into v_existing_items
      from public.stock_requests r
     where r.create_operation_id = p_operation_id;

    if v_existing_order.site_id is distinct from p_site_id
       or v_existing_order.requested_by is distinct from auth.uid()::text
       or v_existing_order.delivery_deadline is distinct from p_delivery_deadline
       or v_existing_order.yard_loading_date is distinct from p_yard_loading_date
       or v_existing_items is distinct from v_expected_items then
      raise exception 'operation_id_conflict';
    end if;

    return query
      select r.order_id, r.id, r.product_id, r.quantity, false
        from public.stock_requests r
       where r.create_operation_id = p_operation_id
       order by r.product_id;
    return;
  end if;

  select s.name, pc.name, pc.slip_number, s.slip_site_number
    into v_site_name, v_prime_contractor_name, v_prime_contractor_slip_number, v_slip_site_number
    from public.sites s
    left join public.prime_contractors pc on pc.id = s.prime_contractor_id
   where s.id = p_site_id;
  if not found then
    raise exception 'site_not_found';
  end if;

  select nullif(trim(au.display_name), '') into v_requester_label
    from public.app_users au where au.id::text = auth.uid()::text;

  insert into public.orders (
    site_id, requested_by, delivery_deadline, yard_loading_date, create_operation_id,
    site_name_snapshot, requester_label_snapshot,
    prime_contractor_name_snapshot, prime_contractor_slip_number_snapshot,
    slip_site_number_snapshot
  ) values (
    p_site_id, auth.uid()::text, p_delivery_deadline, p_yard_loading_date, p_operation_id,
    v_site_name, v_requester_label,
    v_prime_contractor_name, v_prime_contractor_slip_number, v_slip_site_number
  )
  on conflict (create_operation_id) where create_operation_id is not null do nothing
  returning id into v_order_id;

  -- 同時送信で別リクエストが先に登録した場合も、既存結果を返す。
  if v_order_id is null then
    select id, site_id, requested_by, delivery_deadline, yard_loading_date
      into v_existing_order
      from public.orders
     where create_operation_id = p_operation_id;

    select jsonb_agg(
             jsonb_build_object('product_id', r.product_id, 'quantity', r.quantity)
             order by r.product_id
           )
      into v_existing_items
      from public.stock_requests r
     where r.create_operation_id = p_operation_id;

    if not found
       or v_existing_order.site_id is distinct from p_site_id
       or v_existing_order.requested_by is distinct from auth.uid()::text
       or v_existing_order.delivery_deadline is distinct from p_delivery_deadline
       or v_existing_order.yard_loading_date is distinct from p_yard_loading_date
       or v_existing_items is distinct from v_expected_items then
      raise exception 'operation_id_conflict';
    end if;

    return query
      select r.order_id, r.id, r.product_id, r.quantity, false
        from public.stock_requests r
       where r.create_operation_id = p_operation_id
       order by r.product_id;
    return;
  end if;

  for v_item in
    select item.product_id, item.quantity as requested_quantity
      from jsonb_to_recordset(v_expected_items) as item(product_id uuid, quantity numeric)
  loop
    if v_item.product_id is null or v_item.requested_quantity is null or v_item.requested_quantity <= 0 then
      raise exception 'invalid_quantity';
    end if;

    select p.code, p.name, p.unit, p.weight_kg, pc.name
      into v_product_code, v_product_name, v_product_unit, v_product_weight_kg, v_product_category_name
      from public.products p
      left join public.product_categories pc on pc.id = p.category_id
     where p.id = v_item.product_id;
    if not found then
      raise exception 'invalid_product_id';
    end if;

    select pok.ownership_kind into v_ownership_auto
      from public.product_ownership_kind pok
     where pok.product_id = v_item.product_id;
    v_ownership_auto := coalesce(v_ownership_auto, 'owned');

    insert into public.stock_requests (
      site_id, product_id, quantity, requested_by, order_id, create_operation_id,
      product_code_snapshot, product_name_snapshot, product_unit_snapshot,
      product_weight_kg_snapshot, product_category_name_snapshot, ownership_auto_snapshot
    ) values (
      p_site_id, v_item.product_id, v_item.requested_quantity, auth.uid()::text, v_order_id, p_operation_id,
      v_product_code, v_product_name, v_product_unit,
      v_product_weight_kg, v_product_category_name, v_ownership_auto
    ) returning id into request_id;

    order_id := v_order_id;
    product_id := v_item.product_id;
    quantity := v_item.requested_quantity;
    created_new := true;
    v_item_count := v_item_count + 1;
    return next;
  end loop;

  if v_item_count = 0 then
    raise exception 'invalid_order_items';
  end if;
end;
$$;

comment on function public.create_order_with_requests(uuid, jsonb, timestamptz, date, uuid) is
  '現場が担当現場に対して、オーダーと複数明細を原子的に作成する。operation_idで再送を冪等化する。';

-- 旧4引数版は operation_id を持たず二重作成を防げないため、外部実行を停止する。
revoke execute on function public.create_order_with_requests(uuid, jsonb, timestamptz, date)
  from public, anon, authenticated;
revoke execute on function public.create_order_with_requests(uuid, jsonb, timestamptz, date, uuid)
  from public, anon;
grant execute on function public.create_order_with_requests(uuid, jsonb, timestamptz, date, uuid)
  to authenticated;

commit;

notify pgrst, 'reload schema';
