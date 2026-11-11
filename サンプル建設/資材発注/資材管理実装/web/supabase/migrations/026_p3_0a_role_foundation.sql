-- 026_p3_0a_role_foundation.sql
-- 025 適用後に Supabase SQL Editor で実行（027 より先に実行すること）
-- Phase 3-0A: admin / center / vendor 3権限分離 — DB 基盤
--
-- 方針:
--   - app_users.role の CHECK 制約に 'admin' / 'center' を追加する（'internal' は残す）
--   - 役割判定ヘルパー is_admin / is_center / is_admin_or_center を追加する
--     （'internal' は移行期間中 admin と center の両方を満たす「レガシー superuser」として扱う。
--       これにより既存 internal ユーザーは移行前でも一切機能停止しない）
--   - 本 migration は制約拡張と関数追加のみで、既存 policy・RPC・データは変更しない
--     （behavior 変化なし。実際の policy 切替とデータ移行は 027 で行う）
--   - ハードコーディングを避けるため、027 以降の policy は文字列 'internal' 等を直接書かず
--     本ファイルのヘルパー関数を参照する

begin;

-- ===========================================================================
-- 1) app_users.role の CHECK 制約を拡張（internal / admin / center / vendor）
-- ===========================================================================
alter table public.app_users
  drop constraint if exists app_users_role_check;

alter table public.app_users
  add constraint app_users_role_check
  check (role in ('internal', 'admin', 'center', 'vendor'));

comment on column public.app_users.role is
  'internal(レガシー・移行後は使わない) / admin(事務) / center(サンプル市Aセンター) / vendor(現場・業者)。Phase 3-0A';

-- ===========================================================================
-- 2) 役割判定ヘルパー（current_app_role() を基に真偽を返す）
--    - internal は admin/center 両方を満たす移行期レガシー superuser
--    - security definer / stable / search_path 固定（既存ヘルパーと同方針）
-- ===========================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_app_role() in ('admin', 'internal');
$$;

create or replace function public.is_center()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_app_role() in ('center', 'internal');
$$;

create or replace function public.is_admin_or_center()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_app_role() in ('admin', 'center', 'internal');
$$;

comment on function public.is_admin is
  'admin(事務) または internal(レガシー) のとき true。Phase 3-0A';
comment on function public.is_center is
  'center(サンプル市Aセンター) または internal(レガシー) のとき true。Phase 3-0A';
comment on function public.is_admin_or_center is
  'admin / center / internal のいずれかのとき true。参照系 policy 用。Phase 3-0A';

revoke execute on function public.is_admin() from public;
revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

revoke execute on function public.is_center() from public;
revoke execute on function public.is_center() from anon;
grant execute on function public.is_center() to authenticated;

revoke execute on function public.is_admin_or_center() from public;
revoke execute on function public.is_admin_or_center() from anon;
grant execute on function public.is_admin_or_center() to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) CHECK 制約に admin/center が入っていること
-- select pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'public.app_users'::regclass and conname = 'app_users_role_check';
--
-- -- (b) ヘルパー関数の存在・EXECUTE 権限
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name in ('is_admin','is_center','is_admin_or_center')
--    and grantee in ('anon','authenticated','public')
--  order by routine_name, grantee;
-- -- 期待: 各関数 authenticated EXECUTE のみ
--
-- -- (c) 既存データは無変更（この時点ではまだ internal のまま）
-- select role, count(*) from public.app_users group by role order by role;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.is_admin_or_center();
-- drop function if exists public.is_center();
-- drop function if exists public.is_admin();
-- alter table public.app_users drop constraint if exists app_users_role_check;
-- alter table public.app_users add constraint app_users_role_check
--   check (role in ('internal', 'vendor'));
-- commit;
-- notify pgrst, 'reload schema';
