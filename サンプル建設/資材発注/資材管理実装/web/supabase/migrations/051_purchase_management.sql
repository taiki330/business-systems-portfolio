-- 051_purchase_management.sql
-- 050 適用後に Supabase SQL Editor で実行
-- 仕入れ管理（B案）: 独立した購入記録機能
--
-- 背景（ヒアリング要旨・クラスクリエート11.txt / 本州3.txt）:
--   - 既存の「入出庫登録」に理由を足すのではなく、別機能として作ることが明確に望まれた
--     （「入庫はこっち業務メニューなんでちょっと違う」「別の方がいい」）。
--   - 発注記録は不要。購入日・材料・数量・仕入先を、入荷した時点でのみ記録する
--     （発注→入荷の2段階管理は求められていない。分納の概念も存在しない）。
--   - 金額は現時点で不要。仕入れの入力は事務のみが行い、他ロールは一切触らせたくないという
--     明確な意向がある（センター・現場には見せる必要も無い）。
--   - 仕入先とリース会社が同一企業になることがある（「リース会社から購入することとかって
--     ないですか？」「あります」）。ただし lease_companies はリース業務専用の設計であり、
--     契約・返却期限などリース固有の概念に依存させたくないため、統合はせず
--     suppliers を独立テーブルとして新設する（同一企業は両方に登録すればよい）。
--   - 発注単位と在庫単位の換算、現場直送、返品・不良返却はいずれも「ない」と明言された。
--   - 発注書等の帳票は不要。一覧参照とExcel（CSV）出力があれば足りるとのこと。
--
-- 方針:
--   - suppliers（仕入先マスタ）: lease_companies（028/029）と同じ最小構成（name/note/is_active）。
--     参照・書込とも admin のみ（center/vendor には一切見せない。ヒアリングの明確な意向）。
--   - stock_purchases（購入記録）: 1 購入 = 1 行の追記専用テーブル（stock_returns と同方針）。
--     ヘッダー・明細に分けるほどの複雑さ（同一伝票内の複数品目等）は要望されていないため作らない。
--   - register_stock_purchase RPC は admin 限定。apply_stock_movement（is_center() 限定）は
--     呼ばず、adjust_stock_item（037）と同じく自己完結で在庫更新・台帳記録を行う
--     （ロール前提が異なる関数を無理に共用しない）。
--   - stock_ledger.reason に 'purchase' を記録し、仕入れによる入庫であることを区別できるようにする
--     （既存の reason 列は 037 で自由記述として追加済みで、CHECK 制約は無い）。
--   - 訂正・取消 RPC は用意しない。誤入力時は既存の在庫調整（申請 or 直接補正）で数量を是正する
--     運用とする（仕入れ自体は事務の単独操作であり、承認フローは要望されていないため）。
--   - suppliers のマスタ変更・stock_purchases の登録は operation_logs に記録する。
--     043 の CHECK 制約（operation / entity_type）に新しい値を追加し、
--     tg_operation_log_master（044）に suppliers 用の分岐を追加する。
--
-- 冪等性: create table if not exists / create or replace function /
--         drop policy if exists / drop constraint + add constraint。再実行しても安全。

begin;

-- ===========================================================================
-- 1) suppliers（仕入先マスタ）
-- ===========================================================================
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.suppliers is
  '仕入先マスタ。lease_companies とは無関係の独立テーブル（同一企業なら両方に登録する）。'
  ' 参照・書込とも admin 限定（ヒアリングにより center/vendor には見せない）。';
comment on column public.suppliers.note is '備考（自由記述・任意）';
comment on column public.suppliers.is_active is
  'false で新規の仕入れ登録の選択肢から外す（既存の購入記録は残る）';

create index if not exists suppliers_active_name_idx
  on public.suppliers (is_active, name);

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

alter table public.suppliers enable row level security;

revoke all on table public.suppliers from public, anon, authenticated;
grant select, insert, update, delete on table public.suppliers to authenticated;

drop policy if exists "suppliers_admin_select" on public.suppliers;
drop policy if exists "suppliers_admin_insert" on public.suppliers;
drop policy if exists "suppliers_admin_update" on public.suppliers;
drop policy if exists "suppliers_admin_delete" on public.suppliers;

create policy "suppliers_admin_select"
  on public.suppliers for select to authenticated
  using (public.is_admin());

create policy "suppliers_admin_insert"
  on public.suppliers for insert to authenticated
  with check (public.is_admin());

create policy "suppliers_admin_update"
  on public.suppliers for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "suppliers_admin_delete"
  on public.suppliers for delete to authenticated
  using (public.is_admin());

-- ===========================================================================
-- 2) stock_purchases（購入記録・追記専用）
-- ===========================================================================
create table if not exists public.stock_purchases (
  id uuid primary key default gen_random_uuid(),

  product_id  uuid not null references public.products (id) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,

  quantity      numeric(12, 2) not null check (quantity > 0),
  purchase_date date not null,
  note          text,

  -- この購入で center 在庫に加算した際の台帳行（追跡用）
  ledger_id  uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);

