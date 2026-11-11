-- 102: 資材数量はすべて整数で扱う。
-- 半端材も 0.5 束のような小数ではなく、実本数（例: 10本）を入力する。
-- 既存の履歴は変更せず、この適用後の新規登録・更新のみを制限する。

begin;

create or replace function public.assert_integer_quantity(p_quantity numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_quantity is not null and p_quantity <> trunc(p_quantity) then
    raise exception 'quantity_must_be_integer' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.enforce_integer_quantity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_integer_quantity(new.quantity);

  if tg_table_name = 'stock_requests' then
    perform public.assert_integer_quantity(new.original_quantity);
  elsif tg_table_name = 'over_returns' then
    perform public.assert_integer_quantity(new.input_quantity);
    perform public.assert_integer_quantity(new.normal_quantity);
  elsif tg_table_name = 'lease_batch_items' then
    perform public.assert_integer_quantity(new.received_quantity);
    perform public.assert_integer_quantity(new.returned_quantity);
  end if;

  return new;
end;
$$;

create or replace function public.enforce_integer_inventory_count_quantity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_integer_quantity(new.counted_quantity);
  return new;
end;
$$;

create or replace function public.enforce_integer_adjustment_quantity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_integer_quantity(new.counted_quantity);
  return new;
end;
$$;

create or replace function public.enforce_integer_plan_quantity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_integer_quantity(new.planned_quantity);
  return new;
end;
$$;

drop trigger if exists stock_requests_integer_quantity on public.stock_requests;
create trigger stock_requests_integer_quantity
before insert or update of quantity, original_quantity on public.stock_requests
for each row execute function public.enforce_integer_quantity();

drop trigger if exists stock_returns_integer_quantity on public.stock_returns;
create trigger stock_returns_integer_quantity
before insert or update of quantity on public.stock_returns
for each row execute function public.enforce_integer_quantity();

drop trigger if exists over_returns_integer_quantity on public.over_returns;
create trigger over_returns_integer_quantity
before insert or update of quantity, input_quantity, normal_quantity on public.over_returns
for each row execute function public.enforce_integer_quantity();

drop trigger if exists stock_purchases_integer_quantity on public.stock_purchases;
create trigger stock_purchases_integer_quantity
before insert or update of quantity on public.stock_purchases
for each row execute function public.enforce_integer_quantity();

drop trigger if exists center_transfer_items_integer_quantity on public.center_transfer_items;
create trigger center_transfer_items_integer_quantity
before insert or update of quantity on public.center_transfer_items
for each row execute function public.enforce_integer_quantity();

drop trigger if exists lease_batch_items_integer_quantity on public.lease_batch_items;
create trigger lease_batch_items_integer_quantity
before insert or update of quantity, received_quantity, returned_quantity on public.lease_batch_items
for each row execute function public.enforce_integer_quantity();

drop trigger if exists lease_stock_items_integer_quantity on public.lease_stock_items;
create trigger lease_stock_items_integer_quantity
before insert or update of quantity on public.lease_stock_items
for each row execute function public.enforce_integer_quantity();

drop trigger if exists lease_stock_ledger_integer_quantity on public.lease_stock_ledger;
create trigger lease_stock_ledger_integer_quantity
before insert or update of quantity on public.lease_stock_ledger
for each row execute function public.enforce_integer_quantity();

drop trigger if exists stock_ledger_integer_quantity on public.stock_ledger;
create trigger stock_ledger_integer_quantity
before insert or update of quantity on public.stock_ledger
for each row execute function public.enforce_integer_quantity();

drop trigger if exists inventory_count_items_integer_quantity on public.inventory_count_items;
create trigger inventory_count_items_integer_quantity
before insert or update of counted_quantity on public.inventory_count_items
for each row execute function public.enforce_integer_inventory_count_quantity();

drop trigger if exists stock_adjustment_requests_integer_quantity on public.stock_adjustment_requests;
create trigger stock_adjustment_requests_integer_quantity
before insert or update of counted_quantity on public.stock_adjustment_requests
for each row execute function public.enforce_integer_adjustment_quantity();

drop trigger if exists site_product_plans_integer_quantity on public.site_product_plans;
create trigger site_product_plans_integer_quantity
before insert or update of planned_quantity on public.site_product_plans
for each row execute function public.enforce_integer_plan_quantity();

revoke all on function public.assert_integer_quantity(numeric) from public, anon;
revoke all on function public.enforce_integer_quantity() from public, anon;
revoke all on function public.enforce_integer_inventory_count_quantity() from public, anon;
revoke all on function public.enforce_integer_adjustment_quantity() from public, anon;
revoke all on function public.enforce_integer_plan_quantity() from public, anon;

commit;

notify pgrst, 'reload schema';
