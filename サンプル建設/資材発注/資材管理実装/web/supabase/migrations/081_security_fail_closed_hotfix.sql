-- 081_security_fail_closed_hotfix.sql
-- 078でGAS用にpublic schemaのUSAGEをanonへ戻した後も、GAS専用RPC以外を
-- 匿名実行させない。未登録ユーザーのNULLロールすり抜けも同時に封鎖する。
begin;

-- 未認証・app_users未登録をNULLにしない。
-- これにより `role <> 'vendor'` / `role not in (...)` が必ず拒否側へ倒れる。
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select au.role from public.app_users au where au.id = auth.uid()),
    '__unregistered__'
  );
$$;

comment on function public.current_app_role() is
  '認可判定用。未認証・app_users未登録はNULLではなく__unregistered__を返し、権限判定をfail-closedにする。';

-- boolean認可ヘルパーも、将来current_app_roleの実装が変わってもNULLを返さない。
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() in ('admin', 'internal'), false);
$$;

create or replace function public.is_center()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() in ('center', 'internal'), false);
$$;

create or replace function public.is_admin_or_center()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- 069以降、この互換名はadmin/internal専用。
  -- centerを含めると、過去のRLSがセンターへ広く再公開されるため含めない。
  select coalesce(public.current_app_role() in ('admin', 'internal'), false);
$$;

-- PostgreSQL関数は作成時にPUBLIC EXECUTEが付くため、現在存在する全関数から一括剥奪。
-- authenticatedへ過去に明示GRANTした権限は維持される。
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

-- 今後追加される関数もデフォルトでPUBLIC実行不可にする。
alter default privileges in schema public revoke execute on functions from public;

-- anonはpublic内のGAS専用RPC名を解決するためUSAGEだけ必要。
-- テーブル・シーケンスへの直接権限は与えない。
grant usage on schema public to anon;
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;

-- 匿名実行を許可するのは、共有シークレット検証済みのGAS専用2関数だけ。
grant execute on function public.sync_site_progress_from_gas(text,text,text,text,text,date,jsonb) to anon;
grant execute on function public.sync_site_master_from_gas(text,jsonb) to anon;

-- アプリ/RLSが使う認可ヘルパーはauthenticatedだけに明示許可する。
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_center() to authenticated;
grant execute on function public.is_admin_or_center() to authenticated;

-- migration自体の回帰防止。GAS専用2関数以外にanon実行権限があれば適用を失敗させる。
do $$
declare
  v_exposed text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into v_exposed
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.oid not in (
       'public.sync_site_progress_from_gas(text,text,text,text,text,date,jsonb)'::regprocedure,
       'public.sync_site_master_from_gas(text,jsonb)'::regprocedure
     );

  if v_exposed is not null then
    raise exception 'unexpected_anon_executable_functions: %', v_exposed;
  end if;
end;
$$;

commit;
notify pgrst, 'reload schema';

-- 適用後確認:
-- select public.current_app_role(); -- 未認証なら __unregistered__
-- select p.oid::regprocedure
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and has_function_privilege('anon',p.oid,'EXECUTE');
-- 期待: GAS専用2関数のみ。
