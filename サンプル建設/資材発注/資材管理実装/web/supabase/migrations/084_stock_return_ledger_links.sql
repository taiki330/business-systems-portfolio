-- 084_stock_return_ledger_links.sql
-- 返却記録と在庫台帳をIDで直接結び、訂正時の日時推測を廃止する。
-- 現行権限方針に合わせ、通常返却の登録も事務(admin)専用へ揃える。

begin;

alter table public.stock_returns
  add column if not exists site_ledger_id uuid references public.stock_ledger(id) on delete set null,
  add column if not exists center_ledger_id uuid references public.stock_ledger(id) on delete set null;

create unique index if not exists stock_returns_site_ledger_id_uidx
  on public.stock_returns(site_ledger_id) where site_ledger_id is not null;
create unique index if not exists stock_returns_center_ledger_id_uidx
  on public.stock_returns(center_ledger_id) where center_ledger_id is not null;

comment on column public.stock_returns.site_ledger_id is
  'この返却で作成した現場側out台帳行。訂正時は日時検索せずこのIDを使う。';
comment on column public.stock_returns.center_ledger_id is
  'この返却で作成したセンター側in台帳行。訂正時は日時検索せずこのIDを使う。';

-- 既存分は、両側とも候補がちょうど1件のときだけ安全に紐付ける。
-- 同時刻に複数候補があるデータは推測せずNULLのまま残し、訂正時に拒否する。
with candidates as (
  select
    sr.id,
    array(
      select sl.id
        from public.stock_ledger sl
       where sl.product_id = sr.product_id
         and sl.site_id = sr.site_id
         and sl.location = public.site_stock_location(sr.site_id)
         and sl.movement_type = 'out'
         and sl.created_at = sr.created_at
       order by sl.id
    ) as site_ids,
    array(
      select sl.id
        from public.stock_ledger sl
       where sl.product_id = sr.product_id
         and sl.location = 'center'
         and sl.movement_type = 'in'
         and sl.created_at = sr.created_at
       order by sl.id
    ) as center_ids
  from public.stock_returns sr
  where sr.site_ledger_id is null or sr.center_ledger_id is null
)
update public.stock_returns sr
   set site_ledger_id = c.site_ids[1],
       center_ledger_id = c.center_ids[1]
  from candidates c
 where sr.id = c.id
   and cardinality(c.site_ids) = 1
   and cardinality(c.center_ids) = 1;

