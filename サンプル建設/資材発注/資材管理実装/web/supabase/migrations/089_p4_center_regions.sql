-- 089_p4_center_regions.sql
-- 088 適用後に Supabase SQL Editor で実行
-- Phase P4: 地域センター管理（関西/サンプル市A・関東/サンプル市B・九州の3拠点運用）
-- 設計: docs/22_P4_地域センター管理_設計整理.md §4
--
-- スコープ:
--   - centers マスタ新設（3行固定・管理UIは今回作らない）
--   - sites / app_users / stock_items に center_id を追加し、既存データは
--     すべて関西（サンプル市A）に帰属させる（後方互換・挙動変更なし）
--   - center ロールの参照 RLS（069_center_read_only.sql）を「自分の地域だけ」に絞る
--   - apply_stock_movement は自動作成する stock_items 行に center_id を明示的に
--     設定するよう更新する（insert 文以外のロジック・シグネチャは無変更）
--   - configure_app_user_by_admin / list_app_users に center_id を追加する
--
-- スコープ外（別フェーズ）:
--   - センター間移動（center_transfers）機能
--   - リース機能（現行のまま。lease_stock_items には center_id 列を追加しない。
--     center 向け参照 policy は location 文字列と centers.stock_location の
--     突き合わせで地域を絞る。詳細は §5 の lease_stock_items_center_order_read を参照）
--
-- 方針:
--   - stock_items.location='center' という文字列リテラルは、在庫・出庫・返却・分析系の
--     RPC に30箇所以上直接埋め込まれており、すべて「関西センター」を指す前提で書かれている。
--     これらの呼び出しは一切変更しない（後方互換）。centers.stock_location で
--     kansai='center' としたまま既存互換値を再利用することで、無改修のまま動作させる。
--   - RLS は「デフォルト拒否から明示許可を積み上げる」方針を厳守する。
--     centers テーブルは insert/update/delete の policy を作らない
--     （RLS 有効時に policy が無ければ認可されず、常に拒否される＝フェイルクローズ）。
--   - 既存 center ロールアカウント・既存 sites・既存 stock_items（storage_kind='center'）は
--     すべて関西センターに自動割当てし、見える範囲を一切変えない（後方互換必須）。
--
-- 冪等性: add column if not exists / create or replace / drop policy if exists → create。
--         centers の初期データは on conflict (code) do nothing。再実行しても安全。

begin;

-- ===========================================================================
-- 1) centers マスタ
-- ===========================================================================
create table if not exists public.centers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('kansai', 'kanto', 'kyushu')),
  name text not null,
  stock_location text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.centers is
  '地域センターマスタ（関西/サンプル市A・関東/サンプル市B・九州の3拠点固定）。P4 で新設。docs/22';
comment on column public.centers.code is
  '拠点コード。kansai/kanto/kyushu の3値固定（今後の拡張は現時点で想定しない）';
comment on column public.centers.stock_location is
  'stock_items.location / lease_stock_items.location の互換値。'
  ' kansai は既存互換のため文字列 ''center''（データ移行不要）。kanto/kyushu は ''center:kanto''/''center:kyushu''';

drop trigger if exists centers_set_updated_at on public.centers;
create trigger centers_set_updated_at
  before update on public.centers
  for each row execute function public.set_updated_at();

insert into public.centers (code, name, stock_location) values
  ('kansai', '関西（サンプル市A）', 'center'),
  ('kanto',  '関東（サンプル市B）', 'center:kanto'),
  ('kyushu', '九州',         'center:kyushu')
on conflict (code) do nothing;

-- 参照は admin・center ロールのみ（vendor には見せない）。
-- insert/update/delete の policy はあえて作らない（3行固定・管理UIは今回作らない。
-- RLS 有効 + policy 無し = 常に拒否されるフェイルクローズ）。
alter table public.centers enable row level security;

drop policy if exists "centers_read" on public.centers;
create policy "centers_read" on public.centers for select to authenticated
  using (public.is_admin() or public.current_app_role() = 'center');

-- authenticated にのみ select を許可。anon には何も付与しない。
revoke all privileges on table public.centers from anon;
grant select on table public.centers to authenticated;

-- ===========================================================================
-- 2) default_kansai_center_id(): 列デフォルト用ヘルパー
--    Postgres の column default はサブクエリ不可のため、関数呼び出しにする。
-- ===========================================================================
create or replace function public.default_kansai_center_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.centers where code = 'kansai';
$$;

