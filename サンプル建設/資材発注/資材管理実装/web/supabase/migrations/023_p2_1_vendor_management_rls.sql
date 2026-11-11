-- 023_p2_1_vendor_management_rls.sql
-- 022 適用後に Supabase SQL Editor で実行
-- Phase 2-1: 業者マスタ・業者×現場紐付け管理画面
-- 詳細設計: 実装前レビュー（会話履歴）を正とする。
--
-- 方針:
--   - vendors / vendor_sites のテーブル構造は変更しない（010_vendors_vendor_sites.sql のまま）
--   - 既存の authenticated SELECT policy はどちらも無変更（using true のまま維持）
--   - vendors: internal 限定の INSERT/UPDATE/DELETE policy を追加
--   - vendor_sites: internal 限定の INSERT/DELETE policy を追加（UPDATE は不要。
--     追加属性を持たない複合PKのみのテーブルのため、変更は削除→追加で表現する）
--   - vendors.name の unique 制約・重複チェックは追加しない（既存方針どおり）
--   - GRANT を authenticated に INSERT/UPDATE/DELETE（vendor_sites は INSERT/DELETE）追加
--   - anon には一切触れない

begin;

-- ===========================================================================
-- 1) vendors: internal 限定の書き込みを許可
-- ===========================================================================
grant insert, update, delete on table public.vendors to authenticated;

drop policy if exists "vendors_internal_insert" on public.vendors;
drop policy if exists "vendors_internal_update" on public.vendors;
drop policy if exists "vendors_internal_delete" on public.vendors;

create policy "vendors_internal_insert"
  on public.vendors for insert to authenticated
  with check (public.current_app_role() = 'internal');

create policy "vendors_internal_update"
  on public.vendors for update to authenticated
  using (public.current_app_role() = 'internal')
  with check (public.current_app_role() = 'internal');

create policy "vendors_internal_delete"
  on public.vendors for delete to authenticated
  using (public.current_app_role() = 'internal');

-- ===========================================================================
-- 2) vendor_sites: internal 限定の追加・削除を許可（UPDATE policy は作らない）
-- ===========================================================================
grant insert, delete on table public.vendor_sites to authenticated;

drop policy if exists "vendor_sites_internal_insert" on public.vendor_sites;
drop policy if exists "vendor_sites_internal_delete" on public.vendor_sites;

create policy "vendor_sites_internal_insert"
  on public.vendor_sites for insert to authenticated
  with check (public.current_app_role() = 'internal');

create policy "vendor_sites_internal_delete"
  on public.vendor_sites for delete to authenticated
  using (public.current_app_role() = 'internal');

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) policy 一覧（vendors: select×1 + internal×3 / vendor_sites: select×1 + internal×2）
-- select tablename, policyname, cmd, roles
--   from pg_policies
--  where schemaname='public' and tablename in ('vendors','vendor_sites')
--  order by tablename, cmd;
--
-- -- (b) 既存 SELECT policy が無変更であること
-- select policyname, qual
--   from pg_policies
--  where schemaname='public' and tablename='vendors' and cmd='SELECT';
-- -- 期待: vendors_authenticated_select / using true のまま
--
-- -- (c) GRANT 確認（anon には何も付与されていないこと）
-- select table_name, grantee, privilege_type
--   from information_schema.table_privileges
--  where table_schema='public' and table_name in ('vendors','vendor_sites')
--  order by table_name, grantee, privilege_type;
--
-- -- (d) テーブル構造が無変更であること
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name in ('vendors','vendor_sites')
--  order by table_name, ordinal_position;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- drop policy if exists "vendors_internal_insert" on public.vendors;
-- drop policy if exists "vendors_internal_update" on public.vendors;
-- drop policy if exists "vendors_internal_delete" on public.vendors;
-- revoke insert, update, delete on table public.vendors from authenticated;
--
-- drop policy if exists "vendor_sites_internal_insert" on public.vendor_sites;
-- drop policy if exists "vendor_sites_internal_delete" on public.vendor_sites;
-- revoke insert, delete on table public.vendor_sites from authenticated;
--
-- commit;
-- notify pgrst, 'reload schema';
