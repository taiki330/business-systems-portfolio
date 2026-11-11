begin;

create table if not exists public.stock_history_archive_runs (
  id uuid primary key default gen_random_uuid(),
  cutoff_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null,
  ledger_exported_at timestamptz,
  returns_exported_at timestamptz,
  over_returns_exported_at timestamptz,
  purged_at timestamptz,
  purged_by uuid references public.app_users(id) on delete set null,
  constraint stock_history_archive_run_export_before_purge check (
    purged_at is null or (ledger_exported_at is not null and returns_exported_at is not null and over_returns_exported_at is not null)
  )
);

alter table public.stock_history_archive_runs enable row level security;
revoke all on public.stock_history_archive_runs from public, anon, authenticated;

create or replace function public.start_stock_history_archive()
returns table (run_id uuid, cutoff_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_cutoff timestamptz := date_trunc('day', now()) - interval '1 year';
begin
  if not public.is_admin() then raise exception 'permission_denied: admin role required' using errcode='42501'; end if;
  insert into public.stock_history_archive_runs(cutoff_at, created_by)
  values (v_cutoff, public.current_actor_id()) returning id into v_id;
  run_id := v_id; cutoff_at := v_cutoff; return next;
end;
$$;

create or replace function public.mark_stock_history_archive_export(p_run_id uuid, p_part text)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_cutoff timestamptz;
begin
  if not public.is_admin() then raise exception 'permission_denied: admin role required' using errcode='42501'; end if;
  if p_part not in ('ledger', 'returns', 'over_returns') then raise exception 'invalid_archive_part'; end if;
  select cutoff_at into v_cutoff from public.stock_history_archive_runs where id=p_run_id and purged_at is null for update;
  if v_cutoff is null then raise exception 'archive_run_not_found_or_finished'; end if;
  update public.stock_history_archive_runs set
    ledger_exported_at = case when p_part='ledger' then coalesce(ledger_exported_at, now()) else ledger_exported_at end,
    returns_exported_at = case when p_part='returns' then coalesce(returns_exported_at, now()) else returns_exported_at end,
    over_returns_exported_at = case when p_part='over_returns' then coalesce(over_returns_exported_at, now()) else over_returns_exported_at end
  where id=p_run_id;
  return v_cutoff;
end;
$$;

create or replace function public.get_stock_history_archive_cutoff(p_run_id uuid)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_cutoff timestamptz;
begin
  if not public.is_admin() then raise exception 'permission_denied: admin role required' using errcode='42501'; end if;
  select cutoff_at into v_cutoff from public.stock_history_archive_runs where id=p_run_id and purged_at is null;
  if v_cutoff is null then raise exception 'archive_run_not_found_or_finished'; end if;
  return v_cutoff;
end;
$$;

create or replace function public.purge_old_stock_history(p_run_id uuid)
returns table (history_type text, deleted_count bigint)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_run public.stock_history_archive_runs%rowtype; v_count bigint;
begin
  if not public.is_admin() then raise exception 'permission_denied: admin role required' using errcode='42501'; end if;
  select * into v_run from public.stock_history_archive_runs where id=p_run_id for update;
  if not found or v_run.purged_at is not null then raise exception 'archive_run_not_found_or_finished'; end if;
  if v_run.ledger_exported_at is null or v_run.returns_exported_at is null or v_run.over_returns_exported_at is null then raise exception 'archive_exports_incomplete'; end if;

  delete from public.stock_return_corrections c
   where c.corrected_at < v_run.cutoff_at
     and exists (select 1 from public.stock_returns r where r.id=c.stock_return_id and r.created_at < v_run.cutoff_at)
     and not exists (select 1 from public.stock_return_corrections newer where newer.stock_return_id=c.stock_return_id and newer.corrected_at >= v_run.cutoff_at);
  get diagnostics v_count = row_count; history_type := '返却修正履歴'; deleted_count := v_count; return next;

  delete from public.stock_returns r
   where r.created_at < v_run.cutoff_at
     and not exists (select 1 from public.stock_return_corrections c where c.stock_return_id=r.id);
  get diagnostics v_count = row_count; history_type := '返却履歴'; deleted_count := v_count; return next;

  delete from public.over_returns o where o.created_at < v_run.cutoff_at and o.status='confirmed';
  get diagnostics v_count = row_count; history_type := '確認済み過入庫'; deleted_count := v_count; return next;

  delete from public.stock_ledger l
   where l.created_at < v_run.cutoff_at
     and not exists (select 1 from public.stock_returns r where r.site_ledger_id=l.id or r.center_ledger_id=l.id);
  get diagnostics v_count = row_count; history_type := '入出庫台帳'; deleted_count := v_count; return next;

  update public.stock_history_archive_runs set purged_at=now(), purged_by=public.current_actor_id() where id=v_run.id;
end;
$$;

revoke execute on function public.start_stock_history_archive() from public, anon;
revoke execute on function public.mark_stock_history_archive_export(uuid, text) from public, anon;
revoke execute on function public.get_stock_history_archive_cutoff(uuid) from public, anon;
revoke execute on function public.purge_old_stock_history(uuid) from public, anon;
grant execute on function public.start_stock_history_archive() to authenticated;
grant execute on function public.mark_stock_history_archive_export(uuid, text) to authenticated;
grant execute on function public.get_stock_history_archive_cutoff(uuid) to authenticated;
grant execute on function public.purge_old_stock_history(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
