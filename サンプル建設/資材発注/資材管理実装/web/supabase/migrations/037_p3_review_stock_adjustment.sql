-- 037_p3_review_stock_adjustment.sql
-- 036 適用後に Supabase SQL Editor で実行
-- コードレビュー指摘（Critical #6）: 既存在庫（stock_items）の直接数量上書きを廃止
-- コードレビュー再指摘: stock_ledger への直接 INSERT も禁止
--
-- 背景:
--   - P0/P1 から存在する「在庫の直接登録・補正」機能（/stock/new, /stock/[id]/edit）は、
--     stock_items.quantity を Server Action から直接 UPDATE/INSERT しており、
--     stock_ledger に履歴が残らない。Phase 3 で追加した分析ビュー
--     （material_movement_*, site_product_plan_status 等）は stock_ledger を正として
--     集計するため、この抜け道があると「現在庫」と「台帳・分析」が食い違う。
--   - さらに stock_ledger 自体も 027 の "stock_ledger_write_insert" policy と
--     004 の GRANT により authenticated から直接 INSERT 可能なままだった。
--     stock_items の書込経路を RPC に一本化しても、stock_ledger に直接
--     つじつまの合わない履歴行を追記できてしまうと台帳の信頼性が保てないため、
--     stock_ledger への書込経路も RPC（apply_stock_movement 系 / adjust_stock_item）のみに限定する。
--
-- 方針:
--   - adjust_stock_item RPC を新設し、絶対値指定の補正を「差分の in/out」として
--     stock_ledger に記録したうえで stock_items.quantity を更新する（1トランザクション）。
--     reason 列（本ファイルで追加）に 'opening_balance'（新規登録）/
--     'inventory_adjustment'（既存補正）を記録する。
--   - stock_items への直接 INSERT/UPDATE/DELETE 権限を authenticated から剥奪し、
--     017/018 で作成された直接書込 policy を削除する。以後の書込は
--     apply_stock_movement（入出庫）・adjust_stock_item（補正・新規登録）
--     いずれも SECURITY DEFINER RPC 経由のみとなる。
--   - stock_ledger への直接 INSERT 権限も authenticated から剥奪し、
--     027 で作成された "stock_ledger_write_insert" policy を削除する。
--     以後 stock_ledger への書込は、SECURITY DEFINER として動作する
--     apply_stock_movement / ship_stock_request / return_from_site / adjust_stock_item
--     のみが行う（いずれも関数所有者権限で実行され GRANT 剥奪の影響を受けない）。
--   - admin ガードは RPC 内で行う（既存の requireAdmin による Server Action 側の
--     ガードは維持しつつ、RPC 側でも二重に検証する多層防御を崩さない）。
--
-- 冪等性: add column if not exists / create or replace function / drop policy if exists /
--         revoke は再実行しても安全。

begin;

-- ===========================================================================
-- 1) stock_ledger.reason（補正・開始残高の種別を記録）
-- ===========================================================================
alter table public.stock_ledger
  add column if not exists reason text;

comment on column public.stock_ledger.reason is
  '任意の理由種別。通常の入出庫は NULL。adjust_stock_item 由来は opening_balance / inventory_adjustment。Phase 3（レビュー対応）';

-- ===========================================================================
-- 2) adjust_stock_item: 在庫の絶対値補正（admin のみ）
--    差分を stock_ledger に記録したうえで stock_items.quantity を更新する。
-- ===========================================================================
create or replace function public.adjust_stock_item(
  p_product_id    uuid,
  p_location      text,
  p_new_quantity  numeric,
  p_reason        text default 'inventory_adjustment'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_location   text;
  v_current    numeric(12, 2);
  v_site_id    uuid;
  v_delta      numeric(12, 2);
  v_ledger_id  uuid;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_reason not in ('opening_balance', 'inventory_adjustment') then
    raise exception 'invalid_adjustment_reason';
  end if;

  v_location := nullif(trim(p_location), '');
  if v_location is null then
    raise exception 'location_required';
  end if;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'quantity_must_be_non_negative';
  end if;

  insert into public.stock_items (product_id, location, quantity)
  values (p_product_id, v_location, 0)
  on conflict (product_id, location) do nothing;

  select quantity, site_id into v_current, v_site_id
    from public.stock_items
   where product_id = p_product_id
     and location    = v_location
   for update;

  if v_current is null then
    raise exception 'stock_item_not_found';
  end if;

  v_delta := p_new_quantity - v_current;

  if v_delta = 0 then
    return null;
  end if;

  update public.stock_items
     set quantity = p_new_quantity
   where product_id = p_product_id
     and location    = v_location;

  insert into public.stock_ledger (
    product_id, location, movement_type, quantity, site_id, created_by, reason
  )
  values (
    p_product_id, v_location,
    case when v_delta > 0 then 'in' else 'out' end,
    abs(v_delta), v_site_id, public.current_actor_id(), p_reason
  )
  returning id into v_ledger_id;

  return v_ledger_id;
end;
$$;

comment on function public.adjust_stock_item is
  '在庫の絶対値補正（admin のみ）。差分を stock_ledger に reason 付きで記録してから quantity を更新する。Phase 3（レビュー対応 Critical #6）';

revoke execute on function public.adjust_stock_item(uuid, text, numeric, text) from public;
revoke execute on function public.adjust_stock_item(uuid, text, numeric, text) from anon;
grant  execute on function public.adjust_stock_item(uuid, text, numeric, text) to authenticated;

-- ===========================================================================
-- 3) stock_items: 直接書込を廃止（RPC 経由のみに一本化）
-- ===========================================================================
revoke insert, update, delete on table public.stock_items from authenticated;

