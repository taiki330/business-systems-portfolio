-- 075_inventory_count.sql
-- センター在庫の棚卸（実数入力・差異反映・履歴保存）。

begin;

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft', 'completed')),
  started_at timestamptz not null default now(),
  started_by text,
  completed_at timestamptz,
  completed_by text,
  note text
);

create table if not exists public.inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  inventory_count_id uuid not null references public.inventory_counts(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id),
  product_id uuid not null references public.products(id),
  system_quantity numeric(12,2) not null,
  counted_quantity numeric(12,2),
  difference_quantity numeric(12,2),
  unique (inventory_count_id, stock_item_id)
);

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_items enable row level security;
grant select on public.inventory_counts, public.inventory_count_items to authenticated;

create policy "inventory_counts_admin_center_read" on public.inventory_counts for select to authenticated
  using (public.current_app_role() in ('admin', 'center', 'internal'));
create policy "inventory_count_items_admin_center_read" on public.inventory_count_items for select to authenticated
  using (public.current_app_role() in ('admin', 'center', 'internal'));

create or replace function public.start_inventory_count(p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if coalesce(public.current_app_role(), '__unregistered__') not in ('admin','center','internal') then
    raise exception 'permission_denied: admin or center role required' using errcode='42501';
  end if;
  insert into public.inventory_counts(started_by,note) values (public.current_actor_id(), nullif(trim(p_note), '')) returning id into v_id;
  insert into public.inventory_count_items(inventory_count_id,stock_item_id,product_id,system_quantity)
  select v_id,id,product_id,quantity from public.stock_items where location='center';
  return v_id;
end; $$;

create or replace function public.complete_inventory_count(p_inventory_count_id uuid, p_counts jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_counted numeric(12,2); v_delta numeric(12,2);
begin
  if coalesce(public.current_app_role(), '__unregistered__') not in ('admin','center','internal') then
    raise exception 'permission_denied: admin or center role required' using errcode='42501';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then raise exception 'invalid_inventory_counts'; end if;
  perform set_config('app.center_inventory_count', 'on', true);
  perform 1 from public.inventory_counts where id=p_inventory_count_id and status='draft' for update;
  if not found then raise exception 'inventory_count_not_open'; end if;
  for r in select * from public.inventory_count_items where inventory_count_id=p_inventory_count_id order by id for update loop
    v_counted := (p_counts ->> r.id::text)::numeric;
    if v_counted is null or v_counted < 0 then raise exception 'invalid_inventory_counts'; end if;
    v_delta := v_counted-r.system_quantity;
    update public.inventory_count_items set counted_quantity=v_counted,difference_quantity=v_delta where id=r.id;
    if v_delta <> 0 then
      update public.stock_items set quantity=v_counted where id=r.stock_item_id;
      insert into public.stock_ledger(product_id,location,movement_type,quantity,created_by,reason)
      values(r.product_id,'center',case when v_delta > 0 then 'in' else 'out' end,abs(v_delta),public.current_actor_id(),'inventory_count');
    end if;
  end loop;
  update public.inventory_counts set status='completed',completed_at=now(),completed_by=public.current_actor_id() where id=p_inventory_count_id;
end; $$;

-- 069 のセンター書込防止を、棚卸確定RPC内の在庫反映だけ許可するよう拡張する。
create or replace function public.prevent_center_data_changes() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.current_app_role()='center' then
    if (current_setting('app.center_order_shipping',true)='on' or current_setting('app.center_inventory_count',true)='on')
       and tg_table_name in ('stock_requests','stock_items','stock_ledger') then
      if tg_op='DELETE' then return old; end if; return new;
    end if;
    if tg_table_name='orders' and tg_op='UPDATE' and (to_jsonb(new)-'yard_loading_date') is not distinct from (to_jsonb(old)-'yard_loading_date') then return new; end if;
    raise exception 'permission_denied: center role is read only except allowed operations' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;

revoke execute on function public.start_inventory_count(text), public.complete_inventory_count(uuid,jsonb) from public, anon;
grant execute on function public.start_inventory_count(text), public.complete_inventory_count(uuid,jsonb) to authenticated;
commit;
notify pgrst, 'reload schema';
