-- 004_stock_ledger.sql
-- 001〜003 実行後に Supabase SQL Editor で実行
-- stock_ledger（履歴）と apply_stock_movement（入出庫・現在庫更新を原子的に実行）

-- 履歴テーブル
create table if not exists public.stock_ledger (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  location text not null default 'center',
  movement_type text not null check (movement_type in ('in', 'out')),
  quantity numeric(12, 2) not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create index if not exists stock_ledger_product_location_idx
  on public.stock_ledger (product_id, location);

create index if not exists stock_ledger_created_at_idx
  on public.stock_ledger (created_at desc);

comment on table public.stock_ledger is '在庫入出庫履歴（追記のみ）';
comment on column public.stock_ledger.movement_type is 'in=入庫, out=出庫';
comment on column public.stock_ledger.quantity is '正の数量。入出は movement_type で区別';

-- 入出庫を原子的に適用（stock_items 更新 + ledger 追記）
create or replace function public.apply_stock_movement(
  p_product_id uuid,
  p_location text,
  p_movement_type text,
  p_quantity numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger_id uuid;
  v_current numeric(12, 2);
  v_location text;
begin
  v_location := nullif(trim(p_location), '');
  if v_location is null then
    raise exception 'location_required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  if p_movement_type not in ('in', 'out') then
    raise exception 'invalid_movement_type';
  end if;

  insert into public.stock_items (product_id, location, quantity)
  values (p_product_id, v_location, 0)
  on conflict (product_id, location) do nothing;

  select si.quantity
  into v_current
  from public.stock_items si
  where si.product_id = p_product_id
    and si.location = v_location
  for update;

  if v_current is null then
    raise exception 'stock_item_not_found';
  end if;

  if p_movement_type = 'out' and v_current < p_quantity then
    raise exception 'insufficient_stock';
  end if;

  if p_movement_type = 'in' then
    update public.stock_items
    set quantity = quantity + p_quantity
    where product_id = p_product_id
      and location = v_location;
  else
    update public.stock_items
    set quantity = quantity - p_quantity
    where product_id = p_product_id
      and location = v_location;
  end if;

  insert into public.stock_ledger (product_id, location, movement_type, quantity)
  values (p_product_id, v_location, p_movement_type, p_quantity)
  returning id into v_ledger_id;

  return v_ledger_id;
end;
$$;

comment on function public.apply_stock_movement is
  '入出庫: stock_items を更新し stock_ledger に履歴を追記（1トランザクション）';

-- GRANT
grant select, insert on table public.stock_ledger to anon, authenticated;
grant execute on function public.apply_stock_movement(uuid, text, text, numeric)
  to anon, authenticated;

-- RLS（開発用・002 と同様）
alter table public.stock_ledger enable row level security;

drop policy if exists "stock_ledger_anon_select" on public.stock_ledger;
drop policy if exists "stock_ledger_anon_insert" on public.stock_ledger;
drop policy if exists "stock_ledger_authenticated_select" on public.stock_ledger;
drop policy if exists "stock_ledger_authenticated_insert" on public.stock_ledger;

create policy "stock_ledger_anon_select"
  on public.stock_ledger for select to anon using (true);

create policy "stock_ledger_anon_insert"
  on public.stock_ledger for insert to anon with check (true);

create policy "stock_ledger_authenticated_select"
  on public.stock_ledger for select to authenticated using (true);

create policy "stock_ledger_authenticated_insert"
  on public.stock_ledger for insert to authenticated with check (true);

-- ---------------------------------------------------------------------------
-- 実行後の確認（SQL Editor で任意実行）
-- ---------------------------------------------------------------------------
-- select to_regclass('public.stock_ledger') as stock_ledger_table;
-- select proname, pg_get_function_identity_arguments(oid) as args
-- from pg_proc where proname = 'apply_stock_movement';
-- notify pgrst, 'reload schema';
