-- 090_p4_center_transfers.sql
-- 089 適用後に Supabase SQL Editor で実行
-- Phase P4-2: センター間移動（例: サンプル市A→サンプル市B）
-- 設計: docs/22_P4_地域センター管理_設計整理.md §4-5 / ユーザー回答（2026-08-19）
--
-- 決定事項:
--   - 起票はセンターロールのみ。自分のセンター（from）から他センター（to）への移動だけを登録できる
--   - 登録と同時に即時反映（移動元マイナス・移動先プラス）。事務の承認は不要（記録の閲覧のみ）
--   - 移動元センターの在庫が不足していてもブロックしない。警告のみ（半端もん判定と同じ「警告のみ」方針）。
--     不足分は center_transfer_items.shortage_quantity に記録し、画面側で警告表示する
--   - 記録は資材発注書と同じ「ヘッダー＋複数明細」形式（center_transfers / center_transfer_items）
--   - 既存の apply_stock_movement は再利用しない（insufficient_stock でブロックする実装のため、
--     警告のみで許可する本機能の要件と矛盾する）。OUT/IN は本migration内で直接実装する
--
-- 冪等性: create table if not exists / create or replace / drop policy if exists → create。

begin;

-- ===========================================================================
-- 1) center_transfers（ヘッダー）/ center_transfer_items（明細）
-- ===========================================================================
create table if not exists public.center_transfers (
  id uuid primary key default gen_random_uuid(),
  from_center_id uuid not null references public.centers (id),
  to_center_id uuid not null references public.centers (id),
  transferred_by uuid references public.app_users (id),
  note text,
  created_at timestamptz not null default now(),
  constraint center_transfers_distinct_centers check (from_center_id <> to_center_id)
);

comment on table public.center_transfers is
  'センター間移動のヘッダー（例: サンプル市A→サンプル市B）。センターロールが起票し、登録と同時に在庫へ即時反映する。P4-2';

create index if not exists center_transfers_from_center_id_idx on public.center_transfers (from_center_id);
create index if not exists center_transfers_to_center_id_idx on public.center_transfers (to_center_id);

create table if not exists public.center_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.center_transfers (id) on delete cascade,
  product_id uuid not null references public.products (id),
  quantity numeric(12, 2) not null check (quantity > 0),
  -- 移動元センターの、この明細を反映する直前の在庫数量（不足判定の記録用）
  stock_before_quantity numeric(12, 2) not null,
  -- 不足していた数量（0=不足なし）。警告のみで登録・反映は妨げない
  shortage_quantity numeric(12, 2) not null default 0 check (shortage_quantity >= 0),
  product_code_snapshot text,
  product_name_snapshot text,
  product_unit_snapshot text,
  created_at timestamptz not null default now()
);

comment on table public.center_transfer_items is
  'センター間移動の明細（複数商品）。登録時点の商品名・コード・単位を固定保存する（マスタ変更の影響を受けない）。P4-2';
comment on column public.center_transfer_items.shortage_quantity is
  '移動元センターの在庫が不足していた数量。0より大きい場合は警告表示の対象（登録・反映はブロックしない）';

create index if not exists center_transfer_items_transfer_id_idx on public.center_transfer_items (transfer_id);
create index if not exists center_transfer_items_product_id_idx on public.center_transfer_items (product_id);

-- ===========================================================================
-- 2) RLS: 追記専用ログとして扱う（update/delete policyは作らない＝フェイルクローズ）
--    - admin: 全件参照
--    - center: 自分のセンターが from または to になっている行のみ参照
--    - insert は create_center_transfer() RPC 経由のみ（テーブル直接 insert は許可しない）
-- ===========================================================================
alter table public.center_transfers enable row level security;
alter table public.center_transfer_items enable row level security;

drop policy if exists "center_transfers_admin_select" on public.center_transfers;
create policy "center_transfers_admin_select" on public.center_transfers for select to authenticated
  using (public.is_admin());

drop policy if exists "center_transfers_center_select" on public.center_transfers;
create policy "center_transfers_center_select" on public.center_transfers for select to authenticated
  using (
    public.current_app_role() = 'center'
    and (from_center_id = public.current_center_id() or to_center_id = public.current_center_id())
  );

drop policy if exists "center_transfer_items_admin_select" on public.center_transfer_items;
create policy "center_transfer_items_admin_select" on public.center_transfer_items for select to authenticated
  using (public.is_admin());

drop policy if exists "center_transfer_items_center_select" on public.center_transfer_items;
create policy "center_transfer_items_center_select" on public.center_transfer_items for select to authenticated
  using (
    public.current_app_role() = 'center'
    and exists (
      select 1 from public.center_transfers ct
       where ct.id = center_transfer_items.transfer_id
         and (ct.from_center_id = public.current_center_id() or ct.to_center_id = public.current_center_id())
    )
  );

revoke all privileges on table public.center_transfers from anon;
revoke all privileges on table public.center_transfer_items from anon;
grant select on table public.center_transfers to authenticated;
grant select on table public.center_transfer_items to authenticated;

