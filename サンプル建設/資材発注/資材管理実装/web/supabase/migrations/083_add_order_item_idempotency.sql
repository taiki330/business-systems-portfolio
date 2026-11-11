-- 083_add_order_item_idempotency.sql
-- オーダー明細追加をoperation_idで冪等化し、二重クリック・通信再送による重複行を防ぐ。

begin;

alter table public.stock_requests
  add column if not exists add_item_operation_id uuid;

create unique index if not exists stock_requests_add_item_operation_id_uidx
  on public.stock_requests (add_item_operation_id)
  where add_item_operation_id is not null;

comment on column public.stock_requests.add_item_operation_id is
  '事務による既存オーダー明細追加の冪等キー。同じUUIDの再送は同じ明細として扱う。';

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

  if not found then
    raise exception 'order_not_found';
  end if;

  select p.code, p.name, p.unit, p.weight_kg, pc.name
    into v_product_code, v_product_name, v_product_unit,
         v_product_weight_kg, v_product_category_name
    from public.products p
    left join public.product_categories pc on pc.id = p.category_id
   where p.id = p_product_id;

  if not found then
    raise exception 'invalid_product_id';
  end if;

  select pok.ownership_kind into v_ownership_auto
    from public.product_ownership_kind pok
   where pok.product_id = p_product_id;
  v_ownership_auto := coalesce(v_ownership_auto, 'owned');

  insert into public.stock_requests (
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

  if v_request_id is not null then
    return v_request_id;
  end if;

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

-- 旧3引数版は二重送信を防げないため実行不可にする。
revoke execute on function public.add_order_item(uuid, uuid, numeric) from public, anon, authenticated;
revoke execute on function public.add_order_item(uuid, uuid, numeric, uuid) from public, anon;
grant execute on function public.add_order_item(uuid, uuid, numeric, uuid) to authenticated;

commit;
notify pgrst, 'reload schema';

-- ROLLBACK:
-- revoke execute on function public.add_order_item(uuid, uuid, numeric, uuid) from authenticated;
-- drop function if exists public.add_order_item(uuid, uuid, numeric, uuid);
-- grant execute on function public.add_order_item(uuid, uuid, numeric) to authenticated;
-- drop index if exists public.stock_requests_add_item_operation_id_uidx;
-- alter table public.stock_requests drop column if exists add_item_operation_id;