comment on function public.default_kansai_center_id() is
  '関西（サンプル市A）センターの centers.id を返す。sites.center_id の列デフォルトに使用。P4';

revoke execute on function public.default_kansai_center_id() from public;
revoke execute on function public.default_kansai_center_id() from anon;
grant execute on function public.default_kansai_center_id() to authenticated;

-- ===========================================================================
-- 3) center_stock_location(uuid): 在庫解決ヘルパー（既存 site_stock_location() に倣う）
--    current_center_id() は app_users.center_id 追加後（5)の直後）で定義する
--    （SQL言語関数は作成時にカタログを検証するため、列追加より前に定義すると失敗する）。
-- ===========================================================================
create or replace function public.center_stock_location(p_center_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select stock_location from public.centers where id = p_center_id;
$$;

comment on function public.center_stock_location(uuid) is
  'centers.id から stock_items 互換の location 値を引く。site_stock_location() に倣うヘルパー。P4';

revoke execute on function public.center_stock_location(uuid) from public;
revoke execute on function public.center_stock_location(uuid) from anon;
grant execute on function public.center_stock_location(uuid) to authenticated;

-- ===========================================================================
-- 4) sites.center_id: 現場の地域区分（既定値=関西、事務のみ更新可）
-- ===========================================================================
alter table public.sites
  add column if not exists center_id uuid references public.centers (id)
    default public.default_kansai_center_id();

update public.sites
   set center_id = public.default_kansai_center_id()
 where center_id is null;

alter table public.sites
  alter column center_id set not null;

comment on column public.sites.center_id is
  '現場が属する地域センター。既定値=関西（サンプル市A）。設定・変更は事務（admin）のみ'
  '（027 の sites_admin_update policy が is_admin() で全カラム更新を許可済み・新規 policy 不要）。P4';

create index if not exists sites_center_id_idx on public.sites (center_id);

-- 確認: 既存の sites_admin_update policy が admin の全カラム更新を許可していること
--   （center_id もこの policy でカバーされるため、新規 policy は不要）。
-- select pg_get_expr(pol.qual, pol.polrelid) as using_expr,
--        pg_get_expr(pol.with_check, pol.polrelid) as check_expr
--   from pg_policy pol join pg_class c on c.oid = pol.polrelid
--  where c.relname = 'sites' and pol.polname = 'sites_admin_update';
-- 期待: using_expr / check_expr がともに is_admin()

-- ===========================================================================
-- 5) app_users.center_id: 地域別アカウントの地域（role='center' のみ使用）
-- ===========================================================================
alter table public.app_users
  add column if not exists center_id uuid references public.centers (id);

update public.app_users
   set center_id = public.default_kansai_center_id()
 where role = 'center' and center_id is null;

alter table public.app_users
  drop constraint if exists app_users_center_id_required_for_center_role;
alter table public.app_users
  add constraint app_users_center_id_required_for_center_role
  check (role <> 'center' or center_id is not null);

comment on column public.app_users.center_id is
  'role=center のとき、このアカウントが参照できる地域。既存 center アカウントは関西へ自動割当'
  '（後方互換）。center 以外は NULL。P4';

create index if not exists app_users_center_id_idx on public.app_users (center_id);

-- current_center_id(): app_users.center_id 追加後に定義（列が存在しないと作成時エラーになるため）。
-- 既存の current_vendor_id() / current_site_id() に倣う。
create or replace function public.current_center_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_center_id uuid;
begin
  -- SQL 言語関数は作成時に app_users.center_id を解決するため、
  -- 同一 migration 内で列を追加する場合でも環境により 42703 となることがある。
  -- PL/pgSQL で実行時に解決し、直前に追加した列を確実に参照する。
  execute 'select center_id from public.app_users where id = $1'
    into v_center_id
    using auth.uid();
  return v_center_id;
end;
$$;

comment on function public.current_center_id() is
  '認可判定用。ログイン center ユーザーの app_users.center_id を返す。center 以外・未登録は NULL。P4';

revoke execute on function public.current_center_id() from public;
revoke execute on function public.current_center_id() from anon;
grant execute on function public.current_center_id() to authenticated;

-- ===========================================================================
-- 6) stock_items.center_id: センター在庫行の地域
-- ===========================================================================
alter table public.stock_items
  add column if not exists center_id uuid references public.centers (id);

