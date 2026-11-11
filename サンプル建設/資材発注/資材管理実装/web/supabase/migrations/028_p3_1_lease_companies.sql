-- 028_p3_1_lease_companies.sql
-- 027 適用後に Supabase SQL Editor で実行
-- Phase 3-1: リース会社管理（vendors とは独立した新規マスタ）
--
-- 方針:
--   - lease_companies は vendors とは無関係の新規テーブル。vendors / vendor_sites は一切変更しない
--   - リース会社用ログインは作らない（auth.users / app_users との紐付け列は持たない）
--   - 契約・請求・金額・借用・返却・期限管理は今回のスコープ外。列は name / note のみ
--   - 書込=admin(is_admin) / 参照=admin+center(is_admin_or_center) / vendor は一切不可
--     （026/027 のヘルパー関数のみを参照し、role 文字列は policy 内に直接書かない）
--   - vendors の 010/023 と同じ命名規則（id/created_at/updated_at, set_updated_at トリガー,
--     name 索引, unique 制約なし）に揃える
--
-- 冪等性:
--   - 新規に作成する policy はすべて、create の直前に drop policy if exists を入れている。
--     途中で失敗した場合や、既に一度適用済みの状態で再実行しても安全に完走する。

begin;

-- ===========================================================================
-- 1) lease_companies（リース会社マスタ）
-- ===========================================================================
create table if not exists public.lease_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lease_companies is
  'リース会社マスタ。Phase 3-1。vendors（二次業者マスタ）とは無関係の独立テーブル。契約・請求・金額・借用・返却・期限管理は対象外';
comment on column public.lease_companies.name is 'リース会社名（unique 制約は付けない・vendors と同方針）';
comment on column public.lease_companies.note is '備考（自由記述・任意）';

create index if not exists lease_companies_name_idx
  on public.lease_companies (name);

drop trigger if exists lease_companies_set_updated_at on public.lease_companies;
create trigger lease_companies_set_updated_at
  before update on public.lease_companies
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2) GRANT（authenticated のみ。anon には一切触れない）
-- ===========================================================================
grant select, insert, update, delete on table public.lease_companies to authenticated;

-- ===========================================================================
-- 3) RLS: 参照=admin+center / 書込(INSERT/UPDATE/DELETE)=admin のみ / vendor は一切不可
-- ===========================================================================
alter table public.lease_companies enable row level security;

drop policy if exists "lease_companies_read" on public.lease_companies;
drop policy if exists "lease_companies_admin_insert" on public.lease_companies;
drop policy if exists "lease_companies_admin_update" on public.lease_companies;
drop policy if exists "lease_companies_admin_delete" on public.lease_companies;

create policy "lease_companies_read"
  on public.lease_companies for select to authenticated
  using (public.is_admin_or_center());

create policy "lease_companies_admin_insert"
  on public.lease_companies for insert to authenticated
  with check (public.is_admin());

create policy "lease_companies_admin_update"
  on public.lease_companies for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "lease_companies_admin_delete"
  on public.lease_companies for delete to authenticated
  using (public.is_admin());

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) テーブル・列の存在確認
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name='lease_companies'
--  order by ordinal_position;
--
-- -- (b) policy 一覧（select×1 + admin×3 の計4件）
-- select tablename, policyname, cmd, roles
--   from pg_policies
--  where schemaname='public' and tablename='lease_companies'
--  order by cmd, policyname;
--
-- -- (c) GRANT 確認（anon には何も付与されていないこと）
-- select table_name, grantee, privilege_type
--   from information_schema.table_privileges
--  where table_schema='public' and table_name='lease_companies'
--  order by grantee, privilege_type;
--
-- -- (d) vendors / vendor_sites が無変更であること（念のため）
-- select tablename, policyname, cmd from pg_policies
--  where schemaname='public' and tablename in ('vendors','vendor_sites')
--  order by tablename, cmd;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- drop policy if exists "lease_companies_read" on public.lease_companies;
-- drop policy if exists "lease_companies_admin_insert" on public.lease_companies;
-- drop policy if exists "lease_companies_admin_update" on public.lease_companies;
-- drop policy if exists "lease_companies_admin_delete" on public.lease_companies;
--
-- drop trigger if exists lease_companies_set_updated_at on public.lease_companies;
-- drop table if exists public.lease_companies;
--
-- commit;
-- notify pgrst, 'reload schema';
