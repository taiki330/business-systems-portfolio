-- 073_p8_vendor_yard_loading_date.sql
-- 072 適用後に Supabase SQL Editor で実行
--
-- ヤード積込日を、現場（vendor）がオーダー登録時に入力する必須項目にする。
-- 059/060/D-20260806-06 の「センターが確認時に入力」から方針変更
-- （ヒアリング「レコーディング(9)」にて「ヤード積み込みは希望の日付を職人が入れてくる」
--  「入力は職人」と確認。docs/20 に D-20260806-08 として追記）。
--
-- 方針:
--   - create_order_with_requests に p_yard_loading_date を追加し、登録時点で
--     orders.yard_loading_date を直接設定する。
--   - center の書き込み例外（prevent_center_data_changes / update_order_yard_loading_date、
--     071・072）はそのまま残す。現場の入力ミスを事務・センターが後から訂正できるように
--     するための経路として維持する（廃止の指示は無い）。
--   - 必須チェックは delivery_deadline と同じ既存方針に合わせ、アプリ層（Server Action）
--     でのみ行う。DB 列は NOT NULL 化しない（過去データとの一貫性のため）。
--   - 引数が変わるため、060 と同じやり方で旧シグネチャを drop してから作り直す。

begin;

drop function if exists public.create_order_with_requests(uuid, jsonb, timestamptz);

create or replace function public.create_order_with_requests(
  p_site_id uuid,
  p_items jsonb,
  p_delivery_deadline timestamptz default null,
  p_yard_loading_date date default null
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
    site_id, requested_by, delivery_deadline, yard_loading_date,
    site_name_snapshot, requester_label_snapshot
  )
  values (
    p_site_id, auth.uid()::text, p_delivery_deadline, p_yard_loading_date,
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

comment on function public.create_order_with_requests(uuid, jsonb, timestamptz, date) is
  'vendor が自分の担当現場に対して、オーダーと複数の出庫依頼明細を原子的に作成する。'
  ' 納期（p_delivery_deadline）とヤード積込日（p_yard_loading_date）は職人がオーダー時に入力する'
  '（納期: D-20260805-01 #1 / ヤード積込日: D-20260806-08 が D-20260806-06 を上書き）。'
  ' 現場名・発注者名・商品情報・自社/リース自動判定はこの時点の値を固定して保存する（D-20260805-10）。P1-E';

revoke execute on function public.create_order_with_requests(uuid, jsonb, timestamptz, date) from public;
revoke execute on function public.create_order_with_requests(uuid, jsonb, timestamptz, date) from anon;
grant execute on function public.create_order_with_requests(uuid, jsonb, timestamptz, date) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select order_number, delivery_deadline, yard_loading_date
--   from public.orders order by created_at desc limit 5;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合）
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.create_order_with_requests(uuid, jsonb, timestamptz, date);
-- -- 066 の create_order_with_requests 本体（p_yard_loading_date なし）を再実行すること
-- commit;
-- notify pgrst, 'reload schema';
