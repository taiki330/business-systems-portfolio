-- 014_a6_revoke_anon_requests.sql
-- 013 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-6-5: stock_requests / ship_stock_request から
-- anon 権限を剥奪する。authenticated は維持。
-- 詳細設計: docs/13 §13-5 / §13-12 / A-6-5
--
-- 注意:
-- - 本 migration は stock_requests / ship_stock_request のみ対象
-- - apply_stock_movement は A-6-4 で anon EXECUTE 剥奪済み（前提）
-- - ship_stock_request は security definer のため、anon EXECUTE を残すと
--   stock_requests を RPC 経由で更新できる穴がある。policy/GRANT/EXECUTE を同時に剥奪
-- - authenticated 側の policy / GRANT / EXECUTE は維持
-- - DELETE policy/GRANT は元から無い（論理キャンセル運用）
-- - schema usage on anon は A-6-6 まで残す
-- - rollback は本ファイル末尾コメント参照
--
-- 適用前: 本ファイル末尾「適用前の確認 SQL」§8-1 で policy 名を実 DB と突合すること

begin;

-- ① stock_requests: anon policy 削除（3 件）
drop policy if exists "stock_requests_anon_select" on public.stock_requests;
drop policy if exists "stock_requests_anon_insert" on public.stock_requests;
drop policy if exists "stock_requests_anon_update" on public.stock_requests;

-- ② anon GRANT 剥奪
revoke select, insert, update on table public.stock_requests from anon;

-- ③ ship_stock_request の anon EXECUTE 剥奪（security definer の穴塞ぎ）
revoke execute on function public.ship_stock_request(uuid, text)
  from anon;

-- ④ authenticated 側は触らない（009 で設定済み）

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用前の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- 8-1) stock_requests の policy 一覧（実 DB の policy 名をここと突合）
-- select policyname, cmd, roles, qual, with_check
--   from pg_policies
--  where schemaname='public'
--    and tablename='stock_requests'
--  order by roles::text, cmd, policyname;
-- -- 期待: anon 3 件（stock_requests_anon_select/insert/update）
-- --       authenticated 3 件（stock_requests_authenticated_select/insert/update）
--
-- -- 8-2) stock_requests の GRANT
-- select grantee, privilege_type
--   from information_schema.role_table_grants
--  where table_schema='public'
--    and table_name='stock_requests'
--    and grantee in ('anon','authenticated')
--  order by grantee, privilege_type;
-- -- 期待: anon に SELECT/INSERT/UPDATE、authenticated に同様（DELETE なし）
--
-- -- 8-3) ship_stock_request のシグネチャ
-- select n.nspname as schema,
--        p.proname as name,
--        pg_get_function_identity_arguments(p.oid) as args,
--        p.prosecdef as security_definer
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname='ship_stock_request';
-- -- 期待: ship_stock_request(uuid, text), security_definer=true
--
-- -- 8-4) ship_stock_request の EXECUTE
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name='ship_stock_request'
--    and grantee in ('anon','authenticated')
--  order by grantee;
-- -- 期待: anon / authenticated とも EXECUTE
--
-- -- 8-5) apply_stock_movement の anon EXECUTE が無いこと（A-6-4 完了確認）
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name='apply_stock_movement'
--    and grantee in ('anon','authenticated')
--  order by grantee;
-- -- 期待: authenticated / EXECUTE のみ

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) anon policy が 0、authenticated は 3 件
-- select tablename,
--        count(*) filter (where roles::text like '%anon%') as anon_cnt,
--        count(*) filter (where roles::text like '%authenticated%') as auth_cnt
--   from pg_policies
--  where schemaname='public'
--    and tablename='stock_requests'
--  group by tablename;
-- -- 期待: anon_cnt=0, auth_cnt=3
--
-- -- (b) anon GRANT が消えている
-- select grantee, count(*) as cnt
--   from information_schema.role_table_grants
--  where table_schema='public'
--    and table_name='stock_requests'
--    and grantee in ('anon','authenticated')
--  group by grantee
--  order by grantee;
-- -- 期待: authenticated=3 のみ
--
-- -- (c) ship_stock_request の anon EXECUTE が消える
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name='ship_stock_request'
--    and grantee in ('anon','authenticated')
--  order by grantee;
-- -- 期待: authenticated / EXECUTE のみ
--
-- -- (d) テーブルデータは無変更
-- select count(*) as request_rows from public.stock_requests;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- grant select, insert, update on table public.stock_requests to anon;
-- grant execute on function public.ship_stock_request(uuid, text) to anon;
--
-- create policy "stock_requests_anon_select"
--   on public.stock_requests for select to anon using (true);
-- create policy "stock_requests_anon_insert"
--   on public.stock_requests for insert to anon with check (true);
-- create policy "stock_requests_anon_update"
--   on public.stock_requests for update to anon using (true) with check (true);
--
-- commit;
-- notify pgrst, 'reload schema';
--
-- -- rollback 後の確認
-- -- select policyname, cmd, roles
-- --   from pg_policies
-- --  where schemaname='public' and tablename='stock_requests'
-- --  order by roles::text, cmd, policyname;
-- -- 期待: anon 3 件 + authenticated 3 件
--
-- -- select grantee, privilege_type
-- --   from information_schema.routine_privileges
-- --  where routine_schema='public'
-- --    and routine_name='ship_stock_request'
-- --    and grantee in ('anon','authenticated');
-- -- 期待: anon / authenticated とも EXECUTE
