-- 069_center_read_only.sql
-- 068 適用後に Supabase SQL Editor で実行
-- ヒアリング（2026-08-06「レコーディング (7)」）に基づき、center を参照専用にする。
-- center が利用するのは、オーダー確認・印刷、センター在庫、現場在庫のみ。

begin;

-- 既存の参照 policy / 集計 RPC はこのヘルパーを広く利用している。
-- 名前は互換性のため維持し、今回から admin/internal のみに絞る。
-- center に必要な参照先は、この下の個別 policy で明示的に開ける。
create or replace function public.is_admin_or_center()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_app_role() in ('admin', 'internal');
$$;

comment on function public.is_admin_or_center() is
  '互換名。D-20260806-03 以降は admin/internal のみ true。center の参照は用途別 policy で許可する。';

-- center の業務画面で必要な読み取りだけを許可する。
drop policy if exists "products_center_read" on public.products;
create policy "products_center_read" on public.products for select to authenticated
  using (public.current_app_role() = 'center');

drop policy if exists "sites_center_read" on public.sites;
create policy "sites_center_read" on public.sites for select to authenticated
  using (public.current_app_role() = 'center');

drop policy if exists "site_products_center_read" on public.site_products;
create policy "site_products_center_read" on public.site_products for select to authenticated
  using (public.current_app_role() = 'center');

drop policy if exists "stock_items_center_read" on public.stock_items;
create policy "stock_items_center_read" on public.stock_items for select to authenticated
  using (public.current_app_role() = 'center');

drop policy if exists "orders_center_read" on public.orders;
create policy "orders_center_read" on public.orders for select to authenticated
  using (public.current_app_role() = 'center');

drop policy if exists "stock_requests_center_read" on public.stock_requests;
create policy "stock_requests_center_read" on public.stock_requests for select to authenticated
  using (public.current_app_role() = 'center');

-- 過去オーダーの自社/リース表示を product_ownership_kind で解決するための補助参照。
-- 借用伝票・会社・履歴は開けず、現在庫行だけに限定する。
drop policy if exists "lease_stock_items_center_order_read" on public.lease_stock_items;
create policy "lease_stock_items_center_order_read" on public.lease_stock_items for select to authenticated
  using (public.current_app_role() = 'center');

-- 過去オーダー（表示名スナップショットなし）の印刷だけは center でも解決可能にする。
create or replace function public.get_order_requester_label(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(trim(au.display_name), '')
    from public.orders o
    left join public.app_users au on au.id::text = o.requested_by
   where o.id = p_order_id
     and public.current_app_role() in ('admin', 'center', 'internal');
$$;

comment on function public.get_order_requester_label(uuid) is
  'admin/center が資材発注書に表示する、オーダー作成アカウントの表示名。D-20260806-03。';

-- RLS や SECURITY DEFINER RPC の旧定義が center の更新を許可していても、
-- 業務データを書き換える直前に必ず拒否する最終防衛。
create or replace function public.prevent_center_data_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_app_role() = 'center' then
    raise exception 'permission_denied: center role is read only'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.prevent_center_data_changes() is
  'center を参照専用にする最終防衛。オーダー・在庫・リース等の業務テーブルへの変更を拒否する。';

revoke execute on function public.prevent_center_data_changes() from public;
revoke execute on function public.prevent_center_data_changes() from anon;
revoke execute on function public.prevent_center_data_changes() from authenticated;

drop trigger if exists prevent_center_changes on public.orders;
create trigger prevent_center_changes before insert or update or delete on public.orders
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.slips;
create trigger prevent_center_changes before insert or update or delete on public.slips
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.stock_requests;
create trigger prevent_center_changes before insert or update or delete on public.stock_requests
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.stock_items;
create trigger prevent_center_changes before insert or update or delete on public.stock_items
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.stock_ledger;
create trigger prevent_center_changes before insert or update or delete on public.stock_ledger
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.stock_returns;
create trigger prevent_center_changes before insert or update or delete on public.stock_returns
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.over_returns;
create trigger prevent_center_changes before insert or update or delete on public.over_returns
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.stock_adjustment_requests;
create trigger prevent_center_changes before insert or update or delete on public.stock_adjustment_requests
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.lease_batches;
create trigger prevent_center_changes before insert or update or delete on public.lease_batches
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.lease_batch_items;
create trigger prevent_center_changes before insert or update or delete on public.lease_batch_items
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.lease_stock_items;
create trigger prevent_center_changes before insert or update or delete on public.lease_stock_items
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.lease_stock_ledger;
create trigger prevent_center_changes before insert or update or delete on public.lease_stock_ledger
  for each row execute function public.prevent_center_data_changes();

drop trigger if exists prevent_center_changes on public.lease_operations;
create trigger prevent_center_changes before insert or update or delete on public.lease_operations
  for each row execute function public.prevent_center_data_changes();

commit;

notify pgrst, 'reload schema';

-- ROLLBACK:
-- begin;
-- drop trigger if exists prevent_center_changes on public.orders;
-- drop trigger if exists prevent_center_changes on public.slips;
-- drop trigger if exists prevent_center_changes on public.stock_requests;
-- drop trigger if exists prevent_center_changes on public.stock_items;
-- drop trigger if exists prevent_center_changes on public.stock_ledger;
-- drop trigger if exists prevent_center_changes on public.stock_returns;
-- drop trigger if exists prevent_center_changes on public.over_returns;
-- drop trigger if exists prevent_center_changes on public.stock_adjustment_requests;
-- drop trigger if exists prevent_center_changes on public.lease_batches;
-- drop trigger if exists prevent_center_changes on public.lease_batch_items;
-- drop trigger if exists prevent_center_changes on public.lease_stock_items;
-- drop trigger if exists prevent_center_changes on public.lease_stock_ledger;
-- drop trigger if exists prevent_center_changes on public.lease_operations;
-- drop function if exists public.prevent_center_data_changes();
-- drop policy if exists "products_center_read" on public.products;
-- drop policy if exists "sites_center_read" on public.sites;
-- drop policy if exists "site_products_center_read" on public.site_products;
-- drop policy if exists "stock_items_center_read" on public.stock_items;
-- drop policy if exists "orders_center_read" on public.orders;
-- drop policy if exists "stock_requests_center_read" on public.stock_requests;
-- drop policy if exists "lease_stock_items_center_order_read" on public.lease_stock_items;
-- -- is_admin_or_center / get_order_requester_label は 026 / 058 の定義へ戻すこと。
-- commit;
