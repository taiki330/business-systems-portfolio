-- 068_site_account_issuance.sql
-- 067 適用後に Supabase SQL Editor で実行
-- 事務によるアカウント発行を「1現場＝1アカウント」に統一する。

begin;

-- 既存データに重複がある場合は、どちらを残すか人が判断してから再実行する。
do $$
begin
  if exists (
    select 1
      from public.app_users
     where role = 'vendor' and site_id is not null
     group by site_id
    having count(*) > 1
  ) then
    raise exception 'duplicate_site_accounts_exist: resolve duplicate vendor site_id values before applying 068';
  end if;
end;
$$;

-- 現行の vendor ロールは画面上の「現場」権限。1現場に複数アカウントを持たせない。
create unique index if not exists app_users_one_vendor_per_site_idx
  on public.app_users (site_id)
  where role = 'vendor' and site_id is not null;

-- 既存の未紐付けアカウントは残しつつ、以降の追加・更新では現場を必須にする。
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'app_users_vendor_site_required'
       and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_vendor_site_required
      check (role <> 'vendor' or site_id is not null) not valid;
  end if;
end;
$$;

-- 業者IDを引数から外し、現場名を表示名の既定値としてDB側でも保証する。
drop function if exists public.update_app_user_by_internal(uuid, text, text, uuid, uuid);
drop function if exists public.update_app_user_by_internal(uuid, text, text, uuid);

create function public.update_app_user_by_internal(
  p_id           uuid,
  p_display_name text,
  p_role         text,
  p_site_id      uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site_name text;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_role not in ('admin', 'center', 'vendor') then
    raise exception 'invalid_role';
  end if;

  if p_role = 'vendor' then
    if p_site_id is null then
      raise exception 'site_required';
    end if;

    select name into v_site_name
      from public.sites
     where id = p_site_id;

    if not found then
      raise exception 'site_not_found';
    end if;

    if exists (
      select 1
        from public.app_users
       where role = 'vendor'
         and site_id = p_site_id
         and id <> p_id
    ) then
      raise exception 'site_already_has_account';
    end if;
  end if;

  update public.app_users
     set display_name = case
           when p_role = 'vendor'
             then coalesce(nullif(btrim(p_display_name), ''), v_site_name)
           else nullif(btrim(p_display_name), '')
         end,
         role      = p_role,
         vendor_id = null,
         site_id   = case when p_role = 'vendor' then p_site_id else null end
   where id = p_id;

  if not found then
    raise exception 'app_user_not_found';
  end if;
end;
$$;

revoke execute on function public.update_app_user_by_internal(uuid, text, text, uuid) from public;
revoke execute on function public.update_app_user_by_internal(uuid, text, text, uuid) from anon;
grant  execute on function public.update_app_user_by_internal(uuid, text, text, uuid) to authenticated;

comment on function public.update_app_user_by_internal(uuid, text, text, uuid) is
  '事務によるアカウント更新。現場権限は1現場1アカウント、業者紐付けなし、表示名未指定時は現場名。';

commit;

notify pgrst, 'reload schema';
