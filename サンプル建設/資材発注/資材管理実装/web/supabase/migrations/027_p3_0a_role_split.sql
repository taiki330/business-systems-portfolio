-- 027_p3_0a_role_split.sql
-- 026 適用後に Supabase SQL Editor で実行（026 の後、必ずこの順）
-- Phase 3-0A: admin / center / vendor 3権限分離 — RLS / RPC 切替 + データ移行
--
-- 方針:
--   - マスタ系（customers/products/sites/site_products/vendors/vendor_sites）:
--       書込=admin(is_admin) / 参照=admin+center(is_admin_or_center)。vendor policy は無変更で維持
--   - 在庫系（stock_items/stock_ledger）:
--       stock_items 直接書込=admin(暫定メンテ) / 参照=admin+center。vendor center 参照は維持
--       入出庫・出庫・返却は SECURITY DEFINER RPC（RLS バイパス）で center が実行
--   - 出庫依頼（stock_requests）:
--       参照=admin+center（vendor は自分のみ・維持）/ 受付・キャンセル UPDATE=center /
--       作成 INSERT=vendor のみ（admin/center は作成不可）
--   - 返却（stock_returns）: 参照=admin+center / 登録 INSERT=center
--   - RPC ガード: apply_stock_movement / ship_stock_request / return_from_site = center /
--       list_app_users / resolve_auth_user_by_email / update_app_user_by_internal = admin
--   - 最後に既存 internal ユーザーを admin へ移行する
--   - すべて 026 のヘルパー関数（is_admin / is_center / is_admin_or_center）を参照し、
--     role 文字列を policy 内に直接書かない（ハードコーディング防止）
--   - internal は is_admin/is_center 両方を満たすため、移行前の internal ユーザーも無停止
--
-- 冪等性:
--   - 新規に作成する policy はすべて、create の直前に drop policy if exists を入れている。
--     途中で失敗した場合や、既に一度適用済みの状態で再実行しても安全に完走する。
--   - create or replace function / grant / revoke / update は元々冪等。

begin;

-- ===========================================================================
-- A) マスタ系 policy: 書込=admin / 参照=admin+center（vendor policy は残す）
-- ===========================================================================

-- ---- customers（vendor 参照なし。従来 internal 限定 → admin書込 / admin+center参照）
drop policy if exists "customers_internal_select" on public.customers;
drop policy if exists "customers_internal_insert" on public.customers;
drop policy if exists "customers_internal_update" on public.customers;
drop policy if exists "customers_internal_delete" on public.customers;
drop policy if exists "customers_read" on public.customers;
drop policy if exists "customers_admin_insert" on public.customers;
drop policy if exists "customers_admin_update" on public.customers;
drop policy if exists "customers_admin_delete" on public.customers;
create policy "customers_read" on public.customers for select to authenticated
  using (public.is_admin_or_center());
create policy "customers_admin_insert" on public.customers for insert to authenticated
  with check (public.is_admin());
create policy "customers_admin_update" on public.customers for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "customers_admin_delete" on public.customers for delete to authenticated
  using (public.is_admin());

-- ---- products（vendor_select は維持）
drop policy if exists "products_internal_select" on public.products;
drop policy if exists "products_internal_insert" on public.products;
drop policy if exists "products_internal_update" on public.products;
drop policy if exists "products_internal_delete" on public.products;
drop policy if exists "products_read" on public.products;
drop policy if exists "products_admin_insert" on public.products;
drop policy if exists "products_admin_update" on public.products;
drop policy if exists "products_admin_delete" on public.products;
create policy "products_read" on public.products for select to authenticated
  using (public.is_admin_or_center());
create policy "products_admin_insert" on public.products for insert to authenticated
  with check (public.is_admin());
create policy "products_admin_update" on public.products for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "products_admin_delete" on public.products for delete to authenticated
  using (public.is_admin());

-- ---- sites（vendor_select は維持）
drop policy if exists "sites_internal_select" on public.sites;
drop policy if exists "sites_internal_insert" on public.sites;
drop policy if exists "sites_internal_update" on public.sites;
drop policy if exists "sites_internal_delete" on public.sites;
drop policy if exists "sites_read" on public.sites;
drop policy if exists "sites_admin_insert" on public.sites;
drop policy if exists "sites_admin_update" on public.sites;
drop policy if exists "sites_admin_delete" on public.sites;
create policy "sites_read" on public.sites for select to authenticated
  using (public.is_admin_or_center());
create policy "sites_admin_insert" on public.sites for insert to authenticated
  with check (public.is_admin());
create policy "sites_admin_update" on public.sites for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "sites_admin_delete" on public.sites for delete to authenticated
  using (public.is_admin());

