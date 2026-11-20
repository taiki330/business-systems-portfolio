-- SQL Editor で実行: public スキーマの各テーブルで RLS が有効か、ポリシーが何件あるかを表示する（読み取りのみ）。
-- rls_enabled = true かつ policies = 0 のテーブルは、anon キーのアプリからは読み書きできない（空に見える）。
SELECT c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relrowsecurity DESC, c.relname;