update public.stock_items
   set center_id = public.default_kansai_center_id()
 where storage_kind = 'center' and center_id is null;

alter table public.stock_items
  drop constraint if exists stock_items_storage_site_consistency;
alter table public.stock_items
  add constraint stock_items_storage_site_consistency
  check (
    (storage_kind = 'center' and site_id is null and center_id is not null)
    or (storage_kind = 'site' and site_id is not null and center_id is null)
  );

comment on column public.stock_items.center_id is
  'storage_kind=center のとき必須。centers.id を参照。既存行（location=''center''）は'
  '関西センターへ自動割当（後方互換）。P4';

create index if not exists stock_items_center_id_idx
  on public.stock_items (center_id)
  where center_id is not null;

-- ===========================================================================
-- 7) apply_stock_movement: 自動作成する stock_items 行に center_id を設定する
--    033 の最新定義をベースに insert 部分のみ更新。ロジック・シグネチャ・
--    権限チェック（is_center）は一切変更しない。呼び出し側（30箇所以上、
--    すべて p_location='center' 固定）は無改修のまま動く。
-- ===========================================================================
create or replace function public.apply_stock_movement(
  p_product_id uuid,
  p_location text,
  p_movement_type text,
  p_quantity numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ledger_id uuid;
  v_current numeric(12, 2);
  v_location text;
  v_site_id uuid;
  v_center_id uuid;
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  v_location := nullif(trim(p_location), '');
  if v_location is null then
    raise exception 'location_required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  if p_movement_type not in ('in', 'out') then
    raise exception 'invalid_movement_type';
  end if;

  -- v_location がいずれかの centers.stock_location と一致する場合のみ、
  -- 自動作成する行に storage_kind='center' / center_id を明示的に設定する。
  -- site 行（'site:'||site_id）は centers.stock_location と一致しないため、
  -- 従来どおり default 値（storage_kind='center' 実質未使用のフォールバック）に任せる
  -- ＝ 既存呼び出し（すべて p_location='center' 固定）の挙動は変わらない。
  select c.id into v_center_id
    from public.centers c
   where c.stock_location = v_location;

  if v_center_id is not null then
    insert into public.stock_items (product_id, location, storage_kind, center_id, quantity)
    values (p_product_id, v_location, 'center', v_center_id, 0)
    on conflict (product_id, location) do nothing;
  else
    insert into public.stock_items (product_id, location, quantity)
    values (p_product_id, v_location, 0)
    on conflict (product_id, location) do nothing;
  end if;

  -- 現在庫と同時に site_id を取得する（location 文字列のパースをしない）
  select si.quantity, si.site_id
    into v_current, v_site_id
  from public.stock_items si
  where si.product_id = p_product_id
    and si.location = v_location
  for update;

  if v_current is null then
    raise exception 'stock_item_not_found';
  end if;

  if p_movement_type = 'out' and v_current < p_quantity then
    raise exception 'insufficient_stock';
  end if;

  if p_movement_type = 'in' then
    update public.stock_items
    set quantity = quantity + p_quantity
    where product_id = p_product_id
      and location = v_location;
  else
    update public.stock_items
    set quantity = quantity - p_quantity
    where product_id = p_product_id
      and location = v_location;
  end if;

  insert into public.stock_ledger (
    product_id, location, movement_type, quantity, site_id, created_by
  )
  values (
    p_product_id, v_location, p_movement_type, p_quantity,
    v_site_id, public.current_actor_id()
  )
  returning id into v_ledger_id;

  return v_ledger_id;
end;
$$;

comment on function public.apply_stock_movement(uuid, text, text, numeric) is
  '入出庫を反映する共有 RPC（center ガード維持）。P4 で、自動作成する stock_items 行に'
  ' center_id を明示設定するよう更新（insert 文以外は 033 のロジックと同一。シグネチャ無変更）。';

-- ===========================================================================
-- 8) configure_app_user_by_admin: p_center_id を追加
--    シグネチャが変わるため、旧定義を明示的に drop してから作り直す（42P13対策）。
-- ===========================================================================
drop function if exists public.configure_app_user_by_admin(uuid, text, text, uuid[]);