-- ---- site_products（vendor_select は維持）
drop policy if exists "site_products_internal_select" on public.site_products;
drop policy if exists "site_products_internal_insert" on public.site_products;
drop policy if exists "site_products_internal_update" on public.site_products;
drop policy if exists "site_products_internal_delete" on public.site_products;
drop policy if exists "site_products_read" on public.site_products;
drop policy if exists "site_products_admin_insert" on public.site_products;
drop policy if exists "site_products_admin_update" on public.site_products;
drop policy if exists "site_products_admin_delete" on public.site_products;
create policy "site_products_read" on public.site_products for select to authenticated
  using (public.is_admin_or_center());
create policy "site_products_admin_insert" on public.site_products for insert to authenticated
  with check (public.is_admin());
create policy "site_products_admin_update" on public.site_products for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "site_products_admin_delete" on public.site_products for delete to authenticated
  using (public.is_admin());

-- ---- vendors（vendor_select は維持）
drop policy if exists "vendors_internal_select" on public.vendors;
drop policy if exists "vendors_internal_insert" on public.vendors;
drop policy if exists "vendors_internal_update" on public.vendors;
drop policy if exists "vendors_internal_delete" on public.vendors;
drop policy if exists "vendors_read" on public.vendors;
drop policy if exists "vendors_admin_insert" on public.vendors;
drop policy if exists "vendors_admin_update" on public.vendors;
drop policy if exists "vendors_admin_delete" on public.vendors;
create policy "vendors_read" on public.vendors for select to authenticated
  using (public.is_admin_or_center());
create policy "vendors_admin_insert" on public.vendors for insert to authenticated
  with check (public.is_admin());
create policy "vendors_admin_update" on public.vendors for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "vendors_admin_delete" on public.vendors for delete to authenticated
  using (public.is_admin());

-- ---- vendor_sites（vendor_select は維持）
drop policy if exists "vendor_sites_internal_select" on public.vendor_sites;
drop policy if exists "vendor_sites_internal_insert" on public.vendor_sites;
drop policy if exists "vendor_sites_internal_update" on public.vendor_sites;
drop policy if exists "vendor_sites_internal_delete" on public.vendor_sites;
drop policy if exists "vendor_sites_read" on public.vendor_sites;
drop policy if exists "vendor_sites_admin_insert" on public.vendor_sites;
drop policy if exists "vendor_sites_admin_delete" on public.vendor_sites;
create policy "vendor_sites_read" on public.vendor_sites for select to authenticated
  using (public.is_admin_or_center());
create policy "vendor_sites_admin_insert" on public.vendor_sites for insert to authenticated
  with check (public.is_admin());
create policy "vendor_sites_admin_delete" on public.vendor_sites for delete to authenticated
  using (public.is_admin());

-- ===========================================================================
-- B) app_users: 書込=admin（他ユーザー更新は RPC 経由・下記 D）。自分参照は維持
-- ===========================================================================
drop policy if exists "app_users_internal_insert" on public.app_users;
drop policy if exists "app_users_internal_update" on public.app_users;
drop policy if exists "app_users_admin_insert" on public.app_users;
drop policy if exists "app_users_admin_update" on public.app_users;
create policy "app_users_admin_insert" on public.app_users for insert to authenticated
  with check (public.is_admin());
create policy "app_users_admin_update" on public.app_users for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- C) 在庫系 policy
-- ===========================================================================

-- ---- stock_items: 直接書込=admin（暫定メンテ）/ 参照=admin+center。vendor center参照は維持
drop policy if exists "stock_items_internal_select" on public.stock_items;
drop policy if exists "stock_items_internal_insert" on public.stock_items;
drop policy if exists "stock_items_internal_update" on public.stock_items;
drop policy if exists "stock_items_internal_delete" on public.stock_items;
drop policy if exists "stock_items_read" on public.stock_items;
drop policy if exists "stock_items_admin_insert" on public.stock_items;
drop policy if exists "stock_items_admin_update" on public.stock_items;
drop policy if exists "stock_items_admin_delete" on public.stock_items;
create policy "stock_items_read" on public.stock_items for select to authenticated
  using (public.is_admin_or_center());
create policy "stock_items_admin_insert" on public.stock_items for insert to authenticated
  with check (public.is_admin());
create policy "stock_items_admin_update" on public.stock_items for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "stock_items_admin_delete" on public.stock_items for delete to authenticated
  using (public.is_admin());

-- ---- stock_ledger: 参照=admin+center / INSERT=admin+center（実書込は RPC がバイパス）
drop policy if exists "stock_ledger_internal_select" on public.stock_ledger;
drop policy if exists "stock_ledger_internal_insert" on public.stock_ledger;
drop policy if exists "stock_ledger_read" on public.stock_ledger;
drop policy if exists "stock_ledger_write_insert" on public.stock_ledger;
create policy "stock_ledger_read" on public.stock_ledger for select to authenticated
  using (public.is_admin_or_center());
