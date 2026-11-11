-- 016_a7_helper_functions.sql
-- 015 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-7-DB-1: 認可判定で使う SQL 関数（current_app_role / current_vendor_id）
-- 詳細設計: docs/13 §13-12 / A-7 §7-1
--
-- 適用前の実 DB 確認結果（2026-06-01）:
--   - app_users policy: app_users_self_select / SELECT / authenticated / using (auth.uid() = id)
--   - app_users データ: internal=1 件, vendor=1 件
--   - current_app_role / current_vendor_id: 既存なし（名前衝突なし）
--
-- 注意:
-- - security definer のため search_path を明示固定する（search path 攻撃対策）
-- - public 一般への EXECUTE を明示 revoke（security definer 関数の標準対策）
-- - GRANT は authenticated のみ。anon には付与しない（A-6 完了方針）
-- - 関数は本 migration 以降の 017〜020 で RLS policy 内から呼ばれる前提
-- - アプリ側からは直接呼ばない（A-7-app-1 で導入する require-role.ts は
--   既存 get-current-user.ts（app_users の SELECT）で role を取る方針）

begin;

-- ① current_app_role(): ログインユーザーの role を返す。未登録なら NULL
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role
    from public.app_users
   where id = auth.uid();
$$;

comment on function public.current_app_role() is
  'A-7 認可判定用。ログインユーザーの app_users.role を返す。未登録は NULL。docs/13 §13-12';

-- ② current_vendor_id(): vendor ユーザーの vendor_id を返す。internal や未登録は NULL
create or replace function public.current_vendor_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select vendor_id
    from public.app_users
   where id = auth.uid();
$$;

comment on function public.current_vendor_id() is
  'A-7 認可判定用。ログイン vendor ユーザーの app_users.vendor_id を返す。internal/未登録は NULL。docs/13 §13-12';

-- ③ 既存の public 一般 EXECUTE を明示的に剥奪（security definer 関数の標準対策）
--    create or replace 直後は public に EXECUTE が付くため、念のため明示 revoke
revoke execute on function public.current_app_role()   from public;
revoke execute on function public.current_vendor_id()  from public;

-- ④ anon にも明示的に revoke（A-6-6 完了後の整合性確保・冪等）
revoke execute on function public.current_app_role()   from anon;
revoke execute on function public.current_vendor_id()  from anon;

-- ⑤ authenticated に EXECUTE 付与（policy 内から呼ぶため必須）
grant execute on function public.current_app_role()   to authenticated;
grant execute on function public.current_vendor_id()  to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用前の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- 1) 名前衝突がないこと
-- select n.nspname as schema, p.proname,
--        pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where p.proname in ('current_app_role','current_vendor_id')
--  order by n.nspname, p.proname;
-- -- 期待: 0 行
--
-- -- 2) app_users policy が想定どおりであること
-- select policyname, cmd, qual
--   from pg_policies
--  where schemaname='public' and tablename='app_users';
-- -- 期待: app_users_self_select / SELECT / qual=(auth.uid() = id)
--
-- -- 3) app_users にテストデータがあること
-- select role, count(*) from public.app_users group by role order by role;
-- -- 期待: internal>=1, vendor>=1
--
-- -- 4) A-6 完了状態の最終確認
-- select 'schema_usage_anon' as k, has_schema_privilege('anon','public','USAGE')::text as v
-- union all
-- select 'anon_routine_grants', (select count(*)::text from information_schema.routine_privileges
--                                  where routine_schema='public' and grantee='anon');
-- -- 期待: false / 0

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) 関数の存在・属性
-- select p.proname,
--        pg_get_function_identity_arguments(p.oid) as args,
--        pg_get_function_result(p.oid) as returns,
--        p.prosecdef as security_definer,
--        p.provolatile as volatility,   -- s=stable
--        p.proconfig as proconfig       -- search_path 設定が見える
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public'
--    and p.proname in ('current_app_role','current_vendor_id')
--  order by p.proname;
-- -- 期待:
-- --   current_app_role  / ()  / text / true / s / {search_path=public, pg_temp}
-- --   current_vendor_id / ()  / uuid / true / s / {search_path=public, pg_temp}
--
-- -- (b) EXECUTE 権限
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name in ('current_app_role','current_vendor_id')
--    and grantee in ('anon','authenticated','PUBLIC')
--  order by routine_name, grantee;
-- -- 期待: authenticated / EXECUTE のみ（anon・PUBLIC は出ない）
--
-- -- (c) 関数の動作確認（SQL Editor では auth.uid() が NULL のため NULL が返る想定）
-- select public.current_app_role() as role, public.current_vendor_id() as vendor_id;
-- -- 期待: role=NULL, vendor_id=NULL（SQL Editor のコンテキストでは正常な挙動）
-- --       本番動作確認はアプリ経由ログイン後に行う

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（A-7-DB-1 を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.current_app_role();
-- drop function if exists public.current_vendor_id();
-- commit;
-- notify pgrst, 'reload schema';
--
-- -- rollback 後の確認
-- -- select n.nspname, p.proname
-- --   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- --  where p.proname in ('current_app_role','current_vendor_id');
-- -- 期待: 0 行
