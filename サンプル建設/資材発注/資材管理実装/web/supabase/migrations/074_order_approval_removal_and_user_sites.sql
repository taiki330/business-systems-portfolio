-- 074_order_approval_removal_and_user_sites.sql
-- オーダー承認を廃止し、現場アカウントを複数現場へ紐付けられるようにする。

begin;

-- 承認は出庫判断に使わないため、今後の操作経路を閉じる。過去の承認日時は監査用に残す。
drop function if exists public.set_order_approval(uuid, boolean);

create table if not exists public.app_user_sites (
  user_id uuid not null references public.app_users(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, site_id)
);

comment on table public.app_user_sites is
  '現場アカウントと担当現場の多対多紐付け。app_users.site_id は旧データ互換の代表現場として維持する。';

insert into public.app_user_sites (user_id, site_id)
select id, site_id from public.app_users
 where role = 'vendor' and site_id is not null
on conflict do nothing;

alter table public.app_user_sites enable row level security;
grant select on public.app_user_sites to authenticated;

drop policy if exists "app_user_sites_self_or_admin_read" on public.app_user_sites;
create policy "app_user_sites_self_or_admin_read" on public.app_user_sites for select to authenticated
  using (user_id = auth.uid() or public.current_app_role() in ('admin', 'internal'));

drop policy if exists "site_product_plans_center_read" on public.site_product_plans;
create policy "site_product_plans_center_read" on public.site_product_plans for select to authenticated
  using (public.current_app_role() = 'center');

commit;

notify pgrst, 'reload schema';
