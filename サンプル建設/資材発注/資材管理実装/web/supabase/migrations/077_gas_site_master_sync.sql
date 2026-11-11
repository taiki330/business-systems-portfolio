-- 077_gas_site_master_sync.sql
-- GAS の「稼働現場リスト」を正として、資材管理の現場マスタを自動作成・更新する。
begin;

create table if not exists public.gas_site_sync_issues (
  site_code text primary key,
  site_name text not null,
  issue_kind text not null check (issue_kind in ('duplicate_name')),
  details jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.gas_site_sync_issues enable row level security;
revoke all on public.gas_site_sync_issues from public, anon, authenticated;
grant select on public.gas_site_sync_issues to authenticated;

drop policy if exists "gas_site_sync_issues_admin_read" on public.gas_site_sync_issues;
create policy "gas_site_sync_issues_admin_read" on public.gas_site_sync_issues
  for select to authenticated
  using (public.current_app_role() in ('admin', 'internal'));

create or replace function public.sync_site_master_from_gas(
  p_sync_secret text,
  p_sites jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected_secret text;
  v_item jsonb;
  v_code text;
  v_name text;
  v_site_id uuid;
  v_name_match_count integer;
  v_created integer := 0;
  v_matched integer := 0;
  v_updated integer := 0;
  v_conflicts integer := 0;
  v_skipped integer := 0;
begin
  select value into v_expected_secret
    from public.integration_settings
   where key = 'gas_progress_sync_secret';

  if v_expected_secret is null
     or v_expected_secret = 'CHANGE_ME_BEFORE_USE'
     or p_sync_secret is distinct from v_expected_secret then
    raise exception 'invalid_sync_secret' using errcode = '42501';
  end if;

  if p_sites is null or jsonb_typeof(p_sites) <> 'array' then
    raise exception 'invalid_sites_payload';
  end if;
  if jsonb_array_length(p_sites) > 2000 then
    raise exception 'too_many_sites';
  end if;

  for v_item in select value from jsonb_array_elements(p_sites)
  loop
    v_code := upper(trim(coalesce(v_item ->> 'code', '')));
    v_name := trim(coalesce(v_item ->> 'name', ''));

    if v_code !~ '^SITE-[0-9]+$' or v_name = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_site_id := null;
    select id into v_site_id
      from public.sites
     where upper(trim(coalesce(code, ''))) = v_code
     limit 1;

    if v_site_id is not null then
      update public.sites
         set name = v_name
       where id = v_site_id
         and name is distinct from v_name;
      if found then
        v_updated := v_updated + 1;
      else
        v_matched := v_matched + 1;
      end if;

      update public.gas_site_sync_issues
         set resolved_at = now(), last_detected_at = now()
       where site_code = v_code and resolved_at is null;
      continue;
    end if;

    select count(*)::integer into v_name_match_count
      from public.sites
     where lower(trim(name)) = lower(v_name);

    if v_name_match_count = 1 then
      select id into v_site_id
        from public.sites
       where lower(trim(name)) = lower(v_name)
       limit 1;

      -- 参照先は UUID のため、既存コードを GAS の正式コードへ置換しても関連データは維持される。
      update public.sites
         set code = v_code, name = v_name
       where id = v_site_id;
      v_updated := v_updated + 1;
      continue;
    end if;

    if v_name_match_count = 0 then
      insert into public.sites(code, name)
      values (v_code, v_name);
      v_created := v_created + 1;
      continue;
    end if;

    insert into public.gas_site_sync_issues(
      site_code, site_name, issue_kind, details, first_detected_at, last_detected_at, resolved_at
    )
    values (
      v_code, v_name, 'duplicate_name',
      jsonb_build_object('matching_site_count', v_name_match_count), now(), now(), null
    )
    on conflict (site_code) do update
      set site_name = excluded.site_name,
          issue_kind = excluded.issue_kind,
          details = excluded.details,
          last_detected_at = now(),
          resolved_at = null;
    v_conflicts := v_conflicts + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'updated', v_updated,
    'matched', v_matched,
    'conflicts', v_conflicts,
    'skipped', v_skipped
  );
end;
$$;

revoke execute on function public.sync_site_master_from_gas(text,jsonb)
  from public, authenticated;
grant execute on function public.sync_site_master_from_gas(text,jsonb) to anon;

comment on function public.sync_site_master_from_gas is
  '共有シークレットを検証し、GASのSITEコードと現場名を資材管理の現場マスタへ同期する。';

commit;
notify pgrst, 'reload schema';
