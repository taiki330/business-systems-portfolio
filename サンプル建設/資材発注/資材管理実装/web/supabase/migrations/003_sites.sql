-- 003_sites.sql
-- Supabase SQL Editor で実行（001・002 のあと）
-- 現場マスタ。customer_id は NULL 可（得意先未設定を許可）

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  code text unique,
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sites_customer_id_idx on public.sites (customer_id);

drop trigger if exists sites_set_updated_at on public.sites;
create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

-- GRANT
grant select, insert, update, delete on table public.sites to anon, authenticated;

-- RLS
alter table public.sites enable row level security;

drop policy if exists "sites_anon_select" on public.sites;
drop policy if exists "sites_anon_insert" on public.sites;
drop policy if exists "sites_anon_update" on public.sites;
drop policy if exists "sites_anon_delete" on public.sites;
drop policy if exists "sites_authenticated_select" on public.sites;
drop policy if exists "sites_authenticated_insert" on public.sites;
drop policy if exists "sites_authenticated_update" on public.sites;
drop policy if exists "sites_authenticated_delete" on public.sites;

create policy "sites_anon_select"
  on public.sites for select to anon using (true);

create policy "sites_anon_insert"
  on public.sites for insert to anon with check (true);

create policy "sites_anon_update"
  on public.sites for update to anon using (true) with check (true);

create policy "sites_anon_delete"
  on public.sites for delete to anon using (true);

create policy "sites_authenticated_select"
  on public.sites for select to authenticated using (true);

create policy "sites_authenticated_insert"
  on public.sites for insert to authenticated with check (true);

create policy "sites_authenticated_update"
  on public.sites for update to authenticated using (true) with check (true);

create policy "sites_authenticated_delete"
  on public.sites for delete to authenticated using (true);

comment on table public.sites is '現場マスタ';
comment on column public.sites.customer_id is '得意先（任意。未設定可）';
