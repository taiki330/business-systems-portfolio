-- 033_p3_6_movement_analytics.sql
-- 032 適用後に Supabase SQL Editor で実行
-- Phase 3-6: 資材移動の月別・年別集計基盤（stock_ledger の追跡列強化 + 集計ビュー）
--
-- 方針:
--   - 要件定義書 §10-3「誰が・いつ・どの操作を行ったかを確認できること」および
--     確定事項「月別・年別集計できるよう必要な履歴を保存すること」に対応する。
--   - 既存 stock_ledger は location 文字列しか持たず、現場別集計に文字列パースが必要だった。
--     後方互換のため nullable 列 site_id / created_by を追加し、既存行は location から
--     一括バックフィルする。列追加とバックフィルのみで、既存ロジック・既存列は変更しない。
--   - 自社在庫 RPC（apply_stock_movement / ship_stock_request / return_from_site）は
--     027 の定義（center ガード・業務ロジック）を維持したまま、
--     stock_ledger への追記に site_id / created_by を埋める処理のみを追加する。
--     引数シグネチャ・戻り値・例外は一切変更しない（後方互換）。
--   - 集計は自社在庫とリース在庫を UNION したビュー material_movement_ledger を土台とし、
--     月別 / 年別の集計ビューをその上に定義する。
--     画面側は集計ビューを SELECT するだけでよく、集計ロジックを TypeScript に持たせない。
--   - ビューは security_invoker=on とし、参照者自身の RLS が適用されるようにする
--     （ビュー経由で RLS を迂回できないようにするフェイルクローズ設計）。
--   - コードレビュー指摘（Medium）対応: apply_stock_movement / ship_stock_request /
--     return_from_site の search_path を `public` のみから `public, pg_temp` に修正する。
--     pg_temp を明示指定しないと、SET search_path 指定時も pg_temp が暗黙に最優先で
--     検索されるため、セッション側が同名の一時テーブルを作って名前解決を乗っ取る
--     search_path 攻撃の余地が残る。明示的に末尾へ列挙することでこれを閉じる。
--
-- 冪等性: add column if not exists / create or replace view / create or replace function。
--         バックフィルは site_id is null の行のみ対象。再実行しても安全。

begin;

-- ===========================================================================
-- 1) stock_ledger に追跡列を追加（nullable・後方互換）
-- ===========================================================================
alter table public.stock_ledger
  add column if not exists site_id uuid null
    references public.sites (id) on delete restrict,
  add column if not exists created_by uuid null
    references public.app_users (id) on delete set null;

comment on column public.stock_ledger.site_id is
  '現場別集計用。location が site 行のとき対象現場。center 行は NULL。Phase 3-6 で追加（後方互換のため nullable）';
comment on column public.stock_ledger.created_by is
  '操作者（app_users.id）。Phase 3-6 で追加。過去行は NULL';

create index if not exists stock_ledger_site_id_idx
  on public.stock_ledger (site_id)
  where site_id is not null;

-- 既存行のバックフィル: location = 'site:<uuid>' の行から site_id を復元する。
-- site_stock_location() の組み立てルールに対応する唯一の逆変換箇所。
update public.stock_ledger sl
   set site_id = s.id
  from public.sites s
 where sl.site_id is null
   and sl.location = public.site_stock_location(s.id);

-- ===========================================================================
-- 2) 自社在庫 RPC: 追跡列を埋めるように更新（ロジック・シグネチャは 027 のまま）
-- ===========================================================================

-- ---- apply_stock_movement（center ガード維持 + site_id / created_by 追記）
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

  insert into public.stock_items (product_id, location, quantity)
  values (p_product_id, v_location, 0)
  on conflict (product_id, location) do nothing;

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

