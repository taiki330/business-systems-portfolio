-- 011_a6_revoke_anon_audit_logs.sql
-- 010 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-6-2: audit_logs から anon 権限を剥奪する（authenticated は維持）
-- 詳細設計: docs/13 §13-5 / §13-12
--
-- 注意:
-- - 本 migration は audit_logs のみ対象。他テーブル・RPC には触れない
-- - authenticated の SELECT/INSERT は維持する（recordAudit はログイン済みで動く）
-- - UPDATE/DELETE は GRANT も policy も作らない（追記専用方針を維持）
-- - rollback は本ファイル末尾コメントの SQL を SQL Editor で実行する
-- - REQUIRE_AUTH の状態とは独立に適用可（OFF のままでも問題なし）
-- - 多層防御方針: middleware が外れても anon は DB に到達できない状態を作る

begin;

-- ① anon policy 削除
drop policy if exists "audit_logs_anon_select" on public.audit_logs;
drop policy if exists "audit_logs_anon_insert" on public.audit_logs;

-- ② anon GRANT 剥奪
revoke select, insert on table public.audit_logs from anon;

-- ③ authenticated policy / GRANT の存在保証（既存どおりで OK）
--   009 で作成済みのため再作成は行わない。drop は絶対にしない。

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用前の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- 1) authenticated policy が確かに存在すること（009 適用済み確認）
-- select policyname, cmd
--   from pg_policies
--  where schemaname='public'
--    and tablename='audit_logs'
--    and roles::text like '%authenticated%'
--  order by policyname;
-- -- 期待: audit_logs_authenticated_select / SELECT
-- --       audit_logs_authenticated_insert / INSERT
--
-- -- 2) anon policy がまだ残っていること（A-6-2 適用前）
-- select count(*) as anon_policy_count
--   from pg_policies
--  where schemaname='public'
--    and tablename='audit_logs'
--    and roles::text like '%anon%';
-- -- 期待: 2
--
-- -- 3) authenticated GRANT が存在すること
-- select privilege_type from information_schema.role_table_grants
--  where table_schema='public' and table_name='audit_logs'
--    and grantee='authenticated'
--  order by privilege_type;
-- -- 期待: INSERT, SELECT
--
-- -- 4) UPDATE/DELETE policy がないこと（誤って増えていないか）
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='audit_logs'
--    and cmd in ('UPDATE','DELETE');
-- -- 期待: 0 行

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) policy: anon が消え authenticated だけ残ること
-- select policyname, cmd, roles
--   from pg_policies
--  where schemaname='public' and tablename='audit_logs'
--  order by policyname;
-- -- 期待:
-- --   audit_logs_authenticated_select / SELECT / {authenticated}
-- --   audit_logs_authenticated_insert / INSERT / {authenticated}
--
-- -- (b) anon / authenticated の policy 件数
-- select count(*) filter (where roles::text like '%anon%') as anon_cnt,
--        count(*) filter (where roles::text like '%authenticated%') as auth_cnt
--   from pg_policies
--  where schemaname='public' and tablename='audit_logs';
-- -- 期待: anon_cnt=0, auth_cnt=2
--
-- -- (c) GRANT: anon が消え authenticated だけ残ること
-- select grantee, privilege_type
--   from information_schema.role_table_grants
--  where table_schema='public' and table_name='audit_logs'
--    and grantee in ('anon','authenticated')
--  order by grantee, privilege_type;
-- -- 期待: authenticated の SELECT/INSERT のみ
--
-- -- (d) 件数が変わっていないこと（テーブルデータは無変更）
-- select count(*) as audit_rows from public.audit_logs;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
-- grant select, insert on table public.audit_logs to anon;
-- create policy "audit_logs_anon_select"
--   on public.audit_logs for select to anon using (true);
-- create policy "audit_logs_anon_insert"
--   on public.audit_logs for insert to anon with check (true);
-- commit;
-- notify pgrst, 'reload schema';
--
-- -- rollback 後の確認
-- -- select policyname, cmd, roles
-- --   from pg_policies
-- --  where schemaname='public' and tablename='audit_logs'
-- --  order by policyname;
-- -- 期待: anon_select / anon_insert / authenticated_select / authenticated_insert の 4 行
