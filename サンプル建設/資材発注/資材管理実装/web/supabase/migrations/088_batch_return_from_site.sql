begin;

create or replace function public.return_materials_from_site(
  p_site_id uuid,
  p_items jsonb,
  p_memo text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item record;
  v_batch_status text;
  v_actor_id uuid;
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required' using errcode = '42501';
  end if;
  if p_site_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_return_items';
  end if;
  v_actor_id := public.current_actor_id();

  for v_item in
    select ownership, product_id, lease_batch_item_id, quantity
      from jsonb_to_recordset(p_items) as x(
        ownership text, product_id uuid, lease_batch_item_id uuid, quantity numeric
      )
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'quantity_must_be_positive';
    end if;
    if v_item.ownership = 'owned' then
      if v_item.product_id is null then raise exception 'invalid_return_items'; end if;
      perform public.return_from_site(v_item.product_id, p_site_id, v_item.quantity, p_memo, auth.uid()::text);
    elsif v_item.ownership = 'leased' then
      if v_item.lease_batch_item_id is null then raise exception 'invalid_return_items'; end if;
      select lb.status into v_batch_status
        from public.lease_batch_items lbi
        join public.lease_batches lb on lb.id = lbi.lease_batch_id
       where lbi.id = v_item.lease_batch_item_id
       for update;
      if not found then raise exception 'lease_batch_item_not_found'; end if;
      if v_batch_status not in ('receiving', 'received') then raise exception 'invalid_status_transition'; end if;
      insert into public.lease_operations(operation_id, operation_type, actor_id, target_id)
      values (gen_random_uuid(), 'return_lease_stock_from_site', v_actor_id, v_item.lease_batch_item_id);
      perform public.apply_lease_stock_movement(v_item.lease_batch_item_id, 'site', p_site_id, -v_item.quantity, 'return_from_site');
      perform public.apply_lease_stock_movement(v_item.lease_batch_item_id, 'center', null, v_item.quantity, 'return_from_site');
    else
      raise exception 'invalid_return_items';
    end if;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'invalid_return_items'; end if;
end;
$$;

revoke execute on function public.return_materials_from_site(uuid, jsonb, text) from public, anon;
grant execute on function public.return_materials_from_site(uuid, jsonb, text) to authenticated;
commit;
notify pgrst, 'reload schema';