-- ===========================================================================
-- 3) create_center_transfer(): センター間移動の登録 + 即時在庫反映（1トランザクション）
-- ===========================================================================
create or replace function public.create_center_transfer(
  p_to_center_id uuid,
  p_items jsonb,
  p_note text default null
)
returns table (
  transfer_id uuid,
  item_id uuid,
  product_id uuid,
  quantity numeric,
  shortage_quantity numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from_center_id uuid;
  v_from_location text;
  v_to_location text;
  v_transfer_id uuid;
  v_item record;
  v_item_count integer := 0;
  v_product_code text;
  v_product_name text;
  v_product_unit text;
  v_stock_before numeric(12, 2);
  v_shortage numeric(12, 2);
  v_item_id uuid;
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  v_from_center_id := public.current_center_id();
  if v_from_center_id is null then
    raise exception 'center_account_required';
  end if;

  if p_to_center_id is null or not exists (select 1 from public.centers where id = p_to_center_id) then
    raise exception 'invalid_to_center';
  end if;

  if p_to_center_id = v_from_center_id then
    raise exception 'same_center_transfer_not_allowed';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_transfer_items';
  end if;

  v_from_location := public.center_stock_location(v_from_center_id);
  v_to_location := public.center_stock_location(p_to_center_id);

  insert into public.center_transfers (from_center_id, to_center_id, transferred_by, note)
  values (v_from_center_id, p_to_center_id, public.current_actor_id(), nullif(btrim(p_note), ''))
  returning id into v_transfer_id;

  for v_item in
    select item.product_id, sum(item.quantity) as move_quantity
      from jsonb_to_recordset(p_items) as item(product_id uuid, quantity numeric)
     group by item.product_id
  loop
    if v_item.product_id is null or v_item.move_quantity is null or v_item.move_quantity <= 0 then
      raise exception 'invalid_quantity';
    end if;

    select p.code, p.name, p.unit
      into v_product_code, v_product_name, v_product_unit
      from public.products p
     where p.id = v_item.product_id;

    if not found then
      raise exception 'invalid_product_id';
    end if;

    -- 移動元センター行が無ければ作成（apply_stock_movement の自動作成と同じ流儀）
    insert into public.stock_items (product_id, location, storage_kind, center_id, quantity)
    values (v_item.product_id, v_from_location, 'center', v_from_center_id, 0)
    on conflict (product_id, location) do nothing;

    select quantity into v_stock_before
      from public.stock_items
     where product_id = v_item.product_id and location = v_from_location
     for update;

    -- 警告のみで許可する（半端もん判定と同じ方針）。マイナス在庫を許容する
    v_shortage := greatest(0, v_item.move_quantity - v_stock_before);

    update public.stock_items
       set quantity = quantity - v_item.move_quantity
     where product_id = v_item.product_id and location = v_from_location;

    insert into public.stock_ledger (product_id, location, movement_type, quantity, created_by)
    values (v_item.product_id, v_from_location, 'out', v_item.move_quantity, public.current_actor_id());

    -- 移動先センター行が無ければ作成
    insert into public.stock_items (product_id, location, storage_kind, center_id, quantity)
    values (v_item.product_id, v_to_location, 'center', p_to_center_id, 0)
    on conflict (product_id, location) do nothing;

    update public.stock_items
       set quantity = quantity + v_item.move_quantity
     where product_id = v_item.product_id and location = v_to_location;

    insert into public.stock_ledger (product_id, location, movement_type, quantity, created_by)
    values (v_item.product_id, v_to_location, 'in', v_item.move_quantity, public.current_actor_id());

    insert into public.center_transfer_items (
      transfer_id, product_id, quantity, stock_before_quantity, shortage_quantity,
      product_code_snapshot, product_name_snapshot, product_unit_snapshot
    ) values (
      v_transfer_id, v_item.product_id, v_item.move_quantity, v_stock_before, v_shortage,
      v_product_code, v_product_name, v_product_unit
    )
    returning id into v_item_id;

    transfer_id := v_transfer_id;
    item_id := v_item_id;
    product_id := v_item.product_id;
    quantity := v_item.move_quantity;
    shortage_quantity := v_shortage;
    v_item_count := v_item_count + 1;
    return next;
  end loop;

  if v_item_count = 0 then
    raise exception 'invalid_transfer_items';
  end if;
end;
$$;

comment on function public.create_center_transfer(uuid, jsonb, text) is
  'センターロールが自分のセンターから他センターへ資材を移動する。登録と同時に移動元マイナス・移動先プラスを'
  ' 1トランザクションで即時反映する。在庫不足はブロックせず shortage_quantity に記録して警告のみとする。'
  ' 事務・センター（from/to）は結果を参照できるが、承認や取消の概念は持たない（記録のみ）。P4-2';

revoke execute on function public.create_center_transfer(uuid, jsonb, text) from public, anon;
grant execute on function public.create_center_transfer(uuid, jsonb, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) テーブル・制約の存在確認
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid in ('public.center_transfers'::regclass, 'public.center_transfer_items'::regclass);
--
-- -- (b) RLS policy の存在確認（update/delete が無いこと＝フェイルクローズ）
-- select tablename, policyname, cmd
--   from pg_policies
--  where schemaname='public' and tablename in ('center_transfers','center_transfer_items')
--  order by tablename, cmd;
-- -- 期待: cmd はいずれも SELECT のみ
--
-- -- (c) RPC の EXECUTE 権限（authenticated のみ）
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='create_center_transfer'
--    and grantee in ('anon','authenticated','public');
--
-- -- (d) 動作確認（センターロールでログインして実行）
-- -- select * from public.create_center_transfer(
-- --   '<移動先 centers.id>',
-- --   '[{"product_id":"<product uuid>","quantity":10}]'::jsonb,
-- --   'テスト移動'
-- -- );

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.create_center_transfer(uuid, jsonb, text);
-- drop policy if exists "center_transfer_items_center_select" on public.center_transfer_items;
-- drop policy if exists "center_transfer_items_admin_select" on public.center_transfer_items;
-- drop policy if exists "center_transfers_center_select" on public.center_transfers;
-- drop policy if exists "center_transfers_admin_select" on public.center_transfers;
-- drop table if exists public.center_transfer_items;
-- drop table if exists public.center_transfers;
-- commit;
-- notify pgrst, 'reload schema';
