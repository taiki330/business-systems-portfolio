begin;

-- 直近1年を必ず残す。在庫数そのもの（stock_items）は削除しない。
create or replace function public.purge_old_stock_history()
returns table (history_type text, deleted_count bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz := date_trunc('day', now()) - interval '1 year';
  v_count bigint;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required' using errcode = '42501';
  end if;

  -- 直近1年の修正履歴がある返却は、元の返却も残す。
  delete from public.stock_return_corrections c
   where c.corrected_at < v_cutoff
     and exists (
       select 1 from public.stock_returns r
        where r.id = c.stock_return_id and r.created_at < v_cutoff
     );
  get diagnostics v_count = row_count;
  history_type := '返却修正履歴'; deleted_count := v_count; return next;

  delete from public.stock_returns r
   where r.created_at < v_cutoff
     and not exists (
       select 1 from public.stock_return_corrections c
        where c.stock_return_id = r.id
     );
  get diagnostics v_count = row_count;
  history_type := '返却履歴'; deleted_count := v_count; return next;

  delete from public.over_returns o
   where o.created_at < v_cutoff;
  get diagnostics v_count = row_count;
  history_type := '過入庫履歴'; deleted_count := v_count; return next;

  delete from public.stock_ledger l
   where l.created_at < v_cutoff;
  get diagnostics v_count = row_count;
  history_type := '入出庫台帳'; deleted_count := v_count; return next;
end;
$$;

revoke execute on function public.purge_old_stock_history() from public, anon;
grant execute on function public.purge_old_stock_history() to authenticated;

commit;
notify pgrst, 'reload schema';
