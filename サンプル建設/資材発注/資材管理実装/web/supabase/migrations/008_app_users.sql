-- 008_app_users.sql
-- 007 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-1: 認証ユーザーのロール保持（最小）
-- 詳細設計: docs/13 §1 / §4
--
-- 注意:
-- - vendors / vendor_sites は A-4 で追加するため、本 migration では作らない
-- - vendor_id 列は A-1 から用意するが、FK 制約は A-4 で後付けする
-- - A-1 では INSERT / UPDATE / DELETE は SQL Editor または service_role 運用に限定
--   （authenticated には SELECT のみ許可）

-- ① テーブル
create table if not exists public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('internal', 'vendor')),
  display_name text,
  vendor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_users is
  '認証ユーザーのロール保持。auth.users と 1:1。docs/13 §1';
comment on column public.app_users.id is
  'auth.users(id) と一致。cascade で削除連動';
comment on column public.app_users.role is
  'internal=サンプル建設社員 / vendor=二次業者（docs/13 §1）';
comment on column public.app_users.display_name is
  '画面表示用の名前。本人による更新は MVP では不要（service_role 運用）';
comment on column public.app_users.vendor_id is
  'role=vendor のとき将来 vendors.id を参照。A-1 では NULL 運用、FK 制約は A-4 で追加';

-- ② 索引
create index if not exists app_users_role_idx
  on public.app_users (role);
create index if not exists app_users_vendor_id_idx
  on public.app_users (vendor_id);

-- ③ updated_at（既存 set_updated_at を再利用）
drop trigger if exists app_users_set_updated_at on public.app_users;
create trigger app_users_set_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

-- ④ GRANT（authenticated は SELECT のみ）
--   INSERT / UPDATE / DELETE は service_role / SQL Editor 経由で管理者が行う運用。
--   anon にはアクセス権を与えない（認証専用テーブル）。
grant select on table public.app_users to authenticated;

-- ⑤ RLS
alter table public.app_users enable row level security;

drop policy if exists "app_users_self_select" on public.app_users;

-- 自分の行だけ参照可能（最小権限）
-- ロール判定は Server Action / RSC 側で行うため、ここでは自身の行のみ開ければ十分
create policy "app_users_self_select"
  on public.app_users for select to authenticated
  using (auth.uid() = id);

-- INSERT / UPDATE / DELETE のポリシーは敢えて作らない（封じる）
-- 必要が出た場合は別 migration で追加する

-- ---------------------------------------------------------------------------
-- 実行後の確認（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select to_regclass('public.app_users') as app_users_table;
--
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema='public' and table_name='app_users'
--  order by ordinal_position;
--
-- select conname, contype, pg_get_constraintdef(c.oid)
--   from pg_constraint c join pg_class t on t.oid = c.conrelid
--  where t.relname='app_users';
--
-- select policyname, cmd, roles, qual
--   from pg_policies where schemaname='public' and tablename='app_users';
--
-- select grantee, privilege_type
--   from information_schema.role_table_grants
--  where table_schema='public' and table_name='app_users'
--  order by grantee, privilege_type;
--
-- notify pgrst, 'reload schema';
--
-- ---------------------------------------------------------------------------
-- 内部ユーザー登録例（Supabase Studio で Invite user → メール確認 → パスワード設定後）
-- ---------------------------------------------------------------------------
-- insert into public.app_users (id, role, display_name)
-- select id, 'internal', 'テスト管理者'
--   from auth.users where email = 'admin@example.com';
