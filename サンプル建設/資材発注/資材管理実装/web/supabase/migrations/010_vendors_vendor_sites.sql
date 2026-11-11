-- 010_vendors_vendor_sites.sql
-- 009 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-4: vendor ロールと vendor_sites の概念導入（制限なし）
-- 詳細設計: docs/13 §4
--
-- 注意:
-- - 本 migration では RLS 制限・現場絞り込み・/vendor/stock は行わない（A-5 / A-7）
-- - vendors / vendor_sites は authenticated SELECT のみ（using true）
-- - anon には GRANT しない（認証専用テーブル）
-- - 業者・紐付けの INSERT/UPDATE/DELETE は SQL Editor または service_role 運用
-- - app_users.vendor_id に FK を後付け（on delete set null）

begin;

-- ---------------------------------------------------------------------------
-- 1) vendors（二次業者マスタ）
-- ---------------------------------------------------------------------------
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vendors is
  '二次業者マスタ。docs/13 §4-2（customers=得意先とは別概念）';
comment on column public.vendors.name is '業者名（unique 制約は付けない・Q-A=A）';
comment on column public.vendors.note is '補助メモ';

create index if not exists vendors_name_idx
  on public.vendors (name);

drop trigger if exists vendors_set_updated_at on public.vendors;
create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) vendor_sites（業者×現場の多対多）
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_sites (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (vendor_id, site_id)
);

comment on table public.vendor_sites is
  '業者と現場の多対多紐付け。A-7 で RLS 絞り込みに使用。docs/13 §4-2';
comment on column public.vendor_sites.vendor_id is 'FK→vendors。業者削除時は cascade で紐付けも削除';
comment on column public.vendor_sites.site_id is 'FK→sites。現場削除時は cascade で紐付けも削除';

create index if not exists vendor_sites_site_id_idx
  on public.vendor_sites (site_id);

-- ---------------------------------------------------------------------------
-- 3) app_users.vendor_id に FK を後付け（008 で列のみ作成済み）
-- ---------------------------------------------------------------------------
alter table public.app_users
  drop constraint if exists app_users_vendor_id_fkey;

alter table public.app_users
  add constraint app_users_vendor_id_fkey
  foreign key (vendor_id) references public.vendors (id) on delete set null;

comment on column public.app_users.vendor_id is
  'role=vendor のとき vendors.id を参照。業者削除時は SET NULL（Q-C=A）';

-- ---------------------------------------------------------------------------
-- 4) GRANT（authenticated は SELECT のみ。anon なし）
-- ---------------------------------------------------------------------------
grant select on table public.vendors to authenticated;
grant select on table public.vendor_sites to authenticated;

-- ---------------------------------------------------------------------------
-- 5) RLS（制限なし・using true。A-7 で絞り込み予定）
-- ---------------------------------------------------------------------------
alter table public.vendors enable row level security;
alter table public.vendor_sites enable row level security;

drop policy if exists "vendors_authenticated_select" on public.vendors;
drop policy if exists "vendor_sites_authenticated_select" on public.vendor_sites;

create policy "vendors_authenticated_select"
  on public.vendors for select to authenticated using (true);

create policy "vendor_sites_authenticated_select"
  on public.vendor_sites for select to authenticated using (true);

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 実行後の確認（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select to_regclass('public.vendors') as vendors_table,
--        to_regclass('public.vendor_sites') as vendor_sites_table;
--
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name='vendors'
--  order by ordinal_position;
--
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name='vendor_sites'
--  order by ordinal_position;
--
-- select conname, conrelid::regclass as on_table, pg_get_constraintdef(c.oid)
--   from pg_constraint c
--  where conname in (
--    'vendor_sites_vendor_id_fkey',
--    'vendor_sites_site_id_fkey',
--    'app_users_vendor_id_fkey'
--  );
--
-- select tablename, policyname, cmd, roles
--   from pg_policies
--  where schemaname='public' and tablename in ('vendors','vendor_sites');
--
-- select grantee, privilege_type
--   from information_schema.role_table_grants
--  where table_schema='public' and table_name in ('vendors','vendor_sites')
--  order by table_name, grantee;
--
-- ---------------------------------------------------------------------------
-- テストデータ投入例（動作確認用・Q-G=A）
-- ---------------------------------------------------------------------------
-- insert into public.vendors (name, note) values ('テスト業者', '動作確認用');
--
-- insert into public.vendor_sites (vendor_id, site_id)
-- select v.id, s.id
--   from public.vendors v, public.sites s
--  where v.name = 'テスト業者'
--    and s.name = 'kickoff-meeting';  -- 適宜変更
--
-- insert into public.app_users (id, role, display_name, vendor_id)
-- select au.id, 'vendor', 'テスト業者ユーザー', v.id
--   from auth.users au, public.vendors v
--  where au.email = 'vendor1@example.com'
--    and v.name = 'テスト業者';
