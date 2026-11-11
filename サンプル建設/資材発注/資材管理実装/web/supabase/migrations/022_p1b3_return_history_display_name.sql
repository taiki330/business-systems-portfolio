-- 022_p1b3_return_history_display_name.sql
-- 021 適用後に Supabase SQL Editor で実行
-- P1-B Phase3: 返却履歴一覧（/stock/returns）表示名解決
-- 詳細設計: 実装前レビュー（会話履歴）を正とする。
--
-- 方針:
--   - stock_returns.returned_by（auth.users.id の text 表現）から表示名を出すため、
--     app_users の SELECT policy は変更せず（自分の行のみのまま維持）、
--     display_name だけを返す SECURITY DEFINER 関数を新設する
--   - internal 以外の呼び出しは空集合を返す（app_users の role / vendor_id 等は一切公開しない）
--   - 複数 id をまとめて解決できるようにし、一覧表示時の N+1 呼び出しを避ける
--   - app_users テーブル本体・既存 RLS policy・stock_returns/stock_ledger/stock_items は無変更

begin;

create or replace function public.resolve_display_names(p_user_ids uuid[])
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select au.id, au.display_name
    from public.app_users au
   where public.current_app_role() = 'internal'
     and au.id = any(p_user_ids)
$$;

comment on function public.resolve_display_names is
  'internal 限定。app_users.display_name のみを複数 id 分まとめて解決する。'
  ' role/vendor_id 等は公開しない。P1-B Phase3（返却履歴一覧用）';

revoke execute on function public.resolve_display_names(uuid[]) from public;
revoke execute on function public.resolve_display_names(uuid[]) from anon;
grant execute on function public.resolve_display_names(uuid[]) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) 関数の存在・属性
-- select p.proname,
--        pg_get_function_identity_arguments(p.oid) as args,
--        pg_get_function_result(p.oid) as returns,
--        p.prosecdef as security_definer
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname='resolve_display_names';
--
-- -- (b) EXECUTE 権限（anon なし / authenticated あり）
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='resolve_display_names'
--    and grantee in ('anon','authenticated','public')
--  order by grantee;
-- -- 期待: authenticated EXECUTE のみ
--
-- -- (c) app_users の既存 RLS policy が無変更であること
-- select policyname, cmd, roles
--   from pg_policies
--  where schemaname='public' and tablename='app_users';
-- -- 期待: app_users_self_select のみ（追加・削除なし）
--
-- -- (d) 動作確認（アプリ経由ログイン後、internal ユーザーで）
-- select * from public.resolve_display_names(array['<app_usersのid>']::uuid[]);
-- -- 期待: display_name が返る。vendor ユーザーでは空集合になることを別途確認する

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.resolve_display_names(uuid[]);
-- commit;
-- notify pgrst, 'reload schema';