create policy "stock_ledger_write_insert" on public.stock_ledger for insert to authenticated
  with check (public.is_admin_or_center());

-- ===========================================================================
-- D) 出庫依頼 stock_requests
--    参照=admin+center / UPDATE(受付・キャンセル)=center / INSERT=vendor のみ
--    vendor policy（select/insert/update_cancel）は無変更で維持
-- ===========================================================================
drop policy if exists "stock_requests_internal_select" on public.stock_requests;
drop policy if exists "stock_requests_internal_insert" on public.stock_requests;
drop policy if exists "stock_requests_internal_update" on public.stock_requests;
drop policy if exists "stock_requests_read" on public.stock_requests;
drop policy if exists "stock_requests_center_update" on public.stock_requests;
create policy "stock_requests_read" on public.stock_requests for select to authenticated
  using (public.is_admin_or_center());
create policy "stock_requests_center_update" on public.stock_requests for update to authenticated
  using (public.is_center()) with check (public.is_center());

-- ===========================================================================
-- E) 返却 stock_returns: 参照=admin+center / 登録 INSERT=center
-- ===========================================================================
drop policy if exists "stock_returns_internal_select" on public.stock_returns;
drop policy if exists "stock_returns_internal_insert" on public.stock_returns;
drop policy if exists "stock_returns_read" on public.stock_returns;
drop policy if exists "stock_returns_center_insert" on public.stock_returns;
create policy "stock_returns_read" on public.stock_returns for select to authenticated
  using (public.is_admin_or_center());
create policy "stock_returns_center_insert" on public.stock_returns for insert to authenticated
  with check (public.is_center());

-- ===========================================================================
-- F) RPC ガード切替: 在庫・出庫・返却 = center / ユーザー管理 = admin
--    create or replace function は元々冪等（再実行しても安全）
-- ===========================================================================

-- ---- apply_stock_movement: center ガード（本体ロジックは 018 と同一）
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
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

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

