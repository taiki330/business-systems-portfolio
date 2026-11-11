-- 085_add_order_item_snapshot_restore.sql
-- 083適用済み環境で、明細追加時の商品スナップショット保存を復元する。
-- operation_idによる二重送信防止は維持する。

begin;

-- 083適用後から085適用前までに追加された明細があれば、現在の商品マスタから補完する。
-- add_item_operation_id付きの行だけに限定し、既に保存済みの値は上書きしない。
update public.stock_requests sr
   set product_code_snapshot = coalesce(sr.product_code_snapshot, p.code),
       product_name_snapshot = coalesce(sr.product_name_snapshot, p.name),
       product_unit_snapshot = coalesce(sr.product_unit_snapshot, p.unit),
       product_weight_kg_snapshot = coalesce(sr.product_weight_kg_snapshot, p.weight_kg),
       product_category_name_snapshot = coalesce(sr.product_category_name_snapshot, pc.name),
       ownership_auto_snapshot = coalesce(
         sr.ownership_auto_snapshot,
         (select pok.ownership_kind
            from public.product_ownership_kind pok
           where pok.product_id = sr.product_id),
         'owned'
       )
  from public.products p
  left join public.product_categories pc on pc.id = p.category_id
 where sr.product_id = p.id
   and sr.add_item_operation_id is not null
   and sr.product_name_snapshot is null;

create or replace function public.add_order_item(
  p_order_id     uuid,
  p_product_id   uuid,
  p_quantity     numeric,
  p_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site_id uuid;
  v_request_id uuid;
  v_existing record;
  v_product_code text;
  v_product_name text;
  v_product_unit text;
  v_product_weight_kg numeric(12, 3);
  v_product_category_name text;
  v_ownership_auto text;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_operation_id is null then
    raise exception 'operation_id_required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity';
  end if;

  select site_id into v_site_id
    from public.orders
   where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;

  select p.code, p.name, p.unit, p.weight_kg, pc.name
    into v_product_code, v_product_name, v_product_unit,
         v_product_weight_kg, v_product_category_name
    from public.products p
    left join public.product_categories pc on pc.id = p.category_id
   where p.id = p_product_id;
  if not found then raise exception 'invalid_product_id'; end if;

  select pok.ownership_kind into v_ownership_auto
    from public.product_ownership_kind pok
   where pok.product_id = p_product_id;
  v_ownership_auto := coalesce(v_ownership_auto, 'owned');

  insert into public.stock_requests(
    site_id, product_id, quantity, requested_by, order_id, add_item_operation_id,
    product_code_snapshot, product_name_snapshot, product_unit_snapshot,
    product_weight_kg_snapshot, product_category_name_snapshot, ownership_auto_snapshot
  ) values (
    v_site_id, p_product_id, p_quantity, auth.uid()::text, p_order_id, p_operation_id,
    v_product_code, v_product_name, v_product_unit,
    v_product_weight_kg, v_product_category_name, v_ownership_auto
  )
  on conflict (add_item_operation_id) where add_item_operation_id is not null
    do nothing
  returning id into v_request_id;

  if v_request_id is not null then return v_request_id; end if;

  select id, order_id, product_id, quantity, requested_by
    into v_existing
    from public.stock_requests
   where add_item_operation_id = p_operation_id;

  if not found
     or v_existing.order_id is distinct from p_order_id
     or v_existing.product_id is distinct from p_product_id
     or v_existing.quantity is distinct from p_quantity
     or v_existing.requested_by is distinct from auth.uid()::text then
    raise exception 'operation_id_conflict';
  end if;

  return v_existing.id;
end;
$$;

comment on function public.add_order_item(uuid, uuid, numeric, uuid) is
  'admin限定。既存オーダーへ商品スナップショット付き明細を追加する。'
  ' 同じoperation_idの同一内容再送は既存明細IDを返す。';

revoke execute on function public.add_order_item(uuid, uuid, numeric, uuid)
  from public, anon;
grant execute on function public.add_order_item(uuid, uuid, numeric, uuid)
  to authenticated;

commit;
notify pgrst, 'reload schema';
