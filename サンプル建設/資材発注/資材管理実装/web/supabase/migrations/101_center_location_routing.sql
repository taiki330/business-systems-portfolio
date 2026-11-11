-- センターを追加しても、現場の返却先をサンプル市A固定にしない。
-- 自社材・リース材とも、現場に紐づくセンターへ戻す。
begin;

create or replace function public.apply_lease_stock_movement(
  p_batch_item_id uuid,
  p_storage_kind text,
  p_site_id uuid,
  p_delta numeric,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_location text;
  v_stock_site_id uuid;
  v_center_id uuid;
  v_product_id uuid;
  v_lease_company_id uuid;
  v_current numeric(12, 2);
begin
  if p_delta = 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  if p_storage_kind = 'center' then
    -- 現場返却時だけ p_site_id を返却元現場として受け取り、返却先センターを決める。
    if p_site_id is not null then
      select center_id into v_center_id from public.sites where id = p_site_id;
      if v_center_id is null then raise exception 'site_not_found'; end if;
    else
      v_center_id := public.current_center_id();
      if v_center_id is null then raise exception 'center_account_required'; end if;
    end if;
    v_location := public.center_stock_location(v_center_id);
    v_stock_site_id := null;
  elsif p_storage_kind = 'site' then
    if p_site_id is null then raise exception 'invalid_storage_location'; end if;
    v_location := public.site_stock_location(p_site_id);
    v_stock_site_id := p_site_id;
  else
    raise exception 'invalid_storage_location';
  end if;

  select bi.product_id, b.lease_company_id
    into v_product_id, v_lease_company_id
    from public.lease_batch_items bi
    join public.lease_batches b on b.id = bi.lease_batch_id
   where bi.id = p_batch_item_id;
  if not found then raise exception 'lease_batch_item_not_found'; end if;

  insert into public.lease_stock_items (
    lease_batch_item_id, product_id, lease_company_id,
    storage_kind, site_id, location, quantity
  ) values (
    p_batch_item_id, v_product_id, v_lease_company_id,
    p_storage_kind, v_stock_site_id, v_location, 0
  ) on conflict (lease_batch_item_id, location) do nothing;

  select quantity into v_current
    from public.lease_stock_items
   where lease_batch_item_id = p_batch_item_id and location = v_location
   for update;
  if v_current is null then raise exception 'lease_stock_item_not_found'; end if;
  if p_delta < 0 and v_current < abs(p_delta) then
    raise exception 'insufficient_lease_stock';
  end if;

  update public.lease_stock_items set quantity = quantity + p_delta
   where lease_batch_item_id = p_batch_item_id and location = v_location;

  insert into public.lease_stock_ledger (
    lease_batch_item_id, product_id, lease_company_id,
    location, site_id, movement_type, reason, quantity, created_by
  ) values (
    p_batch_item_id, v_product_id, v_lease_company_id,
    v_location, v_stock_site_id,
    case when p_delta > 0 then 'in' else 'out' end,
    p_reason, abs(p_delta), public.current_actor_id()
  );
end;
$$;

create or replace function public.return_from_site(
  p_product_id uuid,
  p_site_id uuid,
  p_quantity numeric,
  p_memo text default null,
  p_returned_by text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site_location text;
  v_center_id uuid;
  v_center_location text;
  v_site_quantity numeric(12,2);
  v_normal numeric(12,2);
  v_over numeric(12,2);
  v_return_id uuid;
  v_over_id uuid;
  v_site_ledger_id uuid;
  v_center_ledger_id uuid;
  v_detail jsonb;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity_must_be_positive'; end if;

  select center_id into v_center_id from public.sites where id = p_site_id;
  if v_center_id is null then raise exception 'site_not_found'; end if;
  v_site_location := public.site_stock_location(p_site_id);
  v_center_location := public.center_stock_location(v_center_id);

  select quantity into v_site_quantity from public.stock_items
   where product_id = p_product_id and location = v_site_location and storage_kind = 'site'
   for update;
  v_site_quantity := coalesce(v_site_quantity, 0);
  v_normal := least(p_quantity, v_site_quantity);
  v_over := p_quantity - v_normal;
  v_detail := jsonb_build_object('input_quantity', p_quantity, 'normal_quantity', v_normal, 'over_quantity', v_over);

  if v_normal > 0 then
    update public.stock_items set quantity = quantity - v_normal
     where product_id = p_product_id and location = v_site_location;

    insert into public.stock_items(product_id, location, storage_kind, center_id, quantity)
    values (p_product_id, v_center_location, 'center', v_center_id, 0)
    on conflict (product_id, location) do nothing;

    perform 1 from public.stock_items
     where product_id = p_product_id and location = v_center_location for update;
    update public.stock_items set quantity = quantity + v_normal
     where product_id = p_product_id and location = v_center_location;

    insert into public.stock_ledger(product_id, location, movement_type, quantity, site_id, created_by)
    values (p_product_id, v_center_location, 'in', v_normal, null, public.current_actor_id())
    returning id into v_center_ledger_id;
    insert into public.stock_ledger(product_id, location, movement_type, quantity, site_id, created_by)
    values (p_product_id, v_site_location, 'out', v_normal, p_site_id, public.current_actor_id())
    returning id into v_site_ledger_id;

    insert into public.stock_returns(product_id, site_id, quantity, memo, returned_by, site_ledger_id, center_ledger_id)
    values (p_product_id, p_site_id, v_normal, p_memo, p_returned_by, v_site_ledger_id, v_center_ledger_id)
    returning id into v_return_id;
    perform public.log_operation('stock_return.created', 'stock_return', v_return_id, p_site_id, p_product_id, v_normal, v_detail);
  end if;

  if v_over > 0 then
    insert into public.over_returns(product_id, site_id, quantity, input_quantity, normal_quantity, stock_return_id, reported_by, created_by)
    values (p_product_id, p_site_id, v_over, p_quantity, v_normal, v_return_id, p_returned_by, public.current_actor_id())
    returning id into v_over_id;
    perform public.log_operation('over_return.created', 'over_return', v_over_id, p_site_id, p_product_id, v_over, v_detail);
  end if;
  return coalesce(v_return_id, v_over_id);
end;
$$;

create or replace function public.correct_stock_return(
  p_return_id uuid,
  p_input_quantity numeric,
  p_memo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_return public.stock_returns%rowtype;
  v_over public.over_returns%rowtype;
  v_site_location text;
  v_center_location text;
  v_site_quantity numeric(12,2);
  v_center_quantity numeric(12,2);
  v_old_normal numeric(12,2);
  v_old_over numeric(12,2);
  v_new_normal numeric(12,2);
  v_new_over numeric(12,2);
  v_delta numeric(12,2);
  v_site_ledger_id uuid;
  v_center_ledger_id uuid;
begin
  if not public.is_admin() then raise exception 'permission_denied: admin role required' using errcode='42501'; end if;
  if p_input_quantity is null or p_input_quantity <= 0 then raise exception 'quantity_must_be_positive'; end if;

  select * into v_return from public.stock_returns where id = p_return_id for update;
  if not found then raise exception 'stock_return_not_found'; end if;
  select * into v_over from public.over_returns where stock_return_id = p_return_id order by created_at desc limit 1 for update;

  v_old_normal := v_return.quantity;
  v_old_over := coalesce(v_over.quantity, 0);
  v_site_location := public.site_stock_location(v_return.site_id);
  select location into v_center_location from public.stock_ledger
   where id = v_return.center_ledger_id and product_id = v_return.product_id and movement_type = 'in'
   for update;
  if v_center_location is null then raise exception 'return_ledger_not_linked'; end if;

  select quantity into v_site_quantity from public.stock_items
   where product_id = v_return.product_id and location = v_site_location for update;
  select quantity into v_center_quantity from public.stock_items
   where product_id = v_return.product_id and location = v_center_location for update;
  if v_site_quantity is null or v_center_quantity is null then raise exception 'stock_item_not_found'; end if;

  select id into v_site_ledger_id from public.stock_ledger
   where id = v_return.site_ledger_id and product_id = v_return.product_id
     and site_id = v_return.site_id and location = v_site_location and movement_type = 'out' for update;
  select id into v_center_ledger_id from public.stock_ledger
   where id = v_return.center_ledger_id and product_id = v_return.product_id
     and location = v_center_location and movement_type = 'in' for update;
  if v_site_ledger_id is null or v_center_ledger_id is null then raise exception 'return_ledger_not_linked'; end if;

  v_new_normal := least(p_input_quantity, v_site_quantity + v_old_normal);
  v_new_over := p_input_quantity - v_new_normal;
  v_delta := v_new_normal - v_old_normal;
  if v_site_quantity - v_delta < 0 then raise exception 'insufficient_site_stock'; end if;
  if v_center_quantity + v_delta < 0 then raise exception 'insufficient_center_stock'; end if;

  update public.stock_items set quantity = quantity - v_delta where product_id = v_return.product_id and location = v_site_location;
  update public.stock_items set quantity = quantity + v_delta where product_id = v_return.product_id and location = v_center_location;
  update public.stock_ledger set quantity = v_new_normal where id in (v_site_ledger_id, v_center_ledger_id);
  update public.stock_returns set quantity = v_new_normal, memo = nullif(btrim(p_memo), ''), corrected_at = now(), corrected_by = public.current_actor_id() where id = p_return_id;

  if v_new_over > 0 then
    if v_over.id is null then
      insert into public.over_returns(product_id, site_id, quantity, input_quantity, normal_quantity, stock_return_id, reported_by, created_by)
      values (v_return.product_id, v_return.site_id, v_new_over, p_input_quantity, v_new_normal, p_return_id, v_return.returned_by, public.current_actor_id());
    else
      update public.over_returns set quantity = v_new_over, input_quantity = p_input_quantity, normal_quantity = v_new_normal,
        status = 'unconfirmed', memo = null, confirmed_by = null, confirmed_at = null where id = v_over.id;
    end if;
  elsif v_over.id is not null then
    delete from public.over_returns where id = v_over.id;
  end if;

  insert into public.stock_return_corrections(stock_return_id, old_input_quantity, new_input_quantity, old_normal_quantity, new_normal_quantity, old_over_quantity, new_over_quantity, old_memo, new_memo, corrected_by)
  values (p_return_id, v_old_normal + v_old_over, p_input_quantity, v_old_normal, v_new_normal, v_old_over, v_new_over, v_return.memo, nullif(btrim(p_memo), ''), public.current_actor_id());
  return jsonb_build_object('ok', true, 'normal_quantity', v_new_normal, 'over_quantity', v_new_over);
end;
$$;

create or replace function public.return_lease_stock_from_site(
  p_item_id uuid, p_site_id uuid, p_quantity numeric, p_operation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_actor_id uuid; v_reserved uuid; v_existing record; v_batch_id uuid; v_batch_status text;
begin
  if not public.is_center() then raise exception 'permission_denied: center role required' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'operation_id_required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity_must_be_positive'; end if;
  if p_site_id is null then raise exception 'site_required'; end if;
  if (select center_id from public.sites where id = p_site_id) is distinct from public.current_center_id() then raise exception 'site_not_in_current_center'; end if;
  v_actor_id := public.current_actor_id();
  insert into public.lease_operations(operation_id, operation_type, actor_id, target_id)
  values (p_operation_id, 'return_lease_stock_from_site', v_actor_id, p_item_id)
  on conflict (operation_id) do nothing returning operation_id into v_reserved;
  if v_reserved is null then
    select operation_type, actor_id, target_id into v_existing from public.lease_operations where operation_id = p_operation_id;
    if v_existing.operation_type is distinct from 'return_lease_stock_from_site' or v_existing.actor_id is distinct from v_actor_id or v_existing.target_id is distinct from p_item_id then raise exception 'operation_id_conflict'; end if;
    return;
  end if;
  select lease_batch_id into v_batch_id from public.lease_batch_items where id = p_item_id;
  if not found then raise exception 'lease_batch_item_not_found'; end if;
  select status into v_batch_status from public.lease_batches where id = v_batch_id for update;
  if v_batch_status not in ('receiving', 'received') then raise exception 'invalid_status_transition'; end if;
  perform 1 from public.lease_batch_items where id = p_item_id for update;
  perform public.apply_lease_stock_movement(p_item_id, 'site', p_site_id, -p_quantity, 'return_from_site');
  perform public.apply_lease_stock_movement(p_item_id, 'center', p_site_id, p_quantity, 'return_from_site');
end;
$$;

create or replace function public.return_materials_from_site(
  p_site_id uuid, p_items jsonb, p_memo text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_item record; v_batch_status text; v_actor_id uuid; v_count integer := 0;
begin
  if not public.is_admin() then raise exception 'permission_denied: admin role required' using errcode = '42501'; end if;
  if p_site_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'invalid_return_items'; end if;
  if not exists (select 1 from public.sites where id = p_site_id) then raise exception 'site_not_found'; end if;
  v_actor_id := public.current_actor_id();
  for v_item in select ownership, product_id, lease_batch_item_id, quantity from jsonb_to_recordset(p_items) as x(ownership text, product_id uuid, lease_batch_item_id uuid, quantity numeric) loop
    if v_item.quantity is null or v_item.quantity <= 0 then raise exception 'quantity_must_be_positive'; end if;
    if v_item.ownership = 'owned' then
      if v_item.product_id is null then raise exception 'invalid_return_items'; end if;
      perform public.return_from_site(v_item.product_id, p_site_id, v_item.quantity, p_memo, auth.uid()::text);
    elsif v_item.ownership = 'leased' then
      if v_item.lease_batch_item_id is null then raise exception 'invalid_return_items'; end if;
      select lb.status into v_batch_status from public.lease_batch_items lbi join public.lease_batches lb on lb.id = lbi.lease_batch_id where lbi.id = v_item.lease_batch_item_id for update;
      if not found then raise exception 'lease_batch_item_not_found'; end if;
      if v_batch_status not in ('receiving', 'received') then raise exception 'invalid_status_transition'; end if;
      insert into public.lease_operations(operation_id, operation_type, actor_id, target_id) values (gen_random_uuid(), 'return_lease_stock_from_site', v_actor_id, v_item.lease_batch_item_id);
      perform public.apply_lease_stock_movement(v_item.lease_batch_item_id, 'site', p_site_id, -v_item.quantity, 'return_from_site');
      perform public.apply_lease_stock_movement(v_item.lease_batch_item_id, 'center', p_site_id, v_item.quantity, 'return_from_site');
    else raise exception 'invalid_return_items'; end if;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'invalid_return_items'; end if;
end;
$$;

revoke execute on function public.apply_lease_stock_movement(uuid, text, uuid, numeric, text) from public, anon, authenticated;
revoke execute on function public.return_from_site(uuid, uuid, numeric, text, text) from public, anon;
revoke execute on function public.correct_stock_return(uuid, numeric, text) from public, anon;
revoke execute on function public.return_lease_stock_from_site(uuid, uuid, numeric, uuid) from public, anon;
revoke execute on function public.return_materials_from_site(uuid, jsonb, text) from public, anon;
grant execute on function public.return_from_site(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.correct_stock_return(uuid, numeric, text) to authenticated;
grant execute on function public.return_lease_stock_from_site(uuid, uuid, numeric, uuid) to authenticated;
grant execute on function public.return_materials_from_site(uuid, jsonb, text) to authenticated;

commit;
notify pgrst, 'reload schema';
