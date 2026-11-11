-- 079_multi_site_accounts.sql
-- 現場アカウントを複数現場へ紐付け、各現場でオーダーできるようにする。
begin;

-- 1現場は1アカウントにのみ割り当てる。1アカウント側は複数現場を持てる。
create unique index if not exists app_user_sites_one_account_per_site_idx
  on public.app_user_sites (site_id);

create or replace function public.user_can_access_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_site_id is not null
     and public.current_app_role() = 'vendor'
     and (
       exists (
         select 1 from public.app_user_sites aus
          where aus.user_id = auth.uid() and aus.site_id = p_site_id
       )
       or p_site_id = public.current_site_id()
     );
$$;
revoke execute on function public.user_can_access_site(uuid) from public, anon;
grant execute on function public.user_can_access_site(uuid) to authenticated;

create or replace function public.configure_app_user_by_admin(
  p_id uuid,
  p_display_name text,
  p_role text,
  p_site_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site_ids uuid[];
  v_primary_site_id uuid;
  v_primary_site_name text;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'center', 'vendor') then raise exception 'invalid_role'; end if;

  select coalesce(array_agg(x.site_id order by x.ord), '{}'::uuid[])
    into v_site_ids
    from (
      select site_id, min(ord) ord
        from unnest(coalesce(p_site_ids, '{}'::uuid[])) with ordinality as u(site_id, ord)
       where site_id is not null
       group by site_id
    ) x;

  if p_role = 'vendor' then
    if cardinality(v_site_ids) = 0 then raise exception 'site_required'; end if;
    if (select count(*) from public.sites where id = any(v_site_ids)) <> cardinality(v_site_ids) then
      raise exception 'site_not_found';
    end if;
    if exists (
      select 1 from public.app_user_sites aus
       where aus.site_id = any(v_site_ids) and aus.user_id <> p_id
    ) then
      raise exception 'site_already_has_account';
    end if;
    v_primary_site_id := v_site_ids[1];
    select name into v_primary_site_name from public.sites where id = v_primary_site_id;
  else
    v_site_ids := '{}'::uuid[];
    v_primary_site_id := null;
  end if;

  insert into public.app_users(id, role, display_name, vendor_id, site_id)
  values (
    p_id, p_role,
    case when p_role='vendor'
      then coalesce(nullif(btrim(p_display_name), ''), v_primary_site_name)
      else nullif(btrim(p_display_name), '') end,
    null, v_primary_site_id
  )
  on conflict (id) do update set
    role=excluded.role, display_name=excluded.display_name,
    vendor_id=null, site_id=excluded.site_id;

  delete from public.app_user_sites where user_id = p_id;
  if p_role = 'vendor' then
    insert into public.app_user_sites(user_id, site_id)
    select p_id, unnest(v_site_ids);
  end if;
end;
$$;
revoke execute on function public.configure_app_user_by_admin(uuid,text,text,uuid[]) from public, anon;
grant execute on function public.configure_app_user_by_admin(uuid,text,text,uuid[]) to authenticated;

