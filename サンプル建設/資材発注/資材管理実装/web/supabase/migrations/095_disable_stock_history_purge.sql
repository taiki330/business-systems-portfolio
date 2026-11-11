begin;

-- 094 の削除条件に安全性の問題が見つかったため、データ削除を明示的に停止する。
-- この関数は将来の安全なアーカイブ処理へ置き換えるまで、いかなる履歴も削除しない。
create or replace function public.purge_old_stock_history()
returns table (history_type text, deleted_count bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'history_archive_purge_disabled: CSV出力と削除対象の照合を修正するまで履歴削除は停止中です';
end;
$$;

revoke execute on function public.purge_old_stock_history() from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