drop policy if exists "stock_items_admin_insert" on public.stock_items;
drop policy if exists "stock_items_admin_update" on public.stock_items;
drop policy if exists "stock_items_admin_delete" on public.stock_items;

comment on table public.stock_items is
  '在庫（商品×保管場所）。書込は apply_stock_movement（入出庫）/ adjust_stock_item（補正・新規登録）'
  ' の SECURITY DEFINER RPC 経由のみ。直接 INSERT/UPDATE/DELETE 権限は authenticated から剥奪済み（Phase 3 レビュー対応）';

-- ===========================================================================
-- 3.5) stock_ledger: 直接 INSERT を廃止（RPC 経由のみに一本化）
--      apply_stock_movement / ship_stock_request / return_from_site / adjust_stock_item は
--      いずれも SECURITY DEFINER のため、この REVOKE の影響を受けず引き続き書込できる。
-- ===========================================================================
revoke insert on table public.stock_ledger from authenticated;

drop policy if exists "stock_ledger_write_insert" on public.stock_ledger;

comment on table public.stock_ledger is
  '在庫入出庫履歴（追記のみ）。書込は apply_stock_movement / ship_stock_request / return_from_site /'
  ' adjust_stock_item の SECURITY DEFINER RPC 経由のみ。直接 INSERT 権限は authenticated から剥奪済み（Phase 3 レビュー対応）';

-- ===========================================================================
-- 4) 分析・レポート用の複合 index（レビュー Medium 対応）
-- ===========================================================================
create index if not exists stock_ledger_product_site_created_idx
  on public.stock_ledger (product_id, site_id, created_at desc);

create index if not exists lease_stock_ledger_product_company_created_idx
  on public.lease_stock_ledger (product_id, lease_company_id, created_at desc);

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) authenticated が stock_items へ書込できないこと
-- select table_name, grantee, privilege_type
--   from information_schema.table_privileges
--  where table_schema='public' and table_name='stock_items'
--  order by grantee, privilege_type;
-- -- 期待: authenticated は SELECT のみ
--
-- -- (b) 旧 policy が削除されていること
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='stock_items'
--  order by cmd, policyname;
-- -- 期待: SELECT 系 policy のみ（INSERT/UPDATE/DELETE の admin policy が無い）
--
-- -- (c) adjust_stock_item の EXECUTE が authenticated のみであること
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='adjust_stock_item';
--
-- -- (d) 補正が ledger に記録されること（手動確認例）
-- -- select public.adjust_stock_item('<product_id>', 'center', 123, 'inventory_adjustment');
-- -- select * from public.stock_ledger where reason is not null order by created_at desc limit 5;
--
-- -- (e) authenticated が stock_ledger へ直接 INSERT できないこと
-- select table_name, grantee, privilege_type
--   from information_schema.table_privileges
--  where table_schema='public' and table_name='stock_ledger'
--  order by grantee, privilege_type;
-- -- 期待: authenticated は SELECT のみ（INSERT が無いこと）
--
-- -- (f) stock_ledger_write_insert policy が削除されていること
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='stock_ledger'
--  order by cmd, policyname;
-- -- 期待: SELECT 系 policy のみ

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop index if exists public.lease_stock_ledger_product_company_created_idx;
-- drop index if exists public.stock_ledger_product_site_created_idx;
--
-- grant insert, update, delete on table public.stock_items to authenticated;
-- create policy "stock_items_admin_insert" on public.stock_items
--   for insert to authenticated with check (public.is_admin());
-- create policy "stock_items_admin_update" on public.stock_items
--   for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- create policy "stock_items_admin_delete" on public.stock_items
--   for delete to authenticated using (public.is_admin());
--
-- grant insert on table public.stock_ledger to authenticated;
-- create policy "stock_ledger_write_insert" on public.stock_ledger
--   for insert to authenticated with check (public.is_admin_or_center());
--
-- drop function if exists public.adjust_stock_item(uuid, text, numeric, text);
-- alter table public.stock_ledger drop column if exists reason;
-- commit;
-- notify pgrst, 'reload schema';
