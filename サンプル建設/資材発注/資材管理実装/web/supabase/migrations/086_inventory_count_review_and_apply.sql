-- 086_inventory_count_review_and_apply.sql
-- 棚卸を「実数保存・差異確認」と「選択明細の在庫反映」に分離する。
begin;

alter table public.inventory_counts
  drop constraint if exists inventory_counts_status_check;

alter table public.inventory_counts
  add constraint inventory_counts_status_check
  check (status in ('draft', 'counted', 'completed'));

alter table public.inventory_counts
  add column if not exists counted_at timestamptz,
  add column if not exists counted_by text;

alter table public.inventory_count_items
  add column if not exists applied boolean not null default false,
  add column if not exists applied_at timestamptz,
  add column if not exists applied_by text;

-- 旧処理で確定済みの差異は、既に在庫へ反映済みとして履歴を補完する。
update public.inventory_count_items item
set applied = true,
    applied_at = coalesce(item.applied_at, count.completed_at),
    applied_by = coalesce(item.applied_by, count.completed_by)
from public.inventory_counts count
where count.id = item.inventory_count_id
  and count.status = 'completed'
  and coalesce(item.difference_quantity, 0) <> 0
  and item.applied = false;

create or replace function public.save_inventory_count(
  p_inventory_count_id uuid,
  p_counts jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_counted numeric(12,2);
begin
  if coalesce(public.current_app_role(), '__unregistered__') not in ('admin', 'center', 'internal') then
    raise exception 'permission_denied: admin or center role required' using errcode = '42501';
  end if;

  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'invalid_inventory_counts';
  end if;

  perform 1
  from public.inventory_counts
  where id = p_inventory_count_id and status = 'draft'
  for update;
  if not found then
    raise exception 'inventory_count_not_open';
  end if;

  for r in
    select id, system_quantity
    from public.inventory_count_items
    where inventory_count_id = p_inventory_count_id
    order by id
    for update
  loop
    if not (p_counts ? r.id::text) then
      raise exception 'inventory_count_missing_item: %', r.id;
    end if;

    begin
      v_counted := (p_counts ->> r.id::text)::numeric;
    exception when others then
      raise exception 'invalid_inventory_counts';
    end;

    if v_counted is null or v_counted < 0 then
      raise exception 'invalid_inventory_counts';
    end if;

    update public.inventory_count_items
    set counted_quantity = v_counted,
        difference_quantity = v_counted - r.system_quantity,
        applied = false,
        applied_at = null,
        applied_by = null
    where id = r.id;
  end loop;

  update public.inventory_counts
  set status = 'counted',
      counted_at = now(),
      counted_by = public.current_actor_id()
  where id = p_inventory_count_id;
end;
$$;

create or replace function public.apply_inventory_count(
  p_inventory_count_id uuid,
  p_item_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_delta numeric(12,2);
begin
  if coalesce(public.current_app_role(), '__unregistered__') not in ('admin', 'center', 'internal') then
    raise exception 'permission_denied: admin or center role required' using errcode = '42501';
  end if;

  perform 1
  from public.inventory_counts
  where id = p_inventory_count_id and status = 'counted'
  for update;
  if not found then
    raise exception 'inventory_count_not_ready';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_item_ids, '{}'::uuid[])) selected_id
    where not exists (
      select 1
      from public.inventory_count_items item
      where item.id = selected_id
        and item.inventory_count_id = p_inventory_count_id
        and coalesce(item.difference_quantity, 0) <> 0
    )
  ) then
    raise exception 'invalid_inventory_count_item';
  end if;

  perform set_config('app.center_inventory_count', 'on', true);

  for r in
    select *
    from public.inventory_count_items
    where inventory_count_id = p_inventory_count_id
      and id = any(coalesce(p_item_ids, '{}'::uuid[]))
      and coalesce(difference_quantity, 0) <> 0
    order by id
    for update
  loop
    v_delta := r.difference_quantity;

    update public.stock_items
    set quantity = r.counted_quantity
    where id = r.stock_item_id;

    insert into public.stock_ledger(
      product_id,
      location,
      movement_type,
      quantity,
      created_by,
      reason
    ) values (
      r.product_id,
      'center',
      case when v_delta > 0 then 'in' else 'out' end,
      abs(v_delta),
      public.current_actor_id(),
      'inventory_count:' || p_inventory_count_id::text
    );

    update public.inventory_count_items
    set applied = true,
        applied_at = now(),
        applied_by = public.current_actor_id()
    where id = r.id;
  end loop;

  update public.inventory_counts
  set status = 'completed',
      completed_at = now(),
      completed_by = public.current_actor_id()
  where id = p_inventory_count_id;
end;
$$;

-- 旧RPCは、実数保存と在庫反映が一度に走るため利用を終了する。
revoke execute on function public.complete_inventory_count(uuid, jsonb) from public, anon, authenticated;

revoke execute on function public.save_inventory_count(uuid, jsonb) from public, anon;
revoke execute on function public.apply_inventory_count(uuid, uuid[]) from public, anon;
grant execute on function public.save_inventory_count(uuid, jsonb) to authenticated;
grant execute on function public.apply_inventory_count(uuid, uuid[]) to authenticated;

comment on function public.save_inventory_count(uuid, jsonb) is
  '事務・センター共通。棚卸実数と差異だけを保存し、在庫数は変更しない。';
comment on function public.apply_inventory_count(uuid, uuid[]) is
  '事務・センター共通。差異確認後に選択した明細だけを在庫へ反映し、棚卸を完了する。';

commit;
notify pgrst, 'reload schema';
