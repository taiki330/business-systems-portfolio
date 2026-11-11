-- 054_p8_vendor_site_binding.sql
-- 053 適用後に Supabase SQL Editor で実行
-- P1-E Phase E-1: 1アカウント＝1現場に統一する（docs/20 D-20260801-14）
--
-- 背景:
--   - vendor は現場ごとにアカウントを発行する運用にする。出庫依頼画面で
--     現場を毎回選ばせないため、app_users にログインアカウントが担当する
--     現場を直接持たせる。
--   - vendors / vendor_sites（1業者:多現場）は既存機能として維持する
--     （業者マスタ・現場紐付け画面は引き続き使う）。site_id はそれとは別に、
--     「このログインが今どの現場として動くか」を表す列。
--
-- 方針:
--   - app_users.site_id を追加（NULL 可。role=vendor のときのみ意味を持つ）。
--   - current_site_id() ヘルパーを追加（current_vendor_id() と同じパターン）。
--   - list_app_users() / update_app_user_by_internal() に site_id を追加。
--   - prevent_self_role_change トリガーで site_id の自己変更も禁止（role/vendor_id と同様）。
--   - 既存の vendor_sites ベースの RLS（stock_requests 等）は壊さず、
--     site_id ベースの判定を「追加の許可条件」として OR で足す（後方互換）。
--
-- 冪等性: add column if not exists / create or replace / drop policy if exists → create。

begin;

-- ===========================================================================
-- 1) app_users.site_id 追加
-- ===========================================================================
alter table public.app_users
  add column if not exists site_id uuid references public.sites (id) on delete set null;

comment on column public.app_users.site_id is
  'role=vendor のとき、このアカウントが担当する現場（1アカウント＝1現場）。P1-E Phase E-1 で追加';

create index if not exists app_users_site_id_idx on public.app_users (site_id);

-- ===========================================================================
-- 2) current_site_id(): ログイン vendor ユーザーの site_id を返す
-- ===========================================================================
create or replace function public.current_site_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select site_id
    from public.app_users
   where id = auth.uid();
$$;

comment on function public.current_site_id() is
  'A-7 認可判定用。ログイン vendor ユーザーの app_users.site_id を返す。未設定/非vendorは NULL。P1-E Phase E-1';

revoke execute on function public.current_site_id() from public;
revoke execute on function public.current_site_id() from anon;
grant execute on function public.current_site_id() to authenticated;

-- ===========================================================================
-- 3) list_app_users(): site_id / 現場名を追加して返す
--    戻り値の列（OUT パラメータ）が変わるため、create or replace ではなく
--    明示的に drop してから作り直す（42P13 対策）。
-- ===========================================================================
drop function if exists public.list_app_users();

create or replace function public.list_app_users()
returns table (
  id uuid,
  email text,
  role text,
  display_name text,
  vendor_id uuid,
  site_id uuid,
  site_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select au.id, u.email, au.role, au.display_name, au.vendor_id,
         au.site_id, s.name as site_name,
         au.created_at, au.updated_at
    from public.app_users au
    join auth.users u on u.id = au.id
    left join public.sites s on s.id = au.site_id
   where public.is_admin();
$$;

revoke execute on function public.list_app_users() from public;
revoke execute on function public.list_app_users() from anon;
grant execute on function public.list_app_users() to authenticated;

-- ===========================================================================
-- 4) update_app_user_by_internal(): p_site_id を追加
--    シグネチャが変わるため、旧関数を明示的に drop してから再作成する。
-- ===========================================================================
drop function if exists public.update_app_user_by_internal(uuid, text, text, uuid);

create or replace function public.update_app_user_by_internal(
  p_id           uuid,
  p_display_name text,
  p_role         text,
  p_vendor_id    uuid,
  p_site_id      uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_role not in ('admin', 'center', 'vendor') then
    raise exception 'invalid_role';
  end if;

  update public.app_users
     set display_name = p_display_name,
         role          = p_role,
         vendor_id     = case when p_role = 'vendor' then p_vendor_id else null end,
         site_id       = case when p_role = 'vendor' then p_site_id  else null end
   where id = p_id;

  if not found then
    raise exception 'app_user_not_found';
  end if;
end;
$$;

revoke execute on function public.update_app_user_by_internal(uuid, text, text, uuid, uuid) from public;
revoke execute on function public.update_app_user_by_internal(uuid, text, text, uuid, uuid) from anon;
grant  execute on function public.update_app_user_by_internal(uuid, text, text, uuid, uuid) to authenticated;

-- ===========================================================================
-- 5) prevent_self_role_change: site_id の自己変更も禁止
-- ===========================================================================
create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() = old.id
     and (new.role is distinct from old.role
          or new.vendor_id is distinct from old.vendor_id
          or new.site_id is distinct from old.site_id) then
    raise exception 'cannot_change_own_role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 6) 既存 RLS に site_id ベースの許可条件を追加（後方互換・OR 条件）