drop function if exists public.list_app_users();
create function public.list_app_users()
returns table (
  id uuid, email text, role text, display_name text, vendor_id uuid,
  site_id uuid, site_name text, site_ids uuid[], site_names text[],
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select au.id, u.email, au.role, au.display_name, au.vendor_id,
         au.site_id, s.name,
         coalesce(a.site_ids, '{}'::uuid[]),
         coalesce(a.site_names, '{}'::text[]),
         au.created_at, au.updated_at
    from public.app_users au
    join auth.users u on u.id=au.id
    left join public.sites s on s.id=au.site_id
    left join lateral (
      select array_agg(aus.site_id order by ss.name, aus.site_id) site_ids,
             array_agg(ss.name order by ss.name, aus.site_id) site_names
        from public.app_user_sites aus
        join public.sites ss on ss.id=aus.site_id
       where aus.user_id=au.id
    ) a on true
   where public.is_admin();
$$;
revoke execute on function public.list_app_users() from public, anon;
grant execute on function public.list_app_users() to authenticated;

drop policy if exists "sites_vendor_select" on public.sites;
create policy "sites_vendor_select" on public.sites for select to authenticated
  using (public.user_can_access_site(id));

drop policy if exists "site_product_plans_vendor_select" on public.site_product_plans;
create policy "site_product_plans_vendor_select" on public.site_product_plans for select to authenticated
  using (public.user_can_access_site(site_id));

drop policy if exists "stock_requests_vendor_insert" on public.stock_requests;
create policy "stock_requests_vendor_insert" on public.stock_requests for insert to authenticated
  with check (
    requested_by=auth.uid()::text and status='requested'
    and public.user_can_access_site(site_id)
  );

drop policy if exists "orders_vendor_select" on public.orders;
create policy "orders_vendor_select" on public.orders for select to authenticated
  using (public.user_can_access_site(site_id));

drop policy if exists "orders_vendor_insert" on public.orders;
create policy "orders_vendor_insert" on public.orders for insert to authenticated
  with check (requested_by=auth.uid()::text and public.user_can_access_site(site_id));

drop policy if exists "slips_vendor_select" on public.slips;
create policy "slips_vendor_select" on public.slips for select to authenticated
  using (
    exists (
      select 1 from public.orders o
       where o.id=slips.order_id and public.user_can_access_site(o.site_id)
    )
  );

create or replace function public.vendor_can_access_site(p_site_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.user_can_access_site(p_site_id)
      or exists (
        select 1 from public.vendor_sites vs
         where vs.vendor_id=public.current_vendor_id() and vs.site_id=p_site_id
      );
$$;

drop function if exists public.create_order_with_requests(uuid, jsonb, timestamptz);

create or replace function public.create_order_with_requests(
  p_site_id uuid,
  p_items jsonb,
  p_delivery_deadline timestamptz default null,
  p_yard_loading_date date default null
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
  v_site_name text;
  v_requester_label text;
  v_item record;
  v_item_count integer := 0;
  v_product_code text;
  v_product_name text;
  v_product_unit text;
  v_product_weight_kg numeric(12, 3);
  v_product_category_name text;
  v_ownership_auto text;
begin
  if public.current_app_role() <> 'vendor' then
    raise exception 'permission_denied: vendor role required'
      using errcode = '42501';
  end if;

  -- app_user_sites に紐付くいずれの現場でも登録できる。
  if p_site_id is null or not public.user_can_access_site(p_site_id) then
    raise exception 'permission_denied: site does not match account'
      using errcode = '42501';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_order_items';
  end if;

  select s.name into v_site_name
    from public.sites s
   where s.id = p_site_id;

  select nullif(trim(au.display_name), '') into v_requester_label
    from public.app_users au
   where au.id::text = auth.uid()::text;

  insert into public.orders (
    site_id, requested_by, delivery_deadline, yard_loading_date,
    site_name_snapshot, requester_label_snapshot
  )
  values (
    p_site_id, auth.uid()::text, p_delivery_deadline, p_yard_loading_date,
    v_site_name, v_requester_label
  )
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

    select p.code, p.name, p.unit, p.weight_kg, pc.name
      into v_product_code, v_product_name, v_product_unit,
           v_product_weight_kg, v_product_category_name
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
      site_id, product_id, quantity, requested_by, order_id,
      product_code_snapshot, product_name_snapshot, product_unit_snapshot,
      product_weight_kg_snapshot, product_category_name_snapshot, ownership_auto_snapshot
    ) values (
      p_site_id, v_item.product_id, v_item.requested_quantity, auth.uid()::text, v_order_id,
      v_product_code, v_product_name, v_product_unit,
      v_product_weight_kg, v_product_category_name, v_ownership_auto
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

comment on function public.create_order_with_requests(uuid, jsonb, timestamptz, date) is
  'vendor が自分に紐付く担当現場に対して、オーダーと複数の出庫依頼明細を原子的に作成する。'
  ' 納期（p_delivery_deadline）とヤード積込日（p_yard_loading_date）は職人がオーダー時に入力する'
  '（納期: D-20260805-01 #1 / ヤード積込日: D-20260806-08 が D-20260806-06 を上書き）。'
  ' 現場名・発注者名・商品情報・自社/リース自動判定はこの時点の値を固定して保存する（D-20260805-10）。P1-E';

revoke execute on function public.create_order_with_requests(uuid, jsonb, timestamptz, date) from public;
revoke execute on function public.create_order_with_requests(uuid, jsonb, timestamptz, date) from anon;
grant execute on function public.create_order_with_requests(uuid, jsonb, timestamptz, date) to authenticated;


commit;
notify pgrst, 'reload schema';