comment on table public.stock_purchases is
  '購入（仕入れ）記録。入荷時点でのみ記録する（発注段階は管理しない）。追記専用。'
  ' 在庫は常にセンターへ加算される（現場直送はない）。';
comment on column public.stock_purchases.purchase_date is
  '購入（入荷）日。将来日は不可';

create index if not exists stock_purchases_purchase_date_idx
  on public.stock_purchases (purchase_date desc);
create index if not exists stock_purchases_product_idx
  on public.stock_purchases (product_id, purchase_date desc);
create index if not exists stock_purchases_supplier_idx
  on public.stock_purchases (supplier_id, purchase_date desc);

alter table public.stock_purchases enable row level security;

revoke all on table public.stock_purchases from public, anon, authenticated;
grant select on table public.stock_purchases to authenticated;

drop policy if exists "stock_purchases_admin_select" on public.stock_purchases;
create policy "stock_purchases_admin_select"
  on public.stock_purchases for select to authenticated
  using (public.is_admin());

-- ===========================================================================
-- 3) register_stock_purchase: 購入登録（admin のみ）
--    center 在庫へ加算し、stock_ledger に reason='purchase' で記録する。
-- ===========================================================================
create or replace function public.register_stock_purchase(
  p_product_id    uuid,
  p_supplier_id   uuid,
  p_quantity      numeric,
  p_purchase_date date,
  p_note          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase_id uuid;
  v_ledger_id   uuid;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  if p_purchase_date is null then
    raise exception 'purchase_date_required';
  end if;
  if p_purchase_date > (timezone('Asia/Tokyo', now()))::date then
    raise exception 'future_date_not_allowed';
  end if;

  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id) then
    raise exception 'supplier_not_found';
  end if;

  -- ---- center 在庫へ加算（apply_stock_movement は is_center() 限定のため使わず、
  --      adjust_stock_item（037）と同じく自己完結で更新する） ----
  insert into public.stock_items (product_id, location, quantity)
  values (p_product_id, 'center', 0)
  on conflict (product_id, location) do nothing;

  update public.stock_items
     set quantity = quantity + p_quantity
   where product_id = p_product_id
     and location    = 'center';

  insert into public.stock_ledger (
    product_id, location, movement_type, quantity, site_id, created_by, reason
  )
  values (
    p_product_id, 'center', 'in', p_quantity, null, public.current_actor_id(), 'purchase'
  )
  returning id into v_ledger_id;

  insert into public.stock_purchases (
    product_id, supplier_id, quantity, purchase_date, note, ledger_id, created_by
  )
  values (
    p_product_id, p_supplier_id, p_quantity, p_purchase_date,
    nullif(trim(p_note), ''), v_ledger_id, public.current_actor_id()
  )
  returning id into v_purchase_id;

  perform public.log_operation(
    'stock_purchase.created', 'stock_purchase', v_purchase_id,
    null, p_product_id, p_quantity,
    jsonb_build_object(
      'supplier_id',   p_supplier_id,
      'purchase_date', p_purchase_date,
      'ledger_id',     v_ledger_id
    )
  );

  return v_purchase_id;
end;
$$;

comment on function public.register_stock_purchase is
  '仕入れを登録し、center 在庫へ加算する（admin のみ）。stock_ledger.reason=''purchase'' で区別する。';

revoke execute on function public.register_stock_purchase(uuid, uuid, numeric, date, text) from public;
revoke execute on function public.register_stock_purchase(uuid, uuid, numeric, date, text) from anon;
grant  execute on function public.register_stock_purchase(uuid, uuid, numeric, date, text) to authenticated;

-- ===========================================================================
-- 4) operation_logs: 新しい operation / entity_type 値を許可する
-- ===========================================================================
alter table public.operation_logs
  drop constraint if exists operation_logs_operation_check;

alter table public.operation_logs
  add constraint operation_logs_operation_check
  check (operation in (
    'stock.moved',
    'stock.adjusted',
    'stock_adjustment.requested',
    'stock_adjustment.approved',
    'stock_adjustment.rejected',
    'stock_request.created',
    'stock_request.accepted',
    'stock_request.shipped',
    'stock_request.cancelled',
    'stock_return.created',
    'lease_return.created',
    'over_return.created',
    'over_return.confirmed',
    'product.created',
    'product.updated',
    'product.deleted',
    'site.created',
    'site.updated',
    'site.deleted',
    'user_role.changed',
    'site_progress.assembly_completed',
    'site_progress.dismantle_started',
    'site_progress.dismantle_completed',
    'order.created',
    'order.updated',
    'order.deleted',
    'slip.created',
    'slip.updated',
    'slip.deleted',
    -- 仕入れ管理
    'supplier.created',
    'supplier.updated',
    'supplier.deleted',
    'stock_purchase.created'
  ));

alter table public.operation_logs
  drop constraint if exists operation_logs_entity_type_check;

alter table public.operation_logs
  add constraint operation_logs_entity_type_check
  check (entity_type in (
    'stock', 'stock_adjustment', 'stock_request', 'stock_return',
    'lease_return', 'over_return', 'product', 'site', 'app_user',
    'site_progress', 'order', 'slip',
    'supplier', 'stock_purchase'
  ));

