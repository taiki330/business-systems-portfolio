-- 078_gas_sync_schema_usage.sql
-- 015 で anon から剥奪した public schema の USAGE を、GAS用RPC呼び出しのために復元する。
-- テーブル権限や他の関数の実行権限は復元しない。
begin;

grant usage on schema public to anon;

revoke execute on function public.sync_site_progress_from_gas(text,text,text,text,text,date,jsonb)
  from public, authenticated;
grant execute on function public.sync_site_progress_from_gas(text,text,text,text,text,date,jsonb)
  to anon;

revoke execute on function public.sync_site_master_from_gas(text,jsonb)
  from public, authenticated;
grant execute on function public.sync_site_master_from_gas(text,jsonb)
  to anon;

commit;
notify pgrst, 'reload schema';
