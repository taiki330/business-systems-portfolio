-- 018_a7_stock_role_policies.sql
-- 017 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-7-DB-3: 在庫系（stock_items / stock_ledger / apply_stock_movement）の
-- authenticated policy を role 別に分割し、RPC に internal ガードを追加する。
-- 詳細設計: docs/13 §5 / §13-12 / A-7
--
-- 適用前の実 DB 確認結果（2026-06-01）:
--   - stock_items   : anon=0 / auth=4（select/insert/update/delete）
--   - stock_ledger  : anon=0 / auth=2（select/insert）
--   - apply_stock_movement: security definer=true / authenticated execute あり / anon execute なし
--   - stock_items location 分布: center のみ 2 行（qty_sum=151）
--
-- 設計方針:
--   - 既存 *_authenticated_* policy を drop し、internal 用 policy と vendor 用 policy に分割
--   - INSERT/UPDATE/DELETE は internal のみ（vendor 用 policy は作らない）
--   - SELECT のみ vendor 用 policy を作成
--       - stock_items  : vendor は location='center' の行のみ参照可（docs/13 §5-2 / §5-4）
--       - stock_ledger : vendor 用 policy なし（履歴は internal のみ）
--   - apply_stock_movement は security definer のため RLS をバイパスする。
--     vendor が直接呼べると stock_items / stock_ledger を書き換えられるため、
--     関数先頭で current_app_role() = 'internal' ガードを追加する（二重防御）
--     - ship_stock_request 経由でも内部で呼ばれるが、A-7-DB-4 で ship 自体を
--       internal 限定にする前提。internal が呼ぶ限り無回帰
--   - anon には触れない（A-6-4 完了）

begin;

-- ===========================================================================
-- 1) stock_items : internal 全権 / vendor は center のみ SELECT
-- ===========================================================================
drop policy if exists "stock_items_authenticated_select" on public.stock_items;
drop policy if exists "stock_items_authenticated_insert" on public.stock_items;
drop policy if exists "stock_items_authenticated_update" on public.stock_items;
drop policy if exists "stock_items_authenticated_delete" on public.stock_items;

create policy "stock_items_internal_select"
  on public.stock_items for select to authenticated
  using (public.current_app_role() = 'internal');
create policy "stock_items_internal_insert"
  on public.stock_items for insert to authenticated
  with check (public.current_app_role() = 'internal');
create policy "stock_items_internal_update"
  on public.stock_items for update to authenticated
  using (public.current_app_role() = 'internal')
  with check (public.current_app_role() = 'internal');
create policy "stock_items_internal_delete"
  on public.stock_items for delete to authenticated
  using (public.current_app_role() = 'internal');

create policy "stock_items_vendor_select"
  on public.stock_items for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and location = 'center'
  );

-- ===========================================================================
-- 2) stock_ledger : internal のみ SELECT/INSERT（UPDATE/DELETE policy は作らない）
-- ===========================================================================
drop policy if exists "stock_ledger_authenticated_select" on public.stock_ledger;
drop policy if exists "stock_ledger_authenticated_insert" on public.stock_ledger;

create policy "stock_ledger_internal_select"
  on public.stock_ledger for select to authenticated
  using (public.current_app_role() = 'internal');
create policy "stock_ledger_internal_insert"
  on public.stock_ledger for insert to authenticated
  with check (public.current_app_role() = 'internal');

-- ===========================================================================
-- 3) apply_stock_movement : security definer の穴を塞ぐ internal ガード
-- ---------------------------------------------------------------------------
--   - 元定義（004）と同一シグネチャ・同一ロジック
--   - 先頭で current_app_role() = 'internal' を確認し、それ以外は permission_denied
--   - ship_stock_request からも呼ばれるが、A-7-DB-4 で ship 自体を internal 限定にする
-- ===========================================================================
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
  if public.current_app_role() is distinct from 'internal' then
    raise exception 'permission_denied: internal role required'
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

comment on function public.apply_stock_movement is
  '入出庫: stock_items を更新し stock_ledger に履歴を追記（1トランザクション）。'
  || ' A-7-DB-3 で先頭に internal ガード追加（docs/13 §13-12）。';

-- A-6-4 時点で anon EXECUTE は剥奪済み。create or replace 後は public への
-- 自動付与が発生し得るため、念のため anon / public への EXECUTE を明示剥奪する。
revoke execute on function public.apply_stock_movement(uuid, text, text, numeric)
  from public;
revoke execute on function public.apply_stock_movement(uuid, text, text, numeric)
  from anon;

-- authenticated には EXECUTE 維持（009 / 004 で付与済みだが冪等のため再付与）
grant execute on function public.apply_stock_movement(uuid, text, text, numeric)
  to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) policy 数（stock_items=5: internal×4 + vendor×1 / stock_ledger=2: internal×2）
