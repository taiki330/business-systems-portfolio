begin;

alter table public.stock_history_archive_runs
  add column if not exists ledger_total_pages integer,
  add column if not exists returns_total_pages integer,
  add column if not exists over_returns_total_pages integer,
  add column if not exists ledger_exported_pages jsonb not null default '[]'::jsonb,
  add column if not exists returns_exported_pages jsonb not null default '[]'::jsonb,
  add column if not exists over_returns_exported_pages jsonb not null default '[]'::jsonb;

create or replace function public.mark_stock_history_archive_export(p_run_id uuid, p_part text, p_page integer, p_total_pages integer)
returns timestamptz language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cutoff timestamptz; v_pages jsonb; v_total integer;
begin
  if not public.is_admin() then raise exception 'permission_denied: admin role required' using errcode='42501'; end if;
  if p_part not in ('ledger','returns','over_returns') or p_page < 1 or p_total_pages < p_page then raise exception 'invalid_archive_page'; end if;
  select cutoff_at,
    case p_part when 'ledger' then ledger_exported_pages when 'returns' then returns_exported_pages else over_returns_exported_pages end,
    case p_part when 'ledger' then ledger_total_pages when 'returns' then returns_total_pages else over_returns_total_pages end
  into v_cutoff,v_pages,v_total from public.stock_history_archive_runs where id=p_run_id and purged_at is null for update;
  if v_cutoff is null or (v_total is not null and v_total <> p_total_pages) then raise exception 'archive_run_not_found_or_invalid'; end if;
  if not (v_pages @> jsonb_build_array(p_page)) then v_pages := v_pages || jsonb_build_array(p_page); end if;
  update public.stock_history_archive_runs set
    ledger_total_pages=case when p_part='ledger' then p_total_pages else ledger_total_pages end,
    returns_total_pages=case when p_part='returns' then p_total_pages else returns_total_pages end,
    over_returns_total_pages=case when p_part='over_returns' then p_total_pages else over_returns_total_pages end,
    ledger_exported_pages=case when p_part='ledger' then v_pages else ledger_exported_pages end,
    returns_exported_pages=case when p_part='returns' then v_pages else returns_exported_pages end,
    over_returns_exported_pages=case when p_part='over_returns' then v_pages else over_returns_exported_pages end,
    ledger_exported_at=case when p_part='ledger' then now() else ledger_exported_at end,
    returns_exported_at=case when p_part='returns' then now() else returns_exported_at end,
    over_returns_exported_at=case when p_part='over_returns' then now() else over_returns_exported_at end
  where id=p_run_id;
  return v_cutoff;
end; $$;

create or replace function public.purge_old_stock_history(p_run_id uuid)
returns table (history_type text, deleted_count bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.stock_history_archive_runs%rowtype; v_count bigint;
begin
  if not public.is_admin() then raise exception 'permission_denied: admin role required' using errcode='42501'; end if;
  select * into v_run from public.stock_history_archive_runs where id=p_run_id for update;
  if not found or v_run.purged_at is not null then raise exception 'archive_run_not_found_or_finished'; end if;
  if v_run.ledger_total_pages is null or v_run.returns_total_pages is null or v_run.over_returns_total_pages is null
     or jsonb_array_length(v_run.ledger_exported_pages) <> v_run.ledger_total_pages
     or jsonb_array_length(v_run.returns_exported_pages) <> v_run.returns_total_pages
     or jsonb_array_length(v_run.over_returns_exported_pages) <> v_run.over_returns_total_pages then raise exception 'archive_exports_incomplete'; end if;
  delete from public.stock_return_corrections c where c.corrected_at<v_run.cutoff_at and exists(select 1 from public.stock_returns r where r.id=c.stock_return_id and r.created_at<v_run.cutoff_at) and not exists(select 1 from public.stock_return_corrections n where n.stock_return_id=c.stock_return_id and n.corrected_at>=v_run.cutoff_at); get diagnostics v_count=row_count; history_type:='返却修正履歴'; deleted_count:=v_count; return next;
  delete from public.stock_returns r where r.created_at<v_run.cutoff_at and not exists(select 1 from public.stock_return_corrections c where c.stock_return_id=r.id); get diagnostics v_count=row_count; history_type:='返却履歴'; deleted_count:=v_count; return next;
  delete from public.over_returns o where o.created_at<v_run.cutoff_at and o.status='confirmed'; get diagnostics v_count=row_count; history_type:='確認済み過入庫'; deleted_count:=v_count; return next;
  delete from public.stock_ledger l where l.created_at<v_run.cutoff_at and not exists(select 1 from public.stock_returns r where r.site_ledger_id=l.id or r.center_ledger_id=l.id); get diagnostics v_count=row_count; history_type:='入出庫台帳'; deleted_count:=v_count; return next;
  update public.stock_history_archive_runs set purged_at=now(),purged_by=public.current_actor_id() where id=v_run.id;
end; $$;

revoke execute on function public.mark_stock_history_archive_export(uuid,text,integer,integer) from public,anon;
grant execute on function public.mark_stock_history_archive_export(uuid,text,integer,integer) to authenticated;
commit;
notify pgrst,'reload schema';
