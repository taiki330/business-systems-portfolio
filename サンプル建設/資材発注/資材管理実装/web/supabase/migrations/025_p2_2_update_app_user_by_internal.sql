-- 025_p2_2_update_app_user_by_internal.sql
-- 024 適用後に Supabase SQL Editor で実行
-- Phase 2-2 不具合修正: 他人ユーザーの app_users 更新が 0 件になる問題への対応
--
-- 原因:
--   - app_users_internal_update（024）の using/with check は current_app_role()='internal' のみで
--     対象行に依存しない条件のはずだが、current_app_role() 自体が app_users を参照する関数であり、
--     app_users 自身の RLS policy 評価の中で呼ばれる「自己参照」構造になっている。
--   - 自分自身の行の更新では自明に解決できるが、他人の行を更新している最中に同じテーブルへの
--     内部 SELECT を評価しようとすると期待どおりに解決されないことを、実機の生SQL検証
--     （current_app_role() 単体では 'internal' を返すが、他人の行への UPDATE は 0 件）で確認した。
--
-- 方針:
--   - 他人ユーザーの更新は、RLS を経由するクライアント直接 UPDATE をやめ、
--     list_app_users / resolve_auth_user_by_email と同じ SECURITY DEFINER 関数に寄せる
--   - app_users 全件 SELECT policy は追加しない（露出範囲を広げない）
--   - 自分自身の display_name 更新（既存の直接 UPDATE、動作確認済み）は変更しない
--   - prevent_self_role_change トリガーはテーブルに紐づくため、この関数経由でも自動的に効く
--   - service_role は使わない。新規 Auth アカウント発行は入れない

begin;

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
  if public.current_app_role() is distinct from 'internal' then
    raise exception 'permission_denied: internal role required'
      using errcode = '42501';
  end if;

  if p_role not in ('internal', 'vendor') then
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

comment on function public.update_app_user_by_internal is
  'internal 限定。他人ユーザーの app_users(display_name/role/vendor_id) を更新する。'
  ' app_users 自身を参照する current_app_role() の自己参照 RLS 問題を回避するため、'
  ' クライアント直接 UPDATE ではなく本関数経由にする。prevent_self_role_change トリガーは引き続き有効。Phase 2-2 修正';

revoke execute on function public.update_app_user_by_internal(uuid, text, text, uuid) from public;
revoke execute on function public.update_app_user_by_internal(uuid, text, text, uuid) from anon;
grant execute on function public.update_app_user_by_internal(uuid, text, text, uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) 関数の存在・属性
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--        p.prosecdef as security_definer
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname='update_app_user_by_internal';
--
-- -- (b) EXECUTE 権限（anon なし / authenticated あり）
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='update_app_user_by_internal'
--    and grantee in ('anon','authenticated','public');
--
-- -- (c) 動作確認（アプリ経由・internal ログイン後、他人ユーザーの id で）
-- -- select public.update_app_user_by_internal('<他人のapp_users.id>'::uuid, 'test', 'vendor', null);
-- -- select display_name, role from public.app_users where id = '<同id>';

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.update_app_user_by_internal(uuid, text, text, uuid);
-- commit;
-- notify pgrst, 'reload schema';