create or replace function public.configure_app_user_by_admin(
  p_id uuid,
  p_display_name text,
  p_role text,
  p_site_ids uuid[] default '{}'::uuid[],
  p_center_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site_ids uuid[];
  v_primary_site_id uuid;
  v_primary_site_name text;
  v_center_id uuid;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'center', 'vendor') then raise exception 'invalid_role'; end if;

  select coalesce(array_agg(x.site_id order by x.ord), '{}'::uuid[])
    into v_site_ids
    from (
      select site_id, min(ord) ord
        from unnest(coalesce(p_site_ids, '{}'::uuid[])) with ordinality as u(site_id, ord)
       where site_id is not null
       group by site_id
    ) x;

  if p_role = 'vendor' then
    if cardinality(v_site_ids) = 0 then raise exception 'site_required'; end if;
    if (select count(*) from public.sites where id = any(v_site_ids)) <> cardinality(v_site_ids) then
      raise exception 'site_not_found';
    end if;
    if exists (
      select 1 from public.app_user_sites aus
       where aus.site_id = any(v_site_ids) and aus.user_id <> p_id
    ) then
      raise exception 'site_already_has_account';
    end if;
    v_primary_site_id := v_site_ids[1];
    select name into v_primary_site_name from public.sites where id = v_primary_site_id;
  else
    v_site_ids := '{}'::uuid[];
    v_primary_site_id := null;
  end if;

  if p_role = 'center' then
    -- 未指定（NULL）なら関西センターへフォールバックする（既存 center 運用の後方互換）。
    v_center_id := coalesce(p_center_id, public.default_kansai_center_id());
    if not exists (select 1 from public.centers c where c.id = v_center_id) then
      raise exception 'center_not_found';
    end if;
  else
    v_center_id := null;
  end if;

  insert into public.app_users(id, role, display_name, vendor_id, site_id, center_id)
  values (
    p_id, p_role,
    case when p_role='vendor'
      then coalesce(nullif(btrim(p_display_name), ''), v_primary_site_name)
      else nullif(btrim(p_display_name), '') end,
    null, v_primary_site_id, v_center_id
  )
  on conflict (id) do update set
    role=excluded.role, display_name=excluded.display_name,
    vendor_id=null, site_id=excluded.site_id, center_id=excluded.center_id;

  delete from public.app_user_sites where user_id = p_id;
  if p_role = 'vendor' then
    insert into public.app_user_sites(user_id, site_id)
    select p_id, unnest(v_site_ids);
  end if;
end;
$$;

comment on function public.configure_app_user_by_admin(uuid, text, text, uuid[], uuid) is
  '事務によるアカウント発行・更新。role=center のとき p_center_id（未指定は関西）を'
  ' app_users.center_id に保存する。role<>center は center_id を NULL にする。P4';

revoke execute on function public.configure_app_user_by_admin(uuid, text, text, uuid[], uuid) from public, anon;
grant execute on function public.configure_app_user_by_admin(uuid, text, text, uuid[], uuid) to authenticated;

-- ===========================================================================
-- 9) list_app_users: center_id / center_name を追加
-- ===========================================================================
drop function if exists public.list_app_users();
create function public.list_app_users()
returns table (
  id uuid, email text, role text, display_name text, vendor_id uuid,
  site_id uuid, site_name text, site_ids uuid[], site_names text[],
  center_id uuid, center_name text,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select au.id, u.email, au.role, au.display_name, au.vendor_id,
         au.site_id, s.name,
         coalesce(a.site_ids, '{}'::uuid[]),
         coalesce(a.site_names, '{}'::text[]),
         au.center_id, c.name,
         au.created_at, au.updated_at
    from public.app_users au
    join auth.users u on u.id=au.id
    left join public.sites s on s.id=au.site_id
    left join public.centers c on c.id=au.center_id
    left join lateral (
      select array_agg(aus.site_id order by ss.name, aus.site_id) site_ids,
             array_agg(ss.name order by ss.name, aus.site_id) site_names
        from public.app_user_sites aus
        join public.sites ss on ss.id=aus.site_id
       where aus.user_id=au.id
    ) a on true
   where public.is_admin();
$$;
revoke execute on function public.list_app_users() from public, anon;
grant execute on function public.list_app_users() to authenticated;

-- ===========================================================================
-- 10) center ロールの参照 RLS を地域スコープへ絞り込む
--     069_center_read_only.sql で作成した *_center_read policy 群を更新する。
--     products_center_read は商品マスタ（地域に関係ない）のため無変更。
-- ===========================================================================