-- ===========================================================================
-- 5) suppliers のマスタ変更をトリガーで記録する（043/044 と同じ仕組みに合流する）
-- ===========================================================================
create or replace function public.tg_operation_log_master()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity_type text;
  v_operation   text;
  v_entity_id   uuid;
  v_site_id     uuid;
  v_product_id  uuid;
  v_detail      jsonb;
  v_row         jsonb;
begin
  if tg_op = 'DELETE' then
    v_row    := to_jsonb(old);
    v_detail := jsonb_build_object('before', to_jsonb(old));
  elsif tg_op = 'INSERT' then
    v_row    := to_jsonb(new);
    v_detail := jsonb_build_object('after', to_jsonb(new));
  else
    v_row    := to_jsonb(new);
    v_detail := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
  end if;

  v_entity_id := (v_row ->> 'id')::uuid;

  if tg_table_name = 'products' then
    v_entity_type := 'product';
    v_product_id  := v_entity_id;
    v_operation   := case tg_op
                       when 'INSERT' then 'product.created'
                       when 'UPDATE' then 'product.updated'
                       else 'product.deleted'
                     end;

  elsif tg_table_name = 'sites' then
    v_entity_type := 'site';
    v_site_id     := v_entity_id;
    v_operation   := case tg_op
                       when 'INSERT' then 'site.created'
                       when 'UPDATE' then 'site.updated'
                       else 'site.deleted'
                     end;

  elsif tg_table_name = 'app_users' then
    if tg_op = 'UPDATE'
       and new.role      is not distinct from old.role
       and new.vendor_id is not distinct from old.vendor_id then
      return null;
    end if;

    v_entity_type := 'app_user';
    v_operation   := 'user_role.changed';

  elsif tg_table_name = 'suppliers' then
    v_entity_type := 'supplier';
    v_operation   := case tg_op
                       when 'INSERT' then 'supplier.created'
                       when 'UPDATE' then 'supplier.updated'
                       else 'supplier.deleted'
                     end;

  else
    return null;
  end if;

  perform public.log_operation(
    v_operation, v_entity_type, v_entity_id,
    v_site_id, v_product_id, null, v_detail
  );

  return null;
end;
$$;

comment on function public.tg_operation_log_master is
  'products / sites / app_users / suppliers の変更を operation_logs へ記録する AFTER トリガ関数。';

drop trigger if exists suppliers_operation_log on public.suppliers;
create trigger suppliers_operation_log
  after insert or update or delete on public.suppliers
  for each row execute function public.tg_operation_log_master();

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) suppliers / stock_purchases が admin のみ参照できること
-- select tablename, policyname, cmd from pg_policies
--  where schemaname='public' and tablename in ('suppliers','stock_purchases')
--  order by tablename, cmd;
-- select grantee, privilege_type from information_schema.table_privileges
--  where table_schema='public' and table_name in ('suppliers','stock_purchases')
--  order by table_name, grantee;
-- -- 期待: authenticated は SELECT のみ、anon は 0 行（suppliers は INSERT/UPDATE/DELETE も
-- --       authenticated に付与されているが RLS が admin 以外を弾く）
--
-- -- (b) 購入登録で在庫が加算され、reason='purchase' で記録されること（admin で実行）
-- -- select public.register_stock_purchase('<product_id>', '<supplier_id>', 100, current_date, 'テスト仕入れ');
-- -- select quantity from public.stock_items where product_id='<product_id>' and location='center';
-- -- select reason, movement_type, quantity from public.stock_ledger order by created_at desc limit 1;
--
-- -- (c) center / vendor が仕入先・購入記録に触れないこと（各アカウントで確認）
--
-- -- (d) 操作履歴に記録されること
-- select operation, entity_type, actor_role, quantity, detail
--   from public.operation_logs
--  where operation in ('supplier.created','stock_purchase.created')
--  order by created_at desc limit 5;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合）
-- ---------------------------------------------------------------------------
-- begin;
-- drop trigger if exists suppliers_operation_log on public.suppliers;
-- -- tg_operation_log_master は 044 の定義に戻す（suppliers 分岐を除いたもの）
-- alter table public.operation_logs drop constraint if exists operation_logs_operation_check;
-- alter table public.operation_logs drop constraint if exists operation_logs_entity_type_check;
-- -- 043 時点の CHECK 定義を再実行して戻すこと（本ファイル冒頭の一覧から仕入れ関連4値を除く）
-- drop function if exists public.register_stock_purchase(uuid, uuid, numeric, date, text);
-- drop policy if exists "stock_purchases_admin_select" on public.stock_purchases;
-- drop table if exists public.stock_purchases;
-- drop policy if exists "suppliers_admin_select" on public.suppliers;
-- drop policy if exists "suppliers_admin_insert" on public.suppliers;
-- drop policy if exists "suppliers_admin_update" on public.suppliers;
-- drop policy if exists "suppliers_admin_delete" on public.suppliers;
-- drop table if exists public.suppliers;
-- commit;
-- notify pgrst, 'reload schema';
