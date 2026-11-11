-- 066_p8_print_snapshot.sql
-- 065 適用後に Supabase SQL Editor で実行
-- 資材発注書のスナップショット保存（docs/20 D-20260805-10, E-REQ-10）
--
-- 背景:
--   これまで印刷のたびに商品マスタ・現場マスタ・在庫状況（自社/リース判定）を
--   都度参照していたため、後から商品名・現場名を変更したり、在庫構成が変わって
--   自社/リースの自動判定が変わったりすると、過去に登録したオーダーの帳票表示まで
--   変わってしまっていた。紙の発注書は「その時点の事実の記録」であるべきなので、
--   依頼（オーダー）登録時点の値を固定して保存する。
--
-- 方針（ユーザー確認済み）:
--   - 固定するタイミングは「依頼登録時」。create_order_with_requests（初回登録）と
--     add_order_item（既存オーダーへの追加）の、それぞれの INSERT の瞬間に固定する。
--   - 保存先は新規テーブルではなく、既存の orders / stock_requests に列を追加する
--     （このプロジェクトの一貫した方針。docs/18 §5-1）。
--   - 過去に登録済みのオーダーは対象外（ユーザー判断）。スナップショット列は NULL のままとし、
--     アプリ側で「NULL なら従来どおり現在のマスタを参照する」フォールバックを行う。
--     そのため本 migration はデータの backfill を行わない。
--   - 自社/リースの自動判定は、判定ロジックの二重管理を避けるため、
--     引き続き product_ownership_kind ビュー（059, D-20260805-01 #6 の理由と同じ）を
--     参照して1回だけ計算し、その結果を固定する。ビュー自体は変更しない。
--   - 数量・自社/リース手動上書き・納期・ヤード積込日・承認記録は、この migration 以前から
--     既にオーダー・依頼行そのものに直接保存されており、マスタ変更で変わる心配が無いため対象外。
--   - 半端もん判定（is_lot_size_violation）も対象外。あれは「今のルールで見て半端かどうか」の
--     確認用であり、「その時点の記録」ではないため、従来どおりライブ判定のままにする。
--
-- 冪等性: add column if not exists / create or replace function（シグネチャ不変のため drop 不要）。

begin;

-- ===========================================================================
-- 1) orders: 現場名・発注者名のスナップショット
-- ===========================================================================
alter table public.orders
  add column if not exists site_name_snapshot text;

alter table public.orders
  add column if not exists requester_label_snapshot text;

comment on column public.orders.site_name_snapshot is
  '依頼登録時点の現場名。後から現場マスタを改名しても帳票の表示は変わらない（D-20260805-10）。'
  ' 過去分は NULL（対象外）。NULL のときはアプリ側で現在の sites.name にフォールバックする';
comment on column public.orders.requester_label_snapshot is
  '依頼登録時点の発注者（依頼したアカウント）の表示名。D-20260805-10。'
  ' 過去分は NULL（対象外）。NULL のときはアプリ側で get_order_requester_label() にフォールバックする';

-- ===========================================================================
-- 2) stock_requests: 商品情報・自社/リース自動判定のスナップショット
-- ===========================================================================
alter table public.stock_requests
  add column if not exists product_code_snapshot text;

alter table public.stock_requests
  add column if not exists product_name_snapshot text;

alter table public.stock_requests
  add column if not exists product_unit_snapshot text;

alter table public.stock_requests
  add column if not exists product_weight_kg_snapshot numeric(12, 3);

alter table public.stock_requests
  add column if not exists product_category_name_snapshot text;

alter table public.stock_requests
  add column if not exists ownership_auto_snapshot text
    check (ownership_auto_snapshot is null or ownership_auto_snapshot in ('owned', 'leased'));

comment on column public.stock_requests.product_code_snapshot is
  '依頼登録時点の商品コード。D-20260805-10。過去分は NULL（対象外・現在の products を参照）';
comment on column public.stock_requests.product_name_snapshot is
  '依頼登録時点の商品名。D-20260805-10。過去分は NULL（対象外・現在の products を参照）';
comment on column public.stock_requests.product_unit_snapshot is
  '依頼登録時点の単位。D-20260805-10。過去分は NULL（対象外・現在の products を参照）';