-- sites: 自分の地域の現場のみ
drop policy if exists "sites_center_read" on public.sites;
create policy "sites_center_read" on public.sites for select to authenticated
  using (
    public.current_app_role() = 'center'
    and sites.center_id = public.current_center_id()
  );

-- site_products: 自分の地域の現場に紐づく行のみ
drop policy if exists "site_products_center_read" on public.site_products;
create policy "site_products_center_read" on public.site_products for select to authenticated
  using (
    public.current_app_role() = 'center'
    and exists (
      select 1 from public.sites s
       where s.id = site_products.site_id
         and s.center_id = public.current_center_id()
    )
  );

-- stock_items: センター行=自分の地域のセンター在庫 / 現場行=自分の地域に属する現場の在庫
drop policy if exists "stock_items_center_read" on public.stock_items;
create policy "stock_items_center_read" on public.stock_items for select to authenticated
  using (
    public.current_app_role() = 'center'
    and (
      (
        stock_items.storage_kind = 'center'
        and stock_items.center_id = public.current_center_id()
      )
      or (
        stock_items.storage_kind = 'site'
        and exists (
          select 1 from public.sites s
           where s.id = stock_items.site_id
             and s.center_id = public.current_center_id()
        )
      )
    )
  );

-- orders: site_id が自分の地域に属する現場のオーダーのみ
drop policy if exists "orders_center_read" on public.orders;
create policy "orders_center_read" on public.orders for select to authenticated
  using (
    public.current_app_role() = 'center'
    and exists (
      select 1 from public.sites s
       where s.id = orders.site_id
         and s.center_id = public.current_center_id()
    )
  );

-- stock_requests: site_id が自分の地域に属する現場の依頼のみ
drop policy if exists "stock_requests_center_read" on public.stock_requests;
create policy "stock_requests_center_read" on public.stock_requests for select to authenticated
  using (
    public.current_app_role() = 'center'
    and exists (
      select 1 from public.sites s
       where s.id = stock_requests.site_id
         and s.center_id = public.current_center_id()
    )
  );

