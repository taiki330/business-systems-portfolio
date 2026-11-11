-- 015_a6_finalize_anon_revoke.sql
-- 014 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-6-6: anon 残作業の最終整理（schema usage / table ACL / sequence / function）
-- 詳細設計: docs/13 §13-5 / §13-12 / A-6-6
--
-- 適用前の実 DB 確認結果（2026-06-01）:
--   - schema public: anon usage = true（剥奪対象）
--   - anon policy: 0 件
--   - anon routine EXECUTE: 0 件
--   - anon table privilege: SELECT/INSERT/UPDATE/DELETE は 0 件、
--     ただし REFERENCES / TRIGGER / TRUNCATE が残存（剥奪対象）
--
-- 注意:
-- - authenticated 側の権限・policy には一切触れない
-- - 011〜014 で剥奪済みの CRUD はそのまま（ALL revoke でも実害なし・冪等）
-- - sequence は uuid 採用のため public 内には基本存在しないが、保険として一括 revoke
-- - function は A-6-4 / A-6-5 で個別剥奪済みだが、保険として一括 revoke
-- - rollback は本ファイル末尾コメント参照。schema usage 復元のみで実用上は足りる
--   （REFERENCES/TRIGGER/TRUNCATE は復元しなくても業務に影響しない）

begin;

-- ① schema public の anon usage 剥奪（authenticated は維持）
revoke usage on schema public from anon;

-- ② テーブル ACL の anon 残骸（REFERENCES / TRIGGER / TRUNCATE）を一括剥奪
--    CRUD は既に 011〜014 で剥奪済み・冪等
revoke all privileges on all tables in schema public from anon;

-- ③ sequence への anon 権限を保険として剥奪（現状 public 内に sequence は無い想定）
revoke all privileges on all sequences in schema public from anon;

-- ④ 関数への anon EXECUTE を保険として剥奪（A-6-4 / A-6-5 で個別剥奪済み）
revoke all privileges on all functions in schema public from anon;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用前の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- 1) schema usage（anon / authenticated）
-- select n.nspname as schema,
--        r.rolname as role,
--        has_schema_privilege(r.oid, n.oid, 'USAGE')  as has_usage,
--        has_schema_privilege(r.oid, n.oid, 'CREATE') as has_create
--   from pg_namespace n
--   cross join pg_roles r
--  where n.nspname='public'
--    and r.rolname in ('anon','authenticated')
--  order by r.rolname;
-- -- 期待: anon=usage:true / authenticated=usage:true
--
-- -- 2) anon に残っているテーブル ACL を一覧
-- select table_name, privilege_type
--   from information_schema.role_table_grants
--  where table_schema='public'
--    and grantee='anon'
--  order by table_name, privilege_type;
-- -- 期待: REFERENCES / TRIGGER / TRUNCATE が複数テーブルで残存
--
-- -- 3) anon routine EXECUTE
-- select routine_name, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and grantee='anon';
-- -- 期待: 0 行
--
-- -- 4) anon policy
-- select tablename, policyname
--   from pg_policies
--  where schemaname='public'
--    and roles::text like '%anon%';
-- -- 期待: 0 行

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) schema usage の anon が false になったこと
-- select r.rolname,
--        has_schema_privilege(r.oid, n.oid, 'USAGE') as has_usage
--   from pg_namespace n
--   cross join pg_roles r
--  where n.nspname='public'
--    and r.rolname in ('anon','authenticated');
-- -- 期待: anon=false / authenticated=true
--
-- -- (b) anon テーブル ACL が 0 件
-- select table_name, privilege_type
--   from information_schema.role_table_grants
--  where table_schema='public'
--    and grantee='anon';
-- -- 期待: 0 行
--
-- -- (c) anon routine EXECUTE が 0 件
-- select routine_name, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and grantee='anon';
-- -- 期待: 0 行
--
-- -- (d) authenticated は無傷
-- select count(*) as auth_table_grants
--   from information_schema.role_table_grants
--  where table_schema='public'
--    and grantee='authenticated';
-- -- 期待: 適用前と同じ値（変化なし）
--
-- -- (e) policy は anon 0 件・authenticated は無変化
-- select roles, count(*)
--   from pg_policies
--  where schemaname='public'
--  group by roles
--  order by roles::text;
-- -- 期待: {authenticated} のみ（anon は 0 件のまま）

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（A-6-6 を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- -- schema usage を復元（最重要・これだけで未ログイン経路の調査用途には足りる）
-- grant usage on schema public to anon;
--
-- -- ※ REFERENCES / TRIGGER / TRUNCATE は復元不要（業務に影響しない）。
-- --    どうしても元の状態を完全復元したい場合のみ次行を実行:
-- -- grant references, trigger, truncate on all tables in schema public to anon;
--
-- -- ※ 011〜014 を本格的に切り戻す場合は、各 migration の rollback SQL を逆順実行
--
-- commit;
-- notify pgrst, 'reload schema';
--
-- -- rollback 後の確認
-- -- select r.rolname,
-- --        has_schema_privilege(r.oid, n.oid, 'USAGE') as has_usage
-- --   from pg_namespace n cross join pg_roles r
-- --  where n.nspname='public' and r.rolname in ('anon','authenticated');
-- -- 期待: anon=true / authenticated=true
