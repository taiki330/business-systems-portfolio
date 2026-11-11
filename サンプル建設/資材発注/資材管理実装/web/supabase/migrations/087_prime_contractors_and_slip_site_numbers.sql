-- 087_prime_contractors_and_slip_site_numbers.sql
-- 元請マスタと、元請ごとの伝票用現場番号を追加する。
-- sites.code（GAS連携用 SITE-xxx）は変更しない。
begin;

create table if not exists public.prime_contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slip_number text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prime_contractors_name_key unique (name),
  constraint prime_contractors_slip_number_key unique (slip_number),
  constraint prime_contractors_name_not_blank check (btrim(name) <> ''),
  constraint prime_contractors_slip_number_not_blank check (btrim(slip_number) <> '')
);

drop trigger if exists prime_contractors_set_updated_at on public.prime_contractors;
create trigger prime_contractors_set_updated_at
  before update on public.prime_contractors
  for each row execute function public.set_updated_at();

alter table public.prime_contractors enable row level security;
revoke all on table public.prime_contractors from public, anon;
grant select, insert, update on table public.prime_contractors to authenticated;

drop policy if exists "prime_contractors_admin_select" on public.prime_contractors;
drop policy if exists "prime_contractors_admin_insert" on public.prime_contractors;
drop policy if exists "prime_contractors_admin_update" on public.prime_contractors;
create policy "prime_contractors_admin_select" on public.prime_contractors
  for select to authenticated using (public.is_admin());
create policy "prime_contractors_admin_insert" on public.prime_contractors
  for insert to authenticated with check (public.is_admin());
create policy "prime_contractors_admin_update" on public.prime_contractors
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.sites
  add column if not exists prime_contractor_id uuid
    references public.prime_contractors(id) on delete restrict,
  add column if not exists slip_site_number integer;

alter table public.sites
  drop constraint if exists sites_slip_site_number_positive;
alter table public.sites
  add constraint sites_slip_site_number_positive
  check (slip_site_number is null or slip_site_number > 0);

create unique index if not exists sites_prime_contractor_slip_site_number_uidx
  on public.sites (prime_contractor_id, slip_site_number)
  where prime_contractor_id is not null and slip_site_number is not null;

create index if not exists sites_prime_contractor_id_idx
  on public.sites (prime_contractor_id)
  where prime_contractor_id is not null;

-- 元請を設定したときだけ、その元請内で次の現場番号を採番する。
-- 同じ元請の採番は advisory lock で直列化するため重複しない。
create or replace function public.assign_slip_site_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.prime_contractor_id is null then
    new.slip_site_number := null;
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.prime_contractor_id is distinct from old.prime_contractor_id
     or new.slip_site_number is null then
    perform pg_advisory_xact_lock(hashtext(new.prime_contractor_id::text));
    select coalesce(max(s.slip_site_number), 0) + 1
      into new.slip_site_number
      from public.sites s
     where s.prime_contractor_id = new.prime_contractor_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sites_assign_slip_site_number on public.sites;
create trigger sites_assign_slip_site_number
  before insert or update of prime_contractor_id, slip_site_number on public.sites
  for each row execute function public.assign_slip_site_number();

alter table public.orders
  add column if not exists prime_contractor_name_snapshot text,
  add column if not exists prime_contractor_slip_number_snapshot text,
  add column if not exists slip_site_number_snapshot integer;

-- 現在のオーダー作成RPCを、元請・伝票用現場番号も注文時点で固定保存する形へ更新する。
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
begin
  if public.current_app_role() <> 'vendor' then
    raise exception 'permission_denied: vendor role required' using errcode = '42501';
  end if;
  if p_site_id is null or not public.user_can_access_site(p_site_id) then
    raise exception 'permission_denied: site does not match account' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_order_items';
  end if;

  select s.name, pc.name, pc.slip_number, s.slip_site_number
    into v_site_name, v_prime_contractor_name, v_prime_contractor_slip_number, v_slip_site_number
    from public.sites s
    left join public.prime_contractors pc on pc.id = s.prime_contractor_id
   where s.id = p_site_id;
  if not found then raise exception 'site_not_found'; end if;

  select nullif(trim(au.display_name), '') into v_requester_label
    from public.app_users au where au.id::text = auth.uid()::text;

  insert into public.orders (
    site_id, requested_by, delivery_deadline, yard_loading_date,
    site_name_snapshot, requester_label_snapshot,
    prime_contractor_name_snapshot, prime_contractor_slip_number_snapshot,
    slip_site_number_snapshot
  ) values (
    p_site_id, auth.uid()::text, p_delivery_deadline, p_yard_loading_date,
    v_site_name, v_requester_label,
    v_prime_contractor_name, v_prime_contractor_slip_number, v_slip_site_number
  ) returning id into v_order_id;

  for v_item in
    select item.product_id, sum(item.quantity) as requested_quantity
      from jsonb_to_recordset(p_items) as item(product_id uuid, quantity numeric)
     group by item.product_id
  loop
    if v_item.product_id is null or v_item.requested_quantity is null or v_item.requested_quantity <= 0 then
      raise exception 'invalid_quantity';
    end if;
    select p.code, p.name, p.unit, p.weight_kg, pc.name
      into v_product_code, v_product_name, v_product_unit, v_product_weight_kg, v_product_category_name
      from public.products p left join public.product_categories pc on pc.id = p.category_id
     where p.id = v_item.product_id;
    if not found then raise exception 'invalid_product_id'; end if;
    select pok.ownership_kind into v_ownership_auto
      from public.product_ownership_kind pok where pok.product_id = v_item.product_id;
    v_ownership_auto := coalesce(v_ownership_auto, 'owned');

    insert into public.stock_requests (
      site_id, product_id, quantity, requested_by, order_id,
      product_code_snapshot, product_name_snapshot, product_unit_snapshot,
      product_weight_kg_snapshot, product_category_name_snapshot, ownership_auto_snapshot
    ) values (
      p_site_id, v_item.product_id, v_item.requested_quantity, auth.uid()::text, v_order_id,
      v_product_code, v_product_name, v_product_unit,
      v_product_weight_kg, v_product_category_name, v_ownership_auto
    ) returning id into request_id;
    order_id := v_order_id;
    product_id := v_item.product_id;
    quantity := v_item.requested_quantity;
    v_item_count := v_item_count + 1;
    return next;
  end loop;
  if v_item_count = 0 then raise exception 'invalid_order_items'; end if;
end;
$$;

revoke execute on function public.create_order_with_requests(uuid, jsonb, timestamptz, date) from public, anon;
grant execute on function public.create_order_with_requests(uuid, jsonb, timestamptz, date) to authenticated;

commit;
notify pgrst, 'reload schema';