-- lease_stock_items: 過去オーダーの自社/リース表示解決専用（031/069 の設計を踏襲）。
-- lease_stock_items には center_id 列を追加していない（今回のスコープ外）ため、
-- storage_kind='center' の行は location 文字列と centers.stock_location の一致で、
-- storage_kind='site' の行は site_id → sites.center_id で地域を判定する。
drop policy if exists "lease_stock_items_center_order_read" on public.lease_stock_items;
create policy "lease_stock_items_center_order_read" on public.lease_stock_items for select to authenticated
  using (
    public.current_app_role() = 'center'
    and (
      (
        lease_stock_items.storage_kind = 'center'
        and lease_stock_items.location = public.center_stock_location(public.current_center_id())
      )
      or (
        lease_stock_items.storage_kind = 'site'
        and exists (
          select 1 from public.sites s
           where s.id = lease_stock_items.site_id
             and s.center_id = public.current_center_id()
        )
      )
    )
  );

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) centers に3行、stock_location が一意であること
-- select code, name, stock_location from public.centers order by code;
--
-- -- (b) 既存 sites / stock_items(center) / app_users(center) がすべて関西へ後方互換割当てされていること
-- select count(*) as non_kansai_sites
--   from public.sites s join public.centers c on c.id = s.center_id
--  where c.code <> 'kansai';
-- -- 期待: 0（新規に関東/九州の現場を登録するまでは 0 のまま）
--
-- select count(*) as center_stock_without_center_id
--   from public.stock_items where storage_kind = 'center' and center_id is null;
-- -- 期待: 0
--
-- select count(*) as center_users_without_center_id
--   from public.app_users where role = 'center' and center_id is null;
-- -- 期待: 0
--
-- -- (c) apply_stock_movement のシグネチャ・center ガードが無変更であること
-- select pg_get_function_identity_arguments(p.oid) as args,
--        position('is_center' in pg_get_functiondef(p.oid)) > 0 as center_guard
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname='apply_stock_movement';
--
-- -- (d) 既存の関西 center アカウントが従来と同じ範囲を見えること（回帰確認）
-- --     関西 center アカウントで実行し、件数が P4 適用前と一致することを確認する。
-- -- select count(*) from public.sites;               -- 全現場が関西のため変化なしのはず
-- -- select count(*) from public.stock_items where storage_kind='center';
--
-- -- (e) RLS policy が想定どおり更新されていること
-- select tablename, policyname, cmd
--   from pg_policies
--  where schemaname='public'
--    and policyname in (
--      'centers_read','sites_center_read','site_products_center_read',
--      'stock_items_center_read','orders_center_read','stock_requests_center_read',
--      'lease_stock_items_center_order_read'
--    )
--  order by tablename, policyname;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- -- RLS を 069 の定義へ戻す
-- drop policy if exists "sites_center_read" on public.sites;
-- create policy "sites_center_read" on public.sites for select to authenticated
--   using (public.current_app_role() = 'center');
--
-- drop policy if exists "site_products_center_read" on public.site_products;
-- create policy "site_products_center_read" on public.site_products for select to authenticated
--   using (public.current_app_role() = 'center');
--
-- drop policy if exists "stock_items_center_read" on public.stock_items;
-- create policy "stock_items_center_read" on public.stock_items for select to authenticated
--   using (public.current_app_role() = 'center');
--
-- drop policy if exists "orders_center_read" on public.orders;
-- create policy "orders_center_read" on public.orders for select to authenticated
--   using (public.current_app_role() = 'center');
--
-- drop policy if exists "stock_requests_center_read" on public.stock_requests;
-- create policy "stock_requests_center_read" on public.stock_requests for select to authenticated
--   using (public.current_app_role() = 'center');
--
-- drop policy if exists "lease_stock_items_center_order_read" on public.lease_stock_items;
-- create policy "lease_stock_items_center_order_read" on public.lease_stock_items for select to authenticated
--   using (public.current_app_role() = 'center');
--
-- -- list_app_users / configure_app_user_by_admin を 079 の定義へ戻す
-- drop function if exists public.list_app_users();
-- create function public.list_app_users()
-- returns table (id uuid, email text, role text, display_name text, vendor_id uuid,
--   site_id uuid, site_name text, site_ids uuid[], site_names text[],
--   created_at timestamptz, updated_at timestamptz)
-- language sql stable security definer set search_path = public, pg_temp as $$
--   select au.id, u.email, au.role, au.display_name, au.vendor_id,
--          au.site_id, s.name, coalesce(a.site_ids,'{}'::uuid[]), coalesce(a.site_names,'{}'::text[]),
--          au.created_at, au.updated_at
--     from public.app_users au join auth.users u on u.id=au.id
--     left join public.sites s on s.id=au.site_id
--     left join lateral (
--       select array_agg(aus.site_id order by ss.name, aus.site_id) site_ids,
--              array_agg(ss.name order by ss.name, aus.site_id) site_names
--         from public.app_user_sites aus join public.sites ss on ss.id=aus.site_id
--        where aus.user_id=au.id
--     ) a on true
--    where public.is_admin();
-- $$;
-- grant execute on function public.list_app_users() to authenticated;
--
-- drop function if exists public.configure_app_user_by_admin(uuid, text, text, uuid[], uuid);
-- -- (079 の 4引数版定義をそのまま再適用する。079_multi_site_accounts.sql 参照)
--
-- -- apply_stock_movement を 033 の定義へ戻す（033_p3_6_movement_analytics.sql 参照）
--
-- alter table public.stock_items drop constraint if exists stock_items_storage_site_consistency;
-- alter table public.stock_items add constraint stock_items_storage_site_consistency
--   check ((storage_kind='center' and site_id is null) or (storage_kind='site' and site_id is not null));
-- drop index if exists public.stock_items_center_id_idx;
-- alter table public.stock_items drop column if exists center_id;
--
-- drop index if exists public.app_users_center_id_idx;
-- alter table public.app_users drop constraint if exists app_users_center_id_required_for_center_role;
-- alter table public.app_users drop column if exists center_id;
--
-- alter table public.sites alter column center_id drop not null;
-- drop index if exists public.sites_center_id_idx;
-- alter table public.sites drop column if exists center_id;
--
-- drop function if exists public.current_center_id();
-- drop function if exists public.center_stock_location(uuid);
-- drop function if exists public.default_kansai_center_id();
--
-- drop policy if exists "centers_read" on public.centers;
-- drop table if exists public.centers;
--
-- commit;
-- notify pgrst, 'reload schema';