--    vendor_sites ベースの判定は残したまま、current_site_id() も許可する。
-- ===========================================================================

-- 6-1) site_product_plans: vendor は担当現場の予定数量を参照可
drop policy if exists "site_product_plans_vendor_select" on public.site_product_plans;
create policy "site_product_plans_vendor_select" on public.site_product_plans
  for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and (
      site_id = public.current_site_id()
      or site_id in (
        select vs.site_id
          from public.vendor_sites vs
         where vs.vendor_id = public.current_vendor_id()
      )
    )
  );

-- 6-2) stock_requests: vendor は担当現場かつ status='requested' の依頼のみ作成可
drop policy if exists "stock_requests_vendor_insert" on public.stock_requests;
create policy "stock_requests_vendor_insert"
  on public.stock_requests for insert to authenticated
  with check (
    public.current_app_role() = 'vendor'
    and requested_by = auth.uid()::text
    and status       = 'requested'
    and (
      stock_requests.site_id = public.current_site_id()
      or exists (
        select 1
          from public.vendor_sites vs
         where vs.vendor_id = public.current_vendor_id()
           and vs.site_id   = stock_requests.site_id
      )
    )
  );

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) 列追加の確認
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name='app_users' and column_name='site_id';
--
-- -- (b) 関数の存在確認
-- select proname from pg_proc where proname in ('current_site_id');
--
-- -- (c) list_app_users の列に site_id / site_name が含まれること
-- select * from public.list_app_users() limit 1;
--
-- -- (d) policy 数の確認（想定どおりに置き換わっていること）
-- select tablename, policyname, cmd
--   from pg_policies
--  where schemaname='public'
--    and tablename in ('site_product_plans','stock_requests')
--  order by tablename, policyname;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- drop policy if exists "stock_requests_vendor_insert" on public.stock_requests;
-- create policy "stock_requests_vendor_insert"
--   on public.stock_requests for insert to authenticated
--   with check (
--     public.current_app_role() = 'vendor'
--     and requested_by = auth.uid()::text
--     and status       = 'requested'
--     and exists (
--       select 1 from public.vendor_sites vs
--        where vs.vendor_id = public.current_vendor_id()
--          and vs.site_id   = stock_requests.site_id
--     )
--   );
--
-- drop policy if exists "site_product_plans_vendor_select" on public.site_product_plans;
-- create policy "site_product_plans_vendor_select" on public.site_product_plans
--   for select to authenticated
--   using (
--     public.current_app_role() = 'vendor'
--     and site_id in (
--       select vs.site_id from public.vendor_sites vs
--        where vs.vendor_id = public.current_vendor_id()
--     )
--   );
--
-- create or replace function public.prevent_self_role_change()
-- returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
-- begin
--   if auth.uid() = old.id
--      and (new.role is distinct from old.role or new.vendor_id is distinct from old.vendor_id) then
--     raise exception 'cannot_change_own_role' using errcode = '42501';
--   end if;
--   return new;
-- end;
-- $$;
--
-- drop function if exists public.update_app_user_by_internal(uuid, text, text, uuid, uuid);
-- create or replace function public.update_app_user_by_internal(
--   p_id uuid, p_display_name text, p_role text, p_vendor_id uuid
-- ) returns void language plpgsql security definer set search_path = public, pg_temp as $$
-- begin
--   if not public.is_admin() then
--     raise exception 'permission_denied: admin role required' using errcode = '42501';
--   end if;
--   if p_role not in ('admin', 'center', 'vendor') then raise exception 'invalid_role'; end if;
--   update public.app_users set display_name = p_display_name, role = p_role,
--          vendor_id = case when p_role = 'vendor' then p_vendor_id else null end
--    where id = p_id;
--   if not found then raise exception 'app_user_not_found'; end if;
-- end;
-- $$;
-- grant execute on function public.update_app_user_by_internal(uuid, text, text, uuid) to authenticated;
--
-- drop function if exists public.list_app_users();
-- create or replace function public.list_app_users()
-- returns table (id uuid, email text, role text, display_name text, vendor_id uuid,
--                created_at timestamptz, updated_at timestamptz)
-- language sql stable security definer set search_path = public, pg_temp as $$
--   select au.id, u.email, au.role, au.display_name, au.vendor_id, au.created_at, au.updated_at
--     from public.app_users au join auth.users u on u.id = au.id
--    where public.is_admin();
-- $$;
-- grant execute on function public.list_app_users() to authenticated;
--
-- drop function if exists public.current_site_id();
-- alter table public.app_users drop column if exists site_id;
--
-- commit;
-- notify pgrst, 'reload schema';