-- select tablename, count(*) as auth_policies,
--        count(*) filter (where policyname like '%internal%') as internal_cnt,
--        count(*) filter (where policyname like '%vendor%')   as vendor_cnt
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('stock_items','stock_ledger')
--    and roles::text like '%authenticated%'
--  group by tablename
--  order by tablename;
-- -- 期待: stock_items auth=5 internal=4 vendor=1 / stock_ledger auth=2 internal=2 vendor=0
--
-- -- (b) 旧 *_authenticated_* が消えていること
-- select tablename, policyname
--   from pg_policies
--  where schemaname='public'
--    and policyname like '%_authenticated_%'
--    and tablename in ('stock_items','stock_ledger');
-- -- 期待: 0 行
--
-- -- (c) anon は依然 0 件
-- select count(*) as anon_cnt
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('stock_items','stock_ledger')
--    and roles::text like '%anon%';
-- -- 期待: 0
--
-- -- (d) apply_stock_movement の EXECUTE（anon なし / authenticated あり）
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name='apply_stock_movement'
--    and grantee in ('anon','authenticated','public')
--  order by grantee;
-- -- 期待: authenticated EXECUTE のみ
--
-- -- (e) 関数本体に internal ガードが入っていること
-- select pg_get_functiondef(p.oid)
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname='apply_stock_movement';
-- -- 期待: 本文中に 'permission_denied: internal role required' を含む
--
-- -- (f) データ無変更
-- select 'stock_items' as t, count(*) from public.stock_items
-- union all select 'stock_ledger', count(*) from public.stock_ledger;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（A-7-DB-3 を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- -- stock_items
-- drop policy if exists "stock_items_internal_select" on public.stock_items;
-- drop policy if exists "stock_items_internal_insert" on public.stock_items;
-- drop policy if exists "stock_items_internal_update" on public.stock_items;
-- drop policy if exists "stock_items_internal_delete" on public.stock_items;
-- drop policy if exists "stock_items_vendor_select"   on public.stock_items;
-- create policy "stock_items_authenticated_select"
--   on public.stock_items for select to authenticated using (true);
-- create policy "stock_items_authenticated_insert"
--   on public.stock_items for insert to authenticated with check (true);
-- create policy "stock_items_authenticated_update"
--   on public.stock_items for update to authenticated using (true) with check (true);
-- create policy "stock_items_authenticated_delete"
--   on public.stock_items for delete to authenticated using (true);
--
-- -- stock_ledger
-- drop policy if exists "stock_ledger_internal_select" on public.stock_ledger;
-- drop policy if exists "stock_ledger_internal_insert" on public.stock_ledger;
-- create policy "stock_ledger_authenticated_select"
--   on public.stock_ledger for select to authenticated using (true);
-- create policy "stock_ledger_authenticated_insert"
--   on public.stock_ledger for insert to authenticated with check (true);
--
-- -- apply_stock_movement（004 の本体に戻す）
-- create or replace function public.apply_stock_movement(
--   p_product_id uuid,
--   p_location text,
--   p_movement_type text,
--   p_quantity numeric
-- )
-- returns uuid
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- declare
--   v_ledger_id uuid;
--   v_current numeric(12, 2);
--   v_location text;
-- begin
--   v_location := nullif(trim(p_location), '');
--   if v_location is null then raise exception 'location_required'; end if;
--   if p_quantity is null or p_quantity <= 0 then
--     raise exception 'quantity_must_be_positive';
--   end if;
--   if p_movement_type not in ('in','out') then
--     raise exception 'invalid_movement_type';
--   end if;
--   insert into public.stock_items (product_id, location, quantity)
--   values (p_product_id, v_location, 0)
--   on conflict (product_id, location) do nothing;
--   select si.quantity into v_current
--     from public.stock_items si
--    where si.product_id = p_product_id and si.location = v_location
--    for update;
--   if v_current is null then raise exception 'stock_item_not_found'; end if;
--   if p_movement_type = 'out' and v_current < p_quantity then
--     raise exception 'insufficient_stock';
--   end if;
--   if p_movement_type = 'in' then
--     update public.stock_items set quantity = quantity + p_quantity
--      where product_id = p_product_id and location = v_location;
--   else
--     update public.stock_items set quantity = quantity - p_quantity
--      where product_id = p_product_id and location = v_location;
--   end if;
--   insert into public.stock_ledger (product_id, location, movement_type, quantity)
--   values (p_product_id, v_location, p_movement_type, p_quantity)
--   returning id into v_ledger_id;
--   return v_ledger_id;
-- end;
-- $$;
-- revoke execute on function public.apply_stock_movement(uuid, text, text, numeric) from public;
-- revoke execute on function public.apply_stock_movement(uuid, text, text, numeric) from anon;
-- grant  execute on function public.apply_stock_movement(uuid, text, text, numeric) to authenticated;
--
-- commit;
-- notify pgrst, 'reload schema';
