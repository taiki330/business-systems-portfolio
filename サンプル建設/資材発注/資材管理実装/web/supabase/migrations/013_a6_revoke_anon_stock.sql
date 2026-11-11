-- 013_a6_revoke_anon_stock.sql
-- 012 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-6-4: stock_items / stock_ledger / apply_stock_movement から
-- anon 権限を剥奪する。authenticated は維持。
-- 詳細設計: docs/13 §13-5 / §13-12 / A-6-4
--
-- 注意:
-- - 本 migration は stock_items / stock_ledger / apply_stock_movement のみ対象
-- - stock_requests / ship_stock_request は A-6-5 で扱う
-- - apply_stock_movement は security definer のため、anon EXECUTE を残すと
--   stock_items / stock_ledger の anon policy が無くても RPC 経由で書ける。
--   EXECUTE と policy/GRANT を同時に剥奪する
-- - authenticated 側の policy / GRANT / EXECUTE は維持
-- - schema usage on anon は A-6-6 まで残す
-- - rollback は本ファイル末尾コメント参照

begin;

-- ① stock_items: anon policy 削除（4 件）
drop policy if exists "stock_items_anon_select" on public.stock_items;
drop policy if exists "stock_items_anon_insert" on public.stock_items;
drop policy if exists "stock_items_anon_update" on public.stock_items;
drop policy if exists "stock_items_anon_delete" on public.stock_items;

-- ② stock_ledger: anon policy 削除（2 件・追記専用なので UPDATE/DELETE は元から無い）
drop policy if exists "stock_ledger_anon_select" on public.stock_ledger;
drop policy if exists "stock_ledger_anon_insert" on public.stock_ledger;

-- ③ anon GRANT 剥奪
revoke select, insert, update, delete on table public.stock_items from anon;
revoke select, insert on table public.stock_ledger from anon;

-- ④ apply_stock_movement の anon EXECUTE 剥奪（security definer の穴を塞ぐ）
revoke execute on function public.apply_stock_movement(uuid, text, text, numeric)
  from anon;

-- ⑤ authenticated 側は触らない（009 で設定済み）

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用前の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- 1) 対象テーブルの anon policy 件数
-- select tablename, count(*) as anon_policy_count
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('stock_items','stock_ledger')
--    and roles::text like '%anon%'
--  group by tablename
--  order by tablename;
-- -- 期待: stock_items=4, stock_ledger=2
--
-- -- 2) authenticated policy 件数（009 適用済み確認）
-- select tablename, count(*) as auth_policy_count
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('stock_items','stock_ledger')
--    and roles::text like '%authenticated%'
--  group by tablename
--  order by tablename;
-- -- 期待: stock_items=4, stock_ledger=2
--
-- -- 3) GRANT
-- select grantee, table_name, count(*) as cnt
--   from information_schema.role_table_grants
--  where table_schema='public'
--    and table_name in ('stock_items','stock_ledger')
--    and grantee in ('anon','authenticated')
--  group by grantee, table_name
--  order by table_name, grantee;
-- -- 期待:
-- --   stock_items: anon=4, authenticated=4
-- --   stock_ledger: anon=2, authenticated=2
--
-- -- 4) apply_stock_movement EXECUTE
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name='apply_stock_movement'
--    and grantee in ('anon','authenticated')
--  order by grantee;
-- -- 期待: anon / authenticated とも EXECUTE

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) anon policy が消え authenticated だけ残ること
-- select tablename,
--        count(*) filter (where roles::text like '%anon%') as anon_cnt,
--        count(*) filter (where roles::text like '%authenticated%') as auth_cnt
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('stock_items','stock_ledger')
--  group by tablename
--  order by tablename;
-- -- 期待:
-- --   stock_items   anon_cnt=0, auth_cnt=4
-- --   stock_ledger  anon_cnt=0, auth_cnt=2
--
-- -- (b) GRANT: anon が消える
-- select table_name, grantee, count(*) as cnt
--   from information_schema.role_table_grants
--  where table_schema='public'
--    and table_name in ('stock_items','stock_ledger')
--    and grantee in ('anon','authenticated')
--  group by table_name, grantee
--  order by table_name, grantee;
-- -- 期待: 各テーブル authenticated のみ（stock_items=4, stock_ledger=2）
--
-- -- (c) apply_stock_movement の anon が消える
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name='apply_stock_movement'
--    and grantee in ('anon','authenticated')
--  order by grantee;
-- -- 期待: authenticated / EXECUTE のみ
--
-- -- (d) テーブルデータ無変更
-- select 'stock_items' as t, count(*) from public.stock_items
-- union all select 'stock_ledger', count(*) from public.stock_ledger;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- grant select, insert, update, delete on table public.stock_items to anon;
-- grant select, insert on table public.stock_ledger to anon;
-- grant execute on function public.apply_stock_movement(uuid, text, text, numeric)
--   to anon;
--
-- create policy "stock_items_anon_select"
--   on public.stock_items for select to anon using (true);
-- create policy "stock_items_anon_insert"
--   on public.stock_items for insert to anon with check (true);
-- create policy "stock_items_anon_update"
--   on public.stock_items for update to anon using (true) with check (true);
-- create policy "stock_items_anon_delete"
--   on public.stock_items for delete to anon using (true);
--
-- create policy "stock_ledger_anon_select"
--   on public.stock_ledger for select to anon using (true);
-- create policy "stock_ledger_anon_insert"
--   on public.stock_ledger for insert to anon with check (true);
--
-- commit;
-- notify pgrst, 'reload schema';
--
-- -- rollback 後の確認
-- -- select tablename,
-- --        count(*) filter (where roles::text like '%anon%') as anon_cnt,
-- --        count(*) filter (where roles::text like '%authenticated%') as auth_cnt
-- --   from pg_policies
-- --  where schemaname='public'
-- --    and tablename in ('stock_items','stock_ledger')
-- --  group by tablename;
-- -- 期待: stock_items anon=4 auth=4 / stock_ledger anon=2 auth=2
--
-- -- select grantee, privilege_type
-- --   from information_schema.routine_privileges
-- --  where routine_schema='public'
-- --    and routine_name='apply_stock_movement'
-- --    and grantee in ('anon','authenticated');
-- -- 期待: anon / authenticated とも EXECUTE
