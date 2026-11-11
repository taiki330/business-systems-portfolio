-- 024_p2_2_user_management.sql
-- 023 適用後に Supabase SQL Editor で実行
-- Phase 2-2: 既存 Auth ユーザーの app_users 管理画面
-- 詳細設計: 実装前レビュー（会話履歴）を正とする。
--
-- 方針:
--   - 新規 Auth アカウント発行・招待メール・パスワード設定は行わない
--     （既に auth.users に存在するユーザーを app_users へ登録・編集するのみ）
--   - app_users_self_select（既存 SELECT policy）は無変更
--   - app_users 全件 SELECT policy は追加しない。一覧・メール検索は
--     SECURITY DEFINER 関数（list_app_users / resolve_auth_user_by_email）経由にする
--   - app_users に internal 限定の INSERT/UPDATE policy を追加。DELETE は追加しない
--   - 自分自身の role / vendor_id 変更は BEFORE UPDATE トリガーで DB 層から拒否する
--     （UI・Server Action と合わせた三層防御。詳細は実装前レビュー参照）
--   - service_role / Supabase Admin API は使わない

begin;

-- ===========================================================================
-- 1) list_app_users(): internal 限定で app_users × auth.users を一覧
-- ===========================================================================
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
   where public.current_app_role() = 'internal';
$$;

comment on function public.list_app_users is
  'internal 限定。app_users と auth.users(email) を結合して一覧を返す。'
  ' app_users_self_select を広げず、関数経由でのみ他ユーザーの情報を公開する。Phase 2-2';

revoke execute on function public.list_app_users() from public;
revoke execute on function public.list_app_users() from anon;
grant execute on function public.list_app_users() to authenticated;

-- ===========================================================================
-- 2) resolve_auth_user_by_email(): internal 限定でメールから既存 Auth ユーザーを検索
-- ===========================================================================
create or replace function public.resolve_auth_user_by_email(p_email text)
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.email
    from auth.users u
   where public.current_app_role() = 'internal'
     and u.email = p_email;
$$;

comment on function public.resolve_auth_user_by_email is
  'internal 限定。メールアドレスから既存 auth.users を検索する（新規発行はしない）。Phase 2-2';

revoke execute on function public.resolve_auth_user_by_email(text) from public;
revoke execute on function public.resolve_auth_user_by_email(text) from anon;
grant execute on function public.resolve_auth_user_by_email(text) to authenticated;

-- ===========================================================================
-- 3) app_users: internal 限定の INSERT/UPDATE を許可（DELETE は追加しない）
-- ===========================================================================
grant insert, update on table public.app_users to authenticated;

drop policy if exists "app_users_internal_insert" on public.app_users;
drop policy if exists "app_users_internal_update" on public.app_users;

create policy "app_users_internal_insert"
  on public.app_users for insert to authenticated
  with check (public.current_app_role() = 'internal');

create policy "app_users_internal_update"
  on public.app_users for update to authenticated
  using (public.current_app_role() = 'internal')
  with check (public.current_app_role() = 'internal');

-- ===========================================================================
-- 4) 自分自身の role / vendor_id 変更を拒否する BEFORE UPDATE トリガー
--    - DB 層の最終防衛。UI・Server Action をすり抜けても必ず止める
-- ===========================================================================
create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() = old.id
     and (new.role is distinct from old.role
          or new.vendor_id is distinct from old.vendor_id) then
    raise exception 'cannot_change_own_role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.prevent_self_role_change is
  '自分自身の app_users 行に対する role / vendor_id 変更を拒否する。Phase 2-2 の三層防御の DB 層';

drop trigger if exists app_users_prevent_self_role_change on public.app_users;
create trigger app_users_prevent_self_role_change
  before update on public.app_users
  for each row execute function public.prevent_self_role_change();

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) 関数の存在・属性
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--        p.prosecdef as security_definer
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public'
--    and p.proname in ('list_app_users','resolve_auth_user_by_email','prevent_self_role_change');
--
-- -- (b) EXECUTE 権限（anon なし / authenticated あり。トリガー関数はトリガー経由のみなので対象外）
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name in ('list_app_users','resolve_auth_user_by_email')
--    and grantee in ('anon','authenticated','public')
--  order by routine_name, grantee;
-- -- 期待: authenticated EXECUTE のみ（各関数1行ずつ）
--
-- -- (c) app_users の policy 一覧
-- select policyname, cmd, roles
--   from pg_policies
--  where schemaname='public' and tablename='app_users'
--  order by cmd;
-- -- 期待: app_users_self_select(select) / app_users_internal_insert(insert) /
-- --       app_users_internal_update(update) の3件。delete policy なし
--
-- -- (d) app_users への GRANT（delete が付与されていないこと）
-- select privilege_type
--   from information_schema.table_privileges
--  where table_schema='public' and table_name='app_users' and grantee='authenticated';
-- -- 期待: SELECT / INSERT / UPDATE のみ。DELETE なし
--
-- -- (e) トリガーの存在
-- select tgname, tgrelid::regclass
--   from pg_trigger
--  where tgname = 'app_users_prevent_self_role_change';

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- drop trigger if exists app_users_prevent_self_role_change on public.app_users;
-- drop function if exists public.prevent_self_role_change();
--
-- drop policy if exists "app_users_internal_insert" on public.app_users;
-- drop policy if exists "app_users_internal_update" on public.app_users;
-- revoke insert, update on table public.app_users from authenticated;
--
-- drop function if exists public.resolve_auth_user_by_email(text);
-- drop function if exists public.list_app_users();
--
-- commit;
-- notify pgrst, 'reload schema';