create or replace function public.return_from_site(
  p_product_id  uuid,
  p_site_id     uuid,
  p_quantity    numeric,
  p_memo        text default null,
  p_returned_by text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site_location   text;
  v_site_quantity   numeric(12, 2);
  v_normal          numeric(12, 2);
  v_over            numeric(12, 2);
  v_return_id       uuid;
  v_over_id         uuid;
  v_site_ledger_id  uuid;
  v_center_ledger_id uuid;
  v_detail          jsonb;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  v_site_location := public.site_stock_location(p_site_id);

  select si.quantity
    into v_site_quantity
    from public.stock_items si
   where si.product_id = p_product_id
     and si.location = v_site_location
     and si.storage_kind = 'site'
   for update;

  v_site_quantity := coalesce(v_site_quantity, 0);
  v_normal := least(p_quantity, v_site_quantity);
  v_over := p_quantity - v_normal;

  v_detail := jsonb_build_object(
    'input_quantity', p_quantity,
    'normal_quantity', v_normal,
    'over_quantity', v_over
  );

  if v_normal > 0 then
    update public.stock_items
       set quantity = quantity - v_normal
     where product_id = p_product_id
       and location = v_site_location;

    -- apply_stock_movementは現行ではcenter専用のため、admin専用返却RPC内で
    -- 同じ原子的なセンター加算と台帳追記を行う。
    insert into public.stock_items(product_id, location, quantity)
    values (p_product_id, 'center', 0)
    on conflict (product_id, location) do nothing;

    perform 1
      from public.stock_items
     where product_id = p_product_id and location = 'center'
     for update;

    update public.stock_items
       set quantity = quantity + v_normal
     where product_id = p_product_id and location = 'center';

    insert into public.stock_ledger(
      product_id, location, movement_type, quantity, site_id, created_by
    ) values (
      p_product_id, 'center', 'in', v_normal, null, public.current_actor_id()
    ) returning id into v_center_ledger_id;

    insert into public.stock_ledger(
      product_id, location, movement_type, quantity, site_id, created_by
    ) values (
      p_product_id, v_site_location, 'out', v_normal,
      p_site_id, public.current_actor_id()
    ) returning id into v_site_ledger_id;

    insert into public.stock_returns(
      product_id, site_id, quantity, memo, returned_by,
      site_ledger_id, center_ledger_id
    ) values (
      p_product_id, p_site_id, v_normal, p_memo, p_returned_by,
      v_site_ledger_id, v_center_ledger_id
    ) returning id into v_return_id;

    perform public.log_operation(
      'stock_return.created', 'stock_return', v_return_id,
      p_site_id, p_product_id, v_normal, v_detail
    );
  end if;

  if v_over > 0 then
    insert into public.over_returns(
      product_id, site_id, quantity, input_quantity, normal_quantity,
      stock_return_id, reported_by, created_by
    ) values (
      p_product_id, p_site_id, v_over, p_quantity, v_normal,
      v_return_id, p_returned_by, public.current_actor_id()
    ) returning id into v_over_id;

    perform public.log_operation(
      'over_return.created', 'over_return', v_over_id,
      p_site_id, p_product_id, v_over, v_detail
    );
  end if;

  return coalesce(v_return_id, v_over_id);
end;
$$;

comment on function public.return_from_site(uuid, uuid, numeric, text, text) is
  'admin限定。現場返却を通常返却と過入庫に分割し、通常返却は対応する台帳IDを保存する。';

revoke execute on function public.return_from_site(uuid, uuid, numeric, text, text)
  from public, anon;
grant execute on function public.return_from_site(uuid, uuid, numeric, text, text)
  to authenticated;

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
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required' using errcode='42501';
  end if;
  if p_input_quantity is null or p_input_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  select * into v_return
    from public.stock_returns
   where id = p_return_id
   for update;
  if not found then raise exception 'stock_return_not_found'; end if;

  select * into v_over
    from public.over_returns
   where stock_return_id = p_return_id
   order by created_at desc
   limit 1
   for update;

  v_old_normal := v_return.quantity;
  v_old_over := coalesce(v_over.quantity, 0);
  v_site_location := public.site_stock_location(v_return.site_id);

  select quantity into v_site_quantity
    from public.stock_items
   where product_id = v_return.product_id and location = v_site_location
   for update;
  select quantity into v_center_quantity
    from public.stock_items
   where product_id = v_return.product_id and location = 'center'
   for update;

  if v_site_quantity is null or v_center_quantity is null then
    raise exception 'stock_item_not_found';
  end if;

  -- IDだけで対象台帳をロックし、さらに内容も返却記録と一致することを検証する。
  select id into v_site_ledger_id
    from public.stock_ledger
   where id = v_return.site_ledger_id
     and product_id = v_return.product_id
     and site_id = v_return.site_id
     and location = v_site_location
     and movement_type = 'out'
   for update;

  select id into v_center_ledger_id
    from public.stock_ledger
   where id = v_return.center_ledger_id
     and product_id = v_return.product_id
     and location = 'center'
     and movement_type = 'in'
   for update;

  if v_site_ledger_id is null or v_center_ledger_id is null then
    raise exception 'return_ledger_not_linked';
  end if;

  v_new_normal := least(p_input_quantity, v_site_quantity + v_old_normal);
  v_new_over := p_input_quantity - v_new_normal;
  v_delta := v_new_normal - v_old_normal;

  if v_site_quantity - v_delta < 0 then raise exception 'insufficient_site_stock'; end if;
  if v_center_quantity + v_delta < 0 then raise exception 'insufficient_center_stock'; end if;

  update public.stock_items set quantity = quantity - v_delta
   where product_id = v_return.product_id and location = v_site_location;
  update public.stock_items set quantity = quantity + v_delta
   where product_id = v_return.product_id and location = 'center';

  update public.stock_ledger
     set quantity = v_new_normal
   where id in (v_site_ledger_id, v_center_ledger_id);

  update public.stock_returns
     set quantity = v_new_normal,
         memo = nullif(btrim(p_memo), ''),
         corrected_at = now(),
         corrected_by = public.current_actor_id()
   where id = p_return_id;

  if v_new_over > 0 then
    if v_over.id is null then
      insert into public.over_returns(
        product_id, site_id, quantity, input_quantity, normal_quantity,
        stock_return_id, reported_by, created_by
      ) values (
        v_return.product_id, v_return.site_id, v_new_over,
        p_input_quantity, v_new_normal, p_return_id,
        v_return.returned_by, public.current_actor_id()
      );
    else
      update public.over_returns
         set quantity = v_new_over,
             input_quantity = p_input_quantity,
             normal_quantity = v_new_normal,
             status = 'unconfirmed', memo = null,
             confirmed_by = null, confirmed_at = null
       where id = v_over.id;
    end if;
  elsif v_over.id is not null then
    delete from public.over_returns where id = v_over.id;
  end if;

  insert into public.stock_return_corrections(
    stock_return_id, old_input_quantity, new_input_quantity,
    old_normal_quantity, new_normal_quantity, old_over_quantity, new_over_quantity,
    old_memo, new_memo, corrected_by
  ) values (
    p_return_id, v_old_normal + v_old_over, p_input_quantity,
    v_old_normal, v_new_normal, v_old_over, v_new_over,
    v_return.memo, nullif(btrim(p_memo), ''), public.current_actor_id()
  );

  return jsonb_build_object(
    'ok', true, 'normal_quantity', v_new_normal, 'over_quantity', v_new_over
  );
end;
$$;

comment on function public.correct_stock_return(uuid, numeric, text) is
  'admin限定。返却記録に保存した台帳IDだけを訂正し、日時による曖昧な照合は行わない。';

revoke execute on function public.correct_stock_return(uuid, numeric, text)
  from public, anon;
grant execute on function public.correct_stock_return(uuid, numeric, text)
  to authenticated;

commit;
notify pgrst, 'reload schema';

-- 適用後確認（NULLは候補が一意でなかった既存データ。新規分は必ず両方入る）:
-- select id, site_ledger_id, center_ledger_id from public.stock_returns order by created_at desc;