comment on column public.stock_requests.product_weight_kg_snapshot is
  '依頼登録時点の商品重量(kg)。D-20260805-10。過去分は NULL（対象外・現在の products を参照）';
comment on column public.stock_requests.product_category_name_snapshot is
  '依頼登録時点の資材種別名。D-20260805-10。過去分は NULL（対象外・現在の products を参照）';
comment on column public.stock_requests.ownership_auto_snapshot is
  '依頼登録時点の自社/リース自動判定結果（product_ownership_kind を1回だけ評価して固定）。'
  ' D-20260805-10。過去分は NULL（対象外・現在のビューを参照）。'
  ' 事務による手動上書き（ownership_override）はこれとは別列で、対象外（元々マスタに依存しない）';

-- ===========================================================================
-- 3) create_order_with_requests: 登録時にスナップショットを書き込む
--    シグネチャ（引数・戻り値）は 060 から不変のため drop 不要。本体のみ更新する。
-- ===========================================================================
create or replace function public.create_order_with_requests(
  p_site_id uuid,
  p_items jsonb,
  p_delivery_deadline timestamptz default null
)
returns table (
  order_id uuid,
  request_id uuid,
  product_id uuid,
  quantity numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_site_name text;
  v_requester_label text;
  v_item record;
  v_item_count integer := 0;
  v_product_code text;
  v_product_name text;
  v_product_unit text;
  v_product_weight_kg numeric(12, 3);
  v_product_category_name text;
  v_ownership_auto text;
begin
  if public.current_app_role() <> 'vendor' then
    raise exception 'permission_denied: vendor role required'
      using errcode = '42501';
  end if;

  -- 1アカウント=1現場。vendor_sites の複数紐付けではなく、ログイン中の
  -- app_users.site_id と完全一致する現場だけに登録を許可する。
  if p_site_id is null or p_site_id is distinct from public.current_site_id() then
    raise exception 'permission_denied: site does not match account'
      using errcode = '42501';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_order_items';
  end if;

  select s.name into v_site_name
    from public.sites s
   where s.id = p_site_id;

  select nullif(trim(au.display_name), '') into v_requester_label
    from public.app_users au
   where au.id::text = auth.uid()::text;

  insert into public.orders (
    site_id, requested_by, delivery_deadline,
    site_name_snapshot, requester_label_snapshot
  )
  values (
    p_site_id, auth.uid()::text, p_delivery_deadline,
    v_site_name, v_requester_label
  )
  returning id into v_order_id;

  for v_item in
    select item.product_id, sum(item.quantity) as requested_quantity
      from jsonb_to_recordset(p_items) as item(product_id uuid, quantity numeric)
     group by item.product_id
  loop
    if v_item.product_id is null
       or v_item.requested_quantity is null
       or v_item.requested_quantity <= 0 then
      raise exception 'invalid_quantity';
    end if;

    select p.code, p.name, p.unit, p.weight_kg, pc.name
      into v_product_code, v_product_name, v_product_unit,
           v_product_weight_kg, v_product_category_name
      from public.products p
      left join public.product_categories pc on pc.id = p.category_id
     where p.id = v_item.product_id;

    if not found then
      raise exception 'invalid_product_id';
    end if;

    select pok.ownership_kind into v_ownership_auto
      from public.product_ownership_kind pok
     where pok.product_id = v_item.product_id;
    v_ownership_auto := coalesce(v_ownership_auto, 'owned');

    insert into public.stock_requests (
      site_id, product_id, quantity, requested_by, order_id,
      product_code_snapshot, product_name_snapshot, product_unit_snapshot,
      product_weight_kg_snapshot, product_category_name_snapshot, ownership_auto_snapshot
    ) values (
      p_site_id, v_item.product_id, v_item.requested_quantity, auth.uid()::text, v_order_id,
      v_product_code, v_product_name, v_product_unit,
      v_product_weight_kg, v_product_category_name, v_ownership_auto
    )
    returning id into request_id;

    order_id := v_order_id;
    product_id := v_item.product_id;
    quantity := v_item.requested_quantity;
    v_item_count := v_item_count + 1;
    return next;
  end loop;

  if v_item_count = 0 then
    raise exception 'invalid_order_items';
  end if;
end;
$$;

comment on function public.create_order_with_requests(uuid, jsonb, timestamptz) is
  'vendor が自分の担当現場に対して、オーダーと複数の出庫依頼明細を原子的に作成する。'
  ' 納期（p_delivery_deadline）は職人がオーダー時に入力する（D-20260805-01 #1）。'
  ' 現場名・発注者名・商品情報・自社/リース自動判定はこの時点の値を固定して保存する（D-20260805-10）。P1-E';

-- ===========================================================================
-- 4) add_order_item: 追加時にも商品情報のスナップショットを書き込む
--    シグネチャは 062 から不変のため drop 不要。本体のみ更新する。
-- ===========================================================================
create or replace function public.add_order_item(
  p_order_id   uuid,
  p_product_id uuid,
  p_quantity   numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site_id uuid;
  v_request_id uuid;
  v_product_code text;
  v_product_name text;
  v_product_unit text;
  v_product_weight_kg numeric(12, 3);
  v_product_category_name text;
  v_ownership_auto text;
begin
  if not public.is_admin_or_center() then
    raise exception 'permission_denied: admin or center role required'
      using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity';
  end if;

  select site_id into v_site_id
    from public.orders
   where id = p_order_id;

  if not found then
    raise exception 'order_not_found';
  end if;

  select p.code, p.name, p.unit, p.weight_kg, pc.name
    into v_product_code, v_product_name, v_product_unit,
         v_product_weight_kg, v_product_category_name
    from public.products p
    left join public.product_categories pc on pc.id = p.category_id
   where p.id = p_product_id;

  if not found then
    raise exception 'invalid_product_id';
  end if;

  select pok.ownership_kind into v_ownership_auto
    from public.product_ownership_kind pok
   where pok.product_id = p_product_id;
  v_ownership_auto := coalesce(v_ownership_auto, 'owned');

  insert into public.stock_requests (
    site_id, product_id, quantity, requested_by, order_id,
    product_code_snapshot, product_name_snapshot, product_unit_snapshot,
    product_weight_kg_snapshot, product_category_name_snapshot, ownership_auto_snapshot
  ) values (
    v_site_id, p_product_id, p_quantity, auth.uid()::text, p_order_id,
    v_product_code, v_product_name, v_product_unit,
    v_product_weight_kg, v_product_category_name, v_ownership_auto
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.add_order_item(uuid, uuid, numeric) is
  'admin/center 限定。既存オーダーに出庫依頼明細を追加する。'
  ' センターが紙に手書きした追加分を事務が登録する運用のため（D-20260805-03 ⑤(b)）。'
  ' 追加時点の商品情報・自社/リース自動判定を固定して保存する（D-20260805-10）。P1-E';

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) 列が増えていること
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='orders' and column_name like '%snapshot%';
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='stock_requests' and column_name like '%snapshot%';
--
-- -- (b) 適用後に新規登録したオーダーでスナップショット列が埋まっていること
-- select order_number, site_name_snapshot, requester_label_snapshot
--   from public.orders order by created_at desc limit 5;
-- select product_name_snapshot, product_code_snapshot, ownership_auto_snapshot
--   from public.stock_requests order by created_at desc limit 5;
--
-- -- (c) 過去のオーダーはスナップショットが NULL のままであること（対象外の確認）
-- select count(*) from public.orders where site_name_snapshot is null;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
-- -- 3), 4) を 065 適用後時点の本体に戻す（060, 062 を再実行すること）
-- alter table public.stock_requests drop column if exists ownership_auto_snapshot;
-- alter table public.stock_requests drop column if exists product_category_name_snapshot;
-- alter table public.stock_requests drop column if exists product_weight_kg_snapshot;
-- alter table public.stock_requests drop column if exists product_unit_snapshot;
-- alter table public.stock_requests drop column if exists product_name_snapshot;
-- alter table public.stock_requests drop column if exists product_code_snapshot;
-- alter table public.orders drop column if exists requester_label_snapshot;
-- alter table public.orders drop column if exists site_name_snapshot;
-- commit;
-- notify pgrst, 'reload schema';