-- ---- ship_stock_request: center ガード（本体ロジックは 020 と同一）
create or replace function public.ship_stock_request(
  p_request_id uuid,
  p_shipped_by text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status        text;
  v_product_id    uuid;
  v_quantity      numeric(12, 2);
  v_site_id       uuid;
  v_site_location text;
  v_ledger_id     uuid;
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  select status, product_id, quantity, site_id
    into v_status, v_product_id, v_quantity, v_site_id
  from public.stock_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'stock_request_not_found';
  end if;

  if v_status <> 'accepted' then
    raise exception 'invalid_status_transition';
  end if;

  v_ledger_id := public.apply_stock_movement(
    v_product_id, 'center', 'out', v_quantity
  );

  v_site_location := public.site_stock_location(v_site_id);

  insert into public.stock_items (product_id, location, storage_kind, site_id, quantity)
  values (v_product_id, v_site_location, 'site', v_site_id, 0)
  on conflict (product_id, location) do nothing;

  update public.stock_items
     set quantity = quantity + v_quantity
   where product_id = v_product_id
     and location   = v_site_location;

  insert into public.stock_ledger (product_id, location, movement_type, quantity)
  values (v_product_id, v_site_location, 'in', v_quantity);

  update public.stock_requests
     set status     = 'shipped',
         shipped_at = now(),
         shipped_by = p_shipped_by
   where id = p_request_id;

  return v_ledger_id;
end;
$$;

-- ---- return_from_site: center ガード（本体ロジックは 021 と同一）
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
set search_path = public
as $$
declare
  v_site_location text;
  v_site_quantity numeric(12, 2);
  v_return_id     uuid;
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
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
    and si.location   = v_site_location
    and si.storage_kind = 'site'
  for update;

  if v_site_quantity is null then
    raise exception 'site_stock_item_not_found';
  end if;

  if v_site_quantity < p_quantity then
    raise exception 'insufficient_site_stock';
  end if;

  update public.stock_items
     set quantity = quantity - p_quantity
   where product_id = p_product_id
     and location    = v_site_location;

  perform public.apply_stock_movement(p_product_id, 'center', 'in', p_quantity);

  insert into public.stock_ledger (product_id, location, movement_type, quantity)
  values (p_product_id, v_site_location, 'out', p_quantity);

  insert into public.stock_returns (product_id, site_id, quantity, memo, returned_by)
  values (p_product_id, p_site_id, p_quantity, p_memo, p_returned_by)
  returning id into v_return_id;

  return v_return_id;
end;
$$;

-- ---- list_app_users: admin ガード（本体ロジックは 024 と同一）
create or replace function public.list_app_users()
returns table (
  id uuid,
  email text,
  role text,
  display_name text,
  vendor_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select au.id, u.email, au.role, au.display_name, au.vendor_id,
         au.created_at, au.updated_at
    from public.app_users au
    join auth.users u on u.id = au.id
   where public.is_admin();
$$;

-- ---- resolve_auth_user_by_email: admin ガード
create or replace function public.resolve_auth_user_by_email(p_email text)
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.email
    from auth.users u
   where public.is_admin()
     and u.email = p_email;
$$;

-- ---- update_app_user_by_internal: admin ガード + role 検証を admin/center/vendor に更新
create or replace function public.update_app_user_by_internal(
  p_id           uuid,
  p_display_name text,
  p_role         text,
  p_vendor_id    uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_role not in ('admin', 'center', 'vendor') then
    raise exception 'invalid_role';
  end if;

  update public.app_users
     set display_name = p_display_name,
         role          = p_role,
         vendor_id     = case when p_role = 'vendor' then p_vendor_id else null end
   where id = p_id;

  if not found then
    raise exception 'app_user_not_found';
  end if;
end;
$$;

-- 全 RPC の EXECUTE を再確認（anon/public 剥奪・authenticated 付与）
revoke execute on function public.apply_stock_movement(uuid, text, text, numeric) from public;
revoke execute on function public.apply_stock_movement(uuid, text, text, numeric) from anon;
grant  execute on function public.apply_stock_movement(uuid, text, text, numeric) to authenticated;
revoke execute on function public.ship_stock_request(uuid, text) from public;
revoke execute on function public.ship_stock_request(uuid, text) from anon;
grant  execute on function public.ship_stock_request(uuid, text) to authenticated;
revoke execute on function public.return_from_site(uuid, uuid, numeric, text, text) from public;
revoke execute on function public.return_from_site(uuid, uuid, numeric, text, text) from anon;
grant  execute on function public.return_from_site(uuid, uuid, numeric, text, text) to authenticated;
revoke execute on function public.list_app_users() from public;
revoke execute on function public.list_app_users() from anon;
grant  execute on function public.list_app_users() to authenticated;
revoke execute on function public.resolve_auth_user_by_email(text) from public;
revoke execute on function public.resolve_auth_user_by_email(text) from anon;
grant  execute on function public.resolve_auth_user_by_email(text) to authenticated;
revoke execute on function public.update_app_user_by_internal(uuid, text, text, uuid) from public;
revoke execute on function public.update_app_user_by_internal(uuid, text, text, uuid) from anon;
grant  execute on function public.update_app_user_by_internal(uuid, text, text, uuid) to authenticated;

-- ===========================================================================
-- G) データ移行: 既存 internal ユーザーを admin へ
--    （policy は internal も許容するため、この移行前後どちらでも無停止。UPDATE は元々冪等）
-- ===========================================================================
update public.app_users set role = 'admin' where role = 'internal';

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) 既存 internal ユーザーが admin に移行されたこと
-- select role, count(*) from public.app_users group by role order by role;
-- -- 期待: internal=0, admin>=1, vendor>=1（center は手動割り当て後に増える）
--
-- -- (b) 主要テーブルの policy 一覧（*_read / *_admin_* / *_center_* / *_vendor_* が並ぶ）
-- select tablename, policyname, cmd from pg_policies
--  where schemaname='public'
--    and tablename in ('customers','products','sites','site_products','vendors','vendor_sites',
--                      'stock_items','stock_ledger','stock_requests','stock_returns','app_users')
--  order by tablename, cmd, policyname;
--
-- -- (c) 旧 *_internal_* policy が消えていること
-- select tablename, policyname from pg_policies
--  where schemaname='public' and policyname like '%_internal_%';
-- -- 期待: 0 行
--
-- -- (d) RPC ガード確認
-- select p.proname, position('is_center' in pg_get_functiondef(p.oid))>0 as center_guard,
--        position('is_admin' in pg_get_functiondef(p.oid))>0 as admin_guard
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public'
--    and p.proname in ('apply_stock_movement','ship_stock_request','return_from_site',
--                      'list_app_users','resolve_auth_user_by_email','update_app_user_by_internal');

-- ---------------------------------------------------------------------------
-- ROLLBACK 方針
-- ---------------------------------------------------------------------------
-- 本 migration は policy 名・RPC ガード・role データを変更する。取り消す場合は
-- 017/018/019/021/024/025 の該当 policy・RPC 定義を再適用し、
-- update public.app_users set role='internal' where role='admin'; を実行する
-- （ただし手動で center を割り当てた後は個別確認が必要）。