-- ---- ship_stock_request（027 のロジック維持 + site 側 ledger に site_id / created_by）
create or replace function public.ship_stock_request(
  p_request_id uuid,
  p_shipped_by text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status        text;
  v_product_id    uuid;
  v_quantity      numeric(12, 2);
  v_site_id       uuid;
  v_site_location text;
  v_ledger_id     uuid;
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  select status, product_id, quantity, site_id
    into v_status, v_product_id, v_quantity, v_site_id
  from public.stock_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'stock_request_not_found';
  end if;

  if v_status <> 'accepted' then
    raise exception 'invalid_status_transition';
  end if;

  v_ledger_id := public.apply_stock_movement(
    v_product_id, 'center', 'out', v_quantity
  );

  v_site_location := public.site_stock_location(v_site_id);

  insert into public.stock_items (product_id, location, storage_kind, site_id, quantity)
  values (v_product_id, v_site_location, 'site', v_site_id, 0)
  on conflict (product_id, location) do nothing;

  update public.stock_items
     set quantity = quantity + v_quantity
   where product_id = v_product_id
     and location   = v_site_location;

  insert into public.stock_ledger (
    product_id, location, movement_type, quantity, site_id, created_by
  )
  values (
    v_product_id, v_site_location, 'in', v_quantity,
    v_site_id, public.current_actor_id()
  );

  update public.stock_requests
     set status     = 'shipped',
         shipped_at = now(),
         shipped_by = p_shipped_by
   where id = p_request_id;

  return v_ledger_id;
end;
$$;

-- ---- return_from_site（027 のロジック維持 + site 側 ledger に site_id / created_by）
create or replace function public.return_from_site(
  p_product_id  uuid,
  p_site_id     uuid,
  p_quantity    numeric,
  p_memo        text default null,
  p_returned_by text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site_location text;
  v_site_quantity numeric(12, 2);
  v_return_id     uuid;
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  v_site_location := public.site_stock_location(p_site_id);

  select si.quantity
    into v_site_quantity
  from public.stock_items si
  where si.product_id = p_product_id
    and si.location   = v_site_location
    and si.storage_kind = 'site'
  for update;

  if v_site_quantity is null then
    raise exception 'site_stock_item_not_found';
  end if;

  if v_site_quantity < p_quantity then
    raise exception 'insufficient_site_stock';
  end if;

  update public.stock_items
     set quantity = quantity - p_quantity
   where product_id = p_product_id
     and location    = v_site_location;

  perform public.apply_stock_movement(p_product_id, 'center', 'in', p_quantity);

  insert into public.stock_ledger (
    product_id, location, movement_type, quantity, site_id, created_by
  )
  values (
    p_product_id, v_site_location, 'out', p_quantity,
    p_site_id, public.current_actor_id()
  );

  insert into public.stock_returns (product_id, site_id, quantity, memo, returned_by)
  values (p_product_id, p_site_id, p_quantity, p_memo, p_returned_by)
  returning id into v_return_id;

  return v_return_id;
end;
$$;

-- ===========================================================================
-- 3) 集計ビュー
-- ===========================================================================

-- ---- 自社在庫とリース在庫の移動履歴を統合した基底ビュー
--      ownership: 'owned'（自社所有）/ 'leased'（リース）
--      reason:    リースは lease_stock_ledger.reason をそのまま使う。
--                 自社は reason 列を持たないため location と movement_type から導出する:
--                   現場行 in  → 'ship'              （出庫確定でのみ発生。一意に決まる）
--                   現場行 out → 'return_from_site'  （返却でのみ発生。一意に決まる）
--                   センター行 → 'center_in' / 'center_out'
--                     センター側は「出庫確定に伴う減算」と「手動の入出庫登録」を
--                     区別できないため、出庫・返却の集計には用いない。
--                     集計は必ず現場側の行（site_id is not null）を用いること。
drop view if exists public.material_movement_yearly;
drop view if exists public.material_movement_monthly;
drop view if exists public.material_movement_ledger;

create view public.material_movement_ledger
with (security_invoker = on)
as
  select
    sl.id,
    'owned'::text        as ownership,
    sl.product_id,
    null::uuid           as lease_company_id,
    sl.site_id,
    sl.location,
    sl.movement_type,
    case
      when sl.site_id is not null and sl.movement_type = 'in'  then 'ship'
      when sl.site_id is not null and sl.movement_type = 'out' then 'return_from_site'
      when sl.movement_type = 'in'                             then 'center_in'
      else 'center_out'
    end                  as reason,
    sl.quantity,
    sl.created_by,
    sl.created_at
  from public.stock_ledger sl

  union all

  select
    lsl.id,
    'leased'::text       as ownership,
    lsl.product_id,
    lsl.lease_company_id,
    lsl.site_id,
    lsl.location,
    lsl.movement_type,
    lsl.reason,
    lsl.quantity,
    lsl.created_by,
    lsl.created_at
  from public.lease_stock_ledger lsl;

comment on view public.material_movement_ledger is
  '自社所有・リースの移動履歴を統合した基底ビュー。月別・年別集計の入力。Phase 3-6';

-- ---- 月別集計
create view public.material_movement_monthly
with (security_invoker = on)
as
  select
    date_trunc('month', m.created_at)::date as period,
    m.ownership,
    m.product_id,
    m.lease_company_id,
    m.site_id,
    m.reason,
    m.movement_type,
    sum(m.quantity) as total_quantity,
    count(*)        as movement_count
  from public.material_movement_ledger m
  group by 1, 2, 3, 4, 5, 6, 7;

comment on view public.material_movement_monthly is
  '資材移動の月別集計（商品別・現場別・リース会社別・理由別）。Phase 3-6';

-- ---- 年別集計
create view public.material_movement_yearly
with (security_invoker = on)
as
  select
    date_trunc('year', m.created_at)::date as period,
    m.ownership,
    m.product_id,
    m.lease_company_id,
    m.site_id,
    m.reason,
    m.movement_type,
    sum(m.quantity) as total_quantity,
    count(*)        as movement_count
  from public.material_movement_ledger m
  group by 1, 2, 3, 4, 5, 6, 7;

comment on view public.material_movement_yearly is
  '資材移動の年別集計（商品別・現場別・リース会社別・理由別）。Phase 3-6';

grant select on public.material_movement_ledger  to authenticated;
grant select on public.material_movement_monthly to authenticated;
grant select on public.material_movement_yearly  to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) 追加列とバックフィル結果
-- select count(*) filter (where site_id is not null) as with_site,
--        count(*) filter (where site_id is null)     as without_site,
--        count(*)                                    as total
--   from public.stock_ledger;
-- -- 期待: location が 'site:...' の行はすべて with_site 側に入る
--
-- select count(*) as unbackfilled
--   from public.stock_ledger
--  where site_id is null and location <> 'center';
-- -- 期待: 0 行
--
-- -- (b) RPC のシグネチャが変わっていないこと（後方互換）
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public'
--    and p.proname in ('apply_stock_movement','ship_stock_request','return_from_site')
--  order by p.proname;
-- -- 期待: 027 適用時と同一の引数リスト
--
-- -- (c) RPC の center ガードが維持されていること
-- select p.proname, position('is_center' in pg_get_functiondef(p.oid)) > 0 as center_guard
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public'
--    and p.proname in ('apply_stock_movement','ship_stock_request','return_from_site');
-- -- 期待: すべて true
--
-- -- (d) ビューが security_invoker であること（RLS 迂回でないこと）
-- select c.relname, c.reloptions
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname='public'
--    and c.relname in ('material_movement_ledger','material_movement_monthly','material_movement_yearly');
-- -- 期待: reloptions に security_invoker=on
--
-- -- (e) 月別集計の動作確認
-- select * from public.material_movement_monthly order by period desc limit 20;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop view if exists public.material_movement_yearly;
-- drop view if exists public.material_movement_monthly;
-- drop view if exists public.material_movement_ledger;
-- -- RPC は 027 の定義を再適用する（027 の該当セクションをそのまま実行）
-- drop index if exists public.stock_ledger_site_id_idx;
-- alter table public.stock_ledger drop column if exists created_by;
-- alter table public.stock_ledger drop column if exists site_id;
-- commit;
-- notify pgrst, 'reload schema';
