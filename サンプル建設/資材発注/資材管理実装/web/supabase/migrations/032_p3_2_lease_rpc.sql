-- 032_p3_2_lease_rpc.sql
-- 031 適用後に Supabase SQL Editor で実行
-- Phase 3-2/3-3/3-4/3-5: リース借用の作成・承認・受入・移動・返却 RPC
--
-- 方針:
--   - リース在庫の更新経路は本ファイルの SECURITY DEFINER RPC のみ。
--     lease_stock_items / lease_stock_ledger / lease_batches(承認後) / lease_batch_items(承認後) は
--     直接 INSERT/UPDATE できない（030/031 の RLS）ため、Server Action からの直接操作は必ず失敗する
--     （フェイルクローズ）。
--
--   - コードレビュー指摘への対応（本ファイルでの変更点）:
--     [Critical #2] create_lease_batch: ヘッダー＋明細の作成を単一 RPC・単一トランザクションに統一。
--       リース会社の有効性・明細0件・数量・(商品,返却期限)の重複を検証する。
--       失敗時は例外により関数全体がロールバックされるため、
--       「ヘッダー作成後に明細が失敗したら補償削除する」というクライアント側の後始末処理は廃止した。
--     [Critical #3] 全 RPC でロック順序を「伝票(lease_batches) → 明細(lease_batch_items) →
--       在庫明細(lease_stock_items)」に統一する。明細 id だけを受け取る RPC は、
--       まず明細から所属伝票 id を検索し（ロック無し）、伝票行を FOR UPDATE してから
--       改めて明細行を FOR UPDATE する。これにより受入とキャンセルの競合を防止する
--       （両者とも先に伝票行のロックを取り合うため、後勝ちが必ず最新状態を見て判定する）。
--     [Critical #4] 部分受入・返却残の是正。返却義務残は
--       received_quantity - returned_quantity（生成列 return_obligation_quantity, 030）。
--       未受入分は返却対象にしない（return_lease_to_company は return_obligation_quantity を上限とする）。
--       close_lease_batch_item_receiving を追加し、未受入のまま受入を終了する場合に
--       理由・操作者・日時を記録する。完了判定（refresh_lease_batch_status）も
--       「受入完了（数量到達 or 受入終了）×返却義務残ゼロ」の実受入数基準に修正した。
--     [Critical #7] 状態遷移をロック取得後の許容リスト（allowlist）で一元判定する。
--       closed / cancelled 後はどの操作 RPC からも弾かれる（許容リストに含めない）。
--     [Critical #8] 冪等性。全ての状態変更 RPC・create_lease_batch は
--       p_operation_id uuid を必須引数として取る（NULL なら operation_id_required 例外）。
--       lease_operations に operation_id / operation_type / actor_id / target_id を記録し、
--       同一キーの再送は「操作種別・操作者・対象がすべて一致する場合」のみ二重処理せず
--       前回結果を返す。いずれかが異なる場合は operation_id_conflict で拒否する
--       （operation_id の使い回し・別ユーザーでの誤送信を検出する）。
--       同時実行時は INSERT の行ロック待ちにより自然に直列化される。
--     [レビュー再指摘 #1] 旧シグネチャ（p_operation_id が無い版。本ファイルの初回ドラフト時点の
--       1引数少ないシグネチャ）を明示的に DROP FUNCTION する。create or replace は
--       「引数の型並びが完全一致」の場合のみ既存定義を置き換えるため、型の個数が異なる
--       旧シグネチャが残っている環境では新旧の関数が併存してしまう
--       （PostgREST 等が古い実装を呼び続けるリスク）。DROP は IF EXISTS のため、
--       旧シグネチャが存在しない環境（初回適用）でもエラーにならず安全に実行できる。
--       一方、本ラウンドで型シグネチャ自体は変えていない関数（p_operation_id の
--       default null を外しただけのもの）は create or replace のままで安全に更新される
--       （型シグネチャが同一なので drop は不要かつ、既存関数が無い場合でも create or replace は
--       新規作成として働く）。
--     [Medium] 非アクティブなリース会社は create_lease_batch / approve_lease_batch で使用不可にする。
--
--   - 返却経路は「現場 → センター → リース会社」のみ（確定事項）。
--     現場から直接リース会社へ返却する RPC は用意しない。
--   - すべて 026 のヘルパー関数（is_admin / is_center）を参照し、role 文字列を直接書かない。
--
-- 冪等性: drop function if exists（旧シグネチャのみ）→ create or replace function / create table if not exists。
--         再実行しても安全。

begin;

-- ===========================================================================
-- -1) 旧シグネチャの明示的な削除（レビュー再指摘 #1）
--     p_operation_id を持たない、本ファイルの初回ドラフト時点のシグネチャを削除する。
--     新シグネチャの create（下記）より必ず前に実行すること。
-- ===========================================================================
drop function if exists public.approve_lease_batch(uuid);
drop function if exists public.cancel_lease_batch(uuid);
drop function if exists public.receive_lease_batch_item(uuid, numeric);
drop function if exists public.ship_lease_stock_to_site(uuid, uuid, numeric);
drop function if exists public.return_lease_stock_from_site(uuid, uuid, numeric);
drop function if exists public.return_lease_to_company(uuid, numeric);
-- create_lease_batch / close_lease_batch_item_receiving は本ファイルで新規追加のため
-- 旧シグネチャは存在しないが、念のため p_operation_id 無し版も削除しておく（IF EXISTS のため無害）。
drop function if exists public.create_lease_batch(uuid, text, date, text, uuid, text, jsonb);
drop function if exists public.close_lease_batch_item_receiving(uuid, text);

-- ===========================================================================
-- 0) 冪等性台帳（lease_operations）
--    直接の SELECT/INSERT 権限は誰にも付与しない。SECURITY DEFINER RPC からのみ操作される。
--    operation_id ごとに「操作種別・操作者・対象」を記録し、再送時の一致検証に使う。
-- ===========================================================================
drop table if exists public.lease_operations;

create table public.lease_operations (
  operation_id    uuid primary key,
  operation_type  text not null,
  actor_id        uuid,
  target_id       uuid,
  result_id       uuid,
  created_at      timestamptz not null default now()
);

comment on table public.lease_operations is
  'リース操作の冪等性台帳。operation_id の再送を検出し二重処理を防止する。'
  ' operation_type/actor_id/target_id がすべて一致する再送のみ前回結果を返し、'
  ' 一部でも異なる場合は operation_id_conflict とする。Phase 3-2（レビュー対応）';
comment on column public.lease_operations.actor_id is '操作を実行したユーザー（app_users.id）';
comment on column public.lease_operations.target_id is
  '操作対象の主キー（create_lease_batch は lease_company_id、'
  ' approve/cancel は lease_batch_id、それ以外は lease_batch_item_id）';
comment on column public.lease_operations.result_id is
  '結果として生成された id（create_lease_batch の場合の lease_batch_id）。それ以外は NULL';

alter table public.lease_operations enable row level security;
-- policy を1つも作らない = 直接アクセスは常に拒否（SECURITY DEFINER RPC のみが読み書きする）

create index if not exists lease_operations_target_idx
  on public.lease_operations (target_id)
  where target_id is not null;

-- ===========================================================================
-- 1) 共通ヘルパー
-- ===========================================================================

create or replace function public.current_actor_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select au.id from public.app_users au where au.id = auth.uid();
$$;

comment on function public.current_actor_id() is
  '操作者の記録用。ログイン中かつ app_users 登録済みなら user_id、それ以外は NULL。Phase 3-2';

-- 借用ヘッダーの status を明細の受入・返却状況から再計算する（実受入数基準）。
-- cancelled / draft は変更しない（承認前・キャンセル済みは業務状態を保持）。
create or replace function public.refresh_lease_batch_status(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status         text;
  v_item_count     integer;
  v_receiving_done integer; -- 受入完了（数量到達 or receiving_closed）の明細数
  v_return_done    integer; -- 返却義務残ゼロの明細数
  v_any_received   integer; -- 1件でも受入がある明細数
begin
  select status into v_status
    from public.lease_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'lease_batch_not_found';
  end if;

  if v_status in ('draft', 'cancelled') then
    return;
  end if;

  select
    count(*),
    count(*) filter (where received_quantity >= quantity or receiving_closed),
    count(*) filter (where return_obligation_quantity <= 0),
    count(*) filter (where received_quantity > 0)
    into v_item_count, v_receiving_done, v_return_done, v_any_received
    from public.lease_batch_items
   where lease_batch_id = p_batch_id;

  if v_item_count = 0 then
    return;
  end if;

  if v_receiving_done = v_item_count and v_return_done = v_item_count then
    update public.lease_batches set status = 'closed' where id = p_batch_id;
  elsif v_receiving_done = v_item_count then
    update public.lease_batches set status = 'received' where id = p_batch_id;
  elsif v_any_received > 0 then
    update public.lease_batches set status = 'receiving' where id = p_batch_id;
  else
    update public.lease_batches set status = 'approved' where id = p_batch_id;
  end if;
end;
$$;

comment on function public.refresh_lease_batch_status is
  '借用ヘッダーの status を実受入数基準で再計算する（draft / cancelled は据え置き）。Phase 3-2';

-- リース在庫の1行を加算/減算し、履歴を追記する内部関数。
-- p_delta > 0 で加算（movement_type='in'）、< 0 で減算（'out'）。
-- 呼び出し元が伝票・明細のロックを保持済みであることを前提とする（ロック順序は呼び出し元が担保）。
create or replace function public.apply_lease_stock_movement(
  p_batch_item_id uuid,
  p_storage_kind  text,
  p_site_id       uuid,
  p_delta         numeric,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_location         text;
  v_product_id       uuid;
  v_lease_company_id uuid;
  v_current          numeric(12, 2);
begin
  if p_delta = 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  if p_storage_kind = 'center' then
    if p_site_id is not null then
      raise exception 'invalid_storage_location';
    end if;
    v_location := 'center';
  elsif p_storage_kind = 'site' then
    if p_site_id is null then
      raise exception 'invalid_storage_location';
    end if;
    v_location := public.site_stock_location(p_site_id);
  else
    raise exception 'invalid_storage_location';
  end if;

  select bi.product_id, b.lease_company_id
    into v_product_id, v_lease_company_id
    from public.lease_batch_items bi
    join public.lease_batches b on b.id = bi.lease_batch_id
   where bi.id = p_batch_item_id;

  if not found then
    raise exception 'lease_batch_item_not_found';
  end if;

  insert into public.lease_stock_items (
    lease_batch_item_id, product_id, lease_company_id,
    storage_kind, site_id, location, quantity
  )
  values (
    p_batch_item_id, v_product_id, v_lease_company_id,
    p_storage_kind, p_site_id, v_location, 0
  )
  on conflict (lease_batch_item_id, location) do nothing;

  select quantity into v_current
    from public.lease_stock_items
   where lease_batch_item_id = p_batch_item_id
     and location            = v_location
   for update;

  if v_current is null then
    raise exception 'lease_stock_item_not_found';
  end if;

  if p_delta < 0 and v_current < abs(p_delta) then
    raise exception 'insufficient_lease_stock';
  end if;

  update public.lease_stock_items
     set quantity = quantity + p_delta
   where lease_batch_item_id = p_batch_item_id
     and location            = v_location;

  insert into public.lease_stock_ledger (
    lease_batch_item_id, product_id, lease_company_id,
    location, site_id, movement_type, reason, quantity, created_by
  )
  values (
    p_batch_item_id, v_product_id, v_lease_company_id,
    v_location, p_site_id,
    case when p_delta > 0 then 'in' else 'out' end,
    p_reason, abs(p_delta), public.current_actor_id()
  );
end;
$$;

comment on function public.apply_lease_stock_movement is
  'リース在庫1行の加減算＋履歴追記（内部用）。呼び出し元 RPC が権限・ロック順序・業務ルールを検証済みであること。Phase 3-2';

revoke execute on function public.apply_lease_stock_movement(uuid, text, uuid, numeric, text) from public;
revoke execute on function public.apply_lease_stock_movement(uuid, text, uuid, numeric, text) from anon;
revoke execute on function public.apply_lease_stock_movement(uuid, text, uuid, numeric, text) from authenticated;

revoke execute on function public.refresh_lease_batch_status(uuid) from public;
revoke execute on function public.refresh_lease_batch_status(uuid) from anon;
revoke execute on function public.refresh_lease_batch_status(uuid) from authenticated;

-- ===========================================================================
-- 2) create_lease_batch: 借用の登録（ヘッダー＋明細を単一トランザクションで作成）
--    admin のみ。p_operation_id は必須。target_id = lease_company_id。
-- ===========================================================================
create or replace function public.create_lease_batch(
  p_lease_company_id uuid,
  p_slip_number      text,
  p_borrowed_at      date,
  p_delivery_kind    text,
  p_delivery_site_id uuid,
  p_note             text,
  p_items            jsonb,
  p_operation_id      uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id       uuid;
  v_reserved       uuid;
  v_existing       record;
  v_batch_id       uuid;
  v_company_active boolean;
  v_item           jsonb;
  v_product_id     uuid;
  v_quantity       numeric(12, 2);
  v_due_date       date;
  v_seen_keys      text[] := '{}';
  v_key            text;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_operation_id is null then
    raise exception 'operation_id_required';
  end if;

  v_actor_id := public.current_actor_id();

  insert into public.lease_operations (operation_id, operation_type, actor_id, target_id)
  values (p_operation_id, 'create_lease_batch', v_actor_id, p_lease_company_id)
  on conflict (operation_id) do nothing
  returning operation_id into v_reserved;

  if v_reserved is null then
    select operation_type, actor_id, target_id, result_id into v_existing
      from public.lease_operations
     where operation_id = p_operation_id;

    if v_existing.operation_type is distinct from 'create_lease_batch'
       or v_existing.actor_id is distinct from v_actor_id
       or v_existing.target_id is distinct from p_lease_company_id then
      raise exception 'operation_id_conflict';
    end if;

    return v_existing.result_id;
  end if;

  select is_active into v_company_active
    from public.lease_companies
   where id = p_lease_company_id
   for update;

  if not found then
    raise exception 'lease_company_not_found';
  end if;
  if not v_company_active then
    raise exception 'lease_company_inactive';
  end if;

  if p_delivery_kind not in ('center', 'site') then
    raise exception 'invalid_delivery_kind';
  end if;
  if p_delivery_kind = 'site' and p_delivery_site_id is null then
    raise exception 'site_required';
  end if;
  if p_delivery_kind = 'center' and p_delivery_site_id is not null then
    raise exception 'invalid_delivery_kind';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'lease_batch_has_no_items';
  end if;

  insert into public.lease_batches (
    lease_company_id, slip_number, borrowed_at,
    delivery_kind, delivery_site_id, note, registered_by
  )
  values (
    p_lease_company_id, nullif(trim(p_slip_number), ''), p_borrowed_at,
    p_delivery_kind, p_delivery_site_id, nullif(trim(p_note), ''),
    v_actor_id
  )
  returning id into v_batch_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if (v_item->>'product_id') is null or trim(v_item->>'product_id') = '' then
      raise exception 'item_product_required';
    end if;
    v_product_id := (v_item->>'product_id')::uuid;

    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'quantity_must_be_positive';
    end if;

    v_due_date := nullif(v_item->>'return_due_date', '')::date;

    v_key := v_product_id::text || '|' || coalesce(v_due_date::text, '');
    if v_key = any(v_seen_keys) then
      raise exception 'duplicate_item';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_key);

    insert into public.lease_batch_items (
      lease_batch_id, product_id, quantity, return_due_date
    )
    values (
      v_batch_id, v_product_id, v_quantity, v_due_date
    );
  end loop;

  update public.lease_operations
     set result_id = v_batch_id
   where operation_id = p_operation_id;

  return v_batch_id;
end;
$$;

comment on function public.create_lease_batch is
  '借用ヘッダー＋明細を単一トランザクションで作成（admin のみ）。'
  ' p_operation_id 必須。会社の有効性・明細0件・数量・重複を検証。Phase 3-2（レビュー対応）';

-- ===========================================================================
-- 3) approve_lease_batch: 借用の承認（admin のみ）。target_id = lease_batch_id
-- ===========================================================================
create or replace function public.approve_lease_batch(
  p_batch_id      uuid,
  p_operation_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id       uuid;
  v_reserved       uuid;
  v_existing       record;
  v_status         text;
  v_company_id     uuid;
  v_company_active boolean;
  v_item_count     integer;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_operation_id is null then
    raise exception 'operation_id_required';
  end if;

  v_actor_id := public.current_actor_id();

  insert into public.lease_operations (operation_id, operation_type, actor_id, target_id)
  values (p_operation_id, 'approve_lease_batch', v_actor_id, p_batch_id)
  on conflict (operation_id) do nothing
  returning operation_id into v_reserved;

  if v_reserved is null then
    select operation_type, actor_id, target_id into v_existing
      from public.lease_operations
     where operation_id = p_operation_id;

    if v_existing.operation_type is distinct from 'approve_lease_batch'
       or v_existing.actor_id is distinct from v_actor_id
       or v_existing.target_id is distinct from p_batch_id then
      raise exception 'operation_id_conflict';
    end if;

    return;
  end if;

  select status, lease_company_id into v_status, v_company_id
    from public.lease_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'lease_batch_not_found';
  end if;

  if v_status <> 'draft' then
    raise exception 'invalid_status_transition';
  end if;

  select is_active into v_company_active
    from public.lease_companies
   where id = v_company_id;

  if not v_company_active then
    raise exception 'lease_company_inactive';
  end if;

  select count(*) into v_item_count
    from public.lease_batch_items
   where lease_batch_id = p_batch_id;

  if v_item_count = 0 then
    raise exception 'lease_batch_has_no_items';
  end if;

  update public.lease_batches
     set status      = 'approved',
         approved_by = v_actor_id,
         approved_at = now()
   where id = p_batch_id;
end;
$$;

comment on function public.approve_lease_batch is
  '借用を承認し受入可能にする（admin のみ / draft からのみ / 会社が有効 / 明細1件以上必須）。p_operation_id 必須。Phase 3-3';

-- ===========================================================================
-- 4) cancel_lease_batch: 借用のキャンセル（admin のみ）。target_id = lease_batch_id
-- ===========================================================================
create or replace function public.cancel_lease_batch(
  p_batch_id      uuid,
  p_operation_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_reserved uuid;
  v_existing record;
  v_status   text;
  v_received numeric(12, 2);
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_operation_id is null then
    raise exception 'operation_id_required';
  end if;

  v_actor_id := public.current_actor_id();

  insert into public.lease_operations (operation_id, operation_type, actor_id, target_id)
  values (p_operation_id, 'cancel_lease_batch', v_actor_id, p_batch_id)
  on conflict (operation_id) do nothing
  returning operation_id into v_reserved;

  if v_reserved is null then
    select operation_type, actor_id, target_id into v_existing
      from public.lease_operations
     where operation_id = p_operation_id;

    if v_existing.operation_type is distinct from 'cancel_lease_batch'
       or v_existing.actor_id is distinct from v_actor_id
       or v_existing.target_id is distinct from p_batch_id then
      raise exception 'operation_id_conflict';
    end if;

    return;
  end if;

  select status into v_status
    from public.lease_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'lease_batch_not_found';
  end if;

  if v_status not in ('draft', 'approved') then
    raise exception 'invalid_status_transition';
  end if;

  select coalesce(sum(received_quantity), 0) into v_received
    from public.lease_batch_items
   where lease_batch_id = p_batch_id;

  if v_received > 0 then
    raise exception 'lease_batch_already_received';
  end if;

  update public.lease_batches
     set status       = 'cancelled',
         cancelled_at = now()
   where id = p_batch_id;
end;
$$;

comment on function public.cancel_lease_batch is
  '借用をキャンセルする（admin のみ / draft・approved のみ / 受入前のみ）。p_operation_id 必須。Phase 3-3';

-- ===========================================================================
-- 5) receive_lease_batch_item: リース品の受入確定（center のみ）
--    target_id = lease_batch_item_id。ロック順序: 伝票 → 明細 → 在庫明細
-- ===========================================================================
create or replace function public.receive_lease_batch_item(
  p_item_id       uuid,
  p_quantity      numeric,
  p_operation_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id      uuid;
  v_reserved      uuid;
  v_existing      record;
  v_batch_id      uuid;
  v_batch_status  text;
  v_delivery_kind text;
  v_site_id       uuid;
  v_quantity      numeric(12, 2);
  v_received      numeric(12, 2);
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  if p_operation_id is null then
    raise exception 'operation_id_required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  v_actor_id := public.current_actor_id();

  insert into public.lease_operations (operation_id, operation_type, actor_id, target_id)
  values (p_operation_id, 'receive_lease_batch_item', v_actor_id, p_item_id)
  on conflict (operation_id) do nothing
  returning operation_id into v_reserved;

  if v_reserved is null then
    select operation_type, actor_id, target_id into v_existing
      from public.lease_operations
     where operation_id = p_operation_id;

    if v_existing.operation_type is distinct from 'receive_lease_batch_item'
       or v_existing.actor_id is distinct from v_actor_id
       or v_existing.target_id is distinct from p_item_id then
      raise exception 'operation_id_conflict';
    end if;

    return;
  end if;

  -- 所属伝票 id を先に確認（ロック無し）→ 伝票 → 明細 の順でロックする
  select lease_batch_id into v_batch_id
    from public.lease_batch_items
   where id = p_item_id;

  if not found then
    raise exception 'lease_batch_item_not_found';
  end if;

  select status, delivery_kind, delivery_site_id
    into v_batch_status, v_delivery_kind, v_site_id
    from public.lease_batches
   where id = v_batch_id
   for update;

  -- 未承認（draft）・キャンセル済み・受入完了後は受入不可（許容リスト方式）
  if v_batch_status not in ('approved', 'receiving') then
    raise exception 'lease_batch_not_approved';
  end if;

  select quantity, received_quantity into v_quantity, v_received
    from public.lease_batch_items
   where id = p_item_id
   for update;

  if v_received + p_quantity > v_quantity then
    raise exception 'received_exceeds_borrowed';
  end if;

  update public.lease_batch_items
     set received_quantity = received_quantity + p_quantity
   where id = p_item_id;

  perform public.apply_lease_stock_movement(
    p_item_id, v_delivery_kind, v_site_id, p_quantity, 'receive'
  );

  perform public.refresh_lease_batch_status(v_batch_id);
end;
$$;

comment on function public.receive_lease_batch_item is
  'リース品の受入確定（center のみ / 承認済み・受入中の借用のみ / 受入累計は借用数量以内）。'
  ' p_operation_id 必須。ロック順序: 伝票→明細→在庫。Phase 3-3';

-- ===========================================================================
-- 6) close_lease_batch_item_receiving: 未受入のまま受入を終了する（center のみ）
--    target_id = lease_batch_item_id
-- ===========================================================================
create or replace function public.close_lease_batch_item_receiving(
  p_item_id       uuid,
  p_reason        text,
  p_operation_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id     uuid;
  v_reserved     uuid;
  v_existing     record;
  v_batch_id     uuid;
  v_batch_status text;
  v_quantity     numeric(12, 2);
  v_received     numeric(12, 2);
  v_closed       boolean;
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  if p_operation_id is null then
    raise exception 'operation_id_required';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason_required';
  end if;

  v_actor_id := public.current_actor_id();

  insert into public.lease_operations (operation_id, operation_type, actor_id, target_id)
  values (p_operation_id, 'close_lease_batch_item_receiving', v_actor_id, p_item_id)
  on conflict (operation_id) do nothing
  returning operation_id into v_reserved;

  if v_reserved is null then
    select operation_type, actor_id, target_id into v_existing
      from public.lease_operations
     where operation_id = p_operation_id;

    if v_existing.operation_type is distinct from 'close_lease_batch_item_receiving'
       or v_existing.actor_id is distinct from v_actor_id
       or v_existing.target_id is distinct from p_item_id then
      raise exception 'operation_id_conflict';
    end if;

    return;
  end if;

  select lease_batch_id into v_batch_id
    from public.lease_batch_items
   where id = p_item_id;

  if not found then
    raise exception 'lease_batch_item_not_found';
  end if;

  select status into v_batch_status
    from public.lease_batches
   where id = v_batch_id
   for update;

  if v_batch_status not in ('approved', 'receiving') then
    raise exception 'lease_batch_not_approved';
  end if;

  select quantity, received_quantity, receiving_closed
    into v_quantity, v_received, v_closed
    from public.lease_batch_items
   where id = p_item_id
   for update;

  if v_closed then
    raise exception 'receiving_already_closed';
  end if;
  if v_received >= v_quantity then
    raise exception 'receiving_already_complete';
  end if;

  update public.lease_batch_items
     set receiving_closed        = true,
         receiving_closed_at     = now(),
         receiving_closed_by     = v_actor_id,
         receiving_closed_reason = trim(p_reason)
   where id = p_item_id;

  perform public.refresh_lease_batch_status(v_batch_id);
end;
$$;

comment on function public.close_lease_batch_item_receiving is
  '未受入のまま受入を終了する（center のみ / 理由必須 / 完了判定に反映）。p_operation_id 必須。Phase 3-2（レビュー対応 Critical #4）';

-- ===========================================================================
-- 7) ship_lease_stock_to_site: リース品をセンターから現場へ出庫（center のみ）
--    target_id = lease_batch_item_id
-- ===========================================================================
create or replace function public.ship_lease_stock_to_site(
  p_item_id       uuid,
  p_site_id       uuid,
  p_quantity      numeric,
  p_operation_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id     uuid;
  v_reserved     uuid;
  v_existing     record;
  v_batch_id     uuid;
  v_batch_status text;
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  if p_operation_id is null then
    raise exception 'operation_id_required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  if p_site_id is null then
    raise exception 'site_required';
  end if;

  v_actor_id := public.current_actor_id();

  insert into public.lease_operations (operation_id, operation_type, actor_id, target_id)
  values (p_operation_id, 'ship_lease_stock_to_site', v_actor_id, p_item_id)
  on conflict (operation_id) do nothing
  returning operation_id into v_reserved;

  if v_reserved is null then
    select operation_type, actor_id, target_id into v_existing
      from public.lease_operations
     where operation_id = p_operation_id;

    if v_existing.operation_type is distinct from 'ship_lease_stock_to_site'
       or v_existing.actor_id is distinct from v_actor_id
       or v_existing.target_id is distinct from p_item_id then
      raise exception 'operation_id_conflict';
    end if;

    return;
  end if;

  select lease_batch_id into v_batch_id
    from public.lease_batch_items
   where id = p_item_id;

  if not found then
    raise exception 'lease_batch_item_not_found';
  end if;

  select status into v_batch_status
    from public.lease_batches
   where id = v_batch_id
   for update;

  -- 受入が1件も無い（approved）／終了済み（closed）／キャンセル済みでは出庫不可
  if v_batch_status not in ('receiving', 'received') then
    raise exception 'invalid_status_transition';
  end if;

  perform 1 from public.lease_batch_items where id = p_item_id for update;

  -- センターから減算（不足なら insufficient_lease_stock で全ロールバック）
  perform public.apply_lease_stock_movement(
    p_item_id, 'center', null, -p_quantity, 'ship'
  );

  -- 現場へ加算
  perform public.apply_lease_stock_movement(
    p_item_id, 'site', p_site_id, p_quantity, 'ship'
  );
end;
$$;

comment on function public.ship_lease_stock_to_site is
  'リース品をセンターから現場へ出庫（center のみ / receiving・received のみ）。'
  ' p_operation_id 必須。ロック順序: 伝票→明細→在庫。Phase 3-4';

-- ===========================================================================
-- 8) return_lease_stock_from_site: リース品を現場からセンターへ返却（center のみ）
--    target_id = lease_batch_item_id。現場間の直接移動は扱わない（要件定義書 §3-1 / §14）
-- ===========================================================================
create or replace function public.return_lease_stock_from_site(
  p_item_id       uuid,
  p_site_id       uuid,
  p_quantity      numeric,
  p_operation_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id     uuid;
  v_reserved     uuid;
  v_existing     record;
  v_batch_id     uuid;
  v_batch_status text;
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  if p_operation_id is null then
    raise exception 'operation_id_required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  if p_site_id is null then
    raise exception 'site_required';
  end if;

  v_actor_id := public.current_actor_id();

  insert into public.lease_operations (operation_id, operation_type, actor_id, target_id)
  values (p_operation_id, 'return_lease_stock_from_site', v_actor_id, p_item_id)
  on conflict (operation_id) do nothing
  returning operation_id into v_reserved;

  if v_reserved is null then
    select operation_type, actor_id, target_id into v_existing
      from public.lease_operations
     where operation_id = p_operation_id;

    if v_existing.operation_type is distinct from 'return_lease_stock_from_site'
       or v_existing.actor_id is distinct from v_actor_id
       or v_existing.target_id is distinct from p_item_id then
      raise exception 'operation_id_conflict';
    end if;

    return;
  end if;

  select lease_batch_id into v_batch_id
    from public.lease_batch_items
   where id = p_item_id;

  if not found then
    raise exception 'lease_batch_item_not_found';
  end if;

  select status into v_batch_status
    from public.lease_batches
   where id = v_batch_id
   for update;

  if v_batch_status not in ('receiving', 'received') then
    raise exception 'invalid_status_transition';
  end if;

  perform 1 from public.lease_batch_items where id = p_item_id for update;

  perform public.apply_lease_stock_movement(
    p_item_id, 'site', p_site_id, -p_quantity, 'return_from_site'
  );

  perform public.apply_lease_stock_movement(
    p_item_id, 'center', null, p_quantity, 'return_from_site'
  );
end;
$$;

comment on function public.return_lease_stock_from_site is
  'リース品を現場からセンターへ返却（center のみ / receiving・received のみ）。'
  ' p_operation_id 必須。ロック順序: 伝票→明細→在庫。Phase 3-4';

-- ===========================================================================
-- 9) return_lease_to_company: センターからリース会社へ返却（center のみ）
--    target_id = lease_batch_item_id。一部返却に対応。
--    返却済み累計は「受入済み数量」を超えられない（未受入分は対象外）。
-- ===========================================================================
create or replace function public.return_lease_to_company(
  p_item_id       uuid,
  p_quantity      numeric,
  p_operation_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id     uuid;
  v_reserved     uuid;
  v_existing     record;
  v_batch_id     uuid;
  v_batch_status text;
  v_received     numeric(12, 2);
  v_returned     numeric(12, 2);
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  if p_operation_id is null then
    raise exception 'operation_id_required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  v_actor_id := public.current_actor_id();

  insert into public.lease_operations (operation_id, operation_type, actor_id, target_id)
  values (p_operation_id, 'return_lease_to_company', v_actor_id, p_item_id)
  on conflict (operation_id) do nothing
  returning operation_id into v_reserved;

  if v_reserved is null then
    select operation_type, actor_id, target_id into v_existing
      from public.lease_operations
     where operation_id = p_operation_id;

    if v_existing.operation_type is distinct from 'return_lease_to_company'
       or v_existing.actor_id is distinct from v_actor_id
       or v_existing.target_id is distinct from p_item_id then
      raise exception 'operation_id_conflict';
    end if;

    return;
  end if;

  select lease_batch_id into v_batch_id
    from public.lease_batch_items
   where id = p_item_id;

  if not found then
    raise exception 'lease_batch_item_not_found';
  end if;

  select status into v_batch_status
    from public.lease_batches
   where id = v_batch_id
   for update;

  if v_batch_status not in ('receiving', 'received') then
    raise exception 'invalid_status_transition';
  end if;

  select received_quantity, returned_quantity into v_received, v_returned
    from public.lease_batch_items
   where id = p_item_id
   for update;

  -- 返却義務残（未受入分を含まない） = received_quantity - returned_quantity
  if v_returned + p_quantity > v_received then
    raise exception 'returned_exceeds_received';
  end if;

  -- センターの現物を減算（現場にある分は先に return_lease_stock_from_site が必要）
  perform public.apply_lease_stock_movement(
    p_item_id, 'center', null, -p_quantity, 'return_to_company'
  );

  update public.lease_batch_items
     set returned_quantity = returned_quantity + p_quantity
   where id = p_item_id;

  perform public.refresh_lease_batch_status(v_batch_id);
end;
$$;

comment on function public.return_lease_to_company is
  'センター保管中のリース品をリース会社へ返却（center のみ / 一部返却可 / 返却義務残＝受入済み-返却済みが上限）。'
  ' p_operation_id 必須。Phase 3-5';

-- ===========================================================================
-- 10) 既存 list_app_users / resolve_auth_user_by_email / update_app_user_by_internal は無変更（027 のまま）
-- ===========================================================================

-- ===========================================================================
-- 11) EXECUTE 権限（anon / public を剥奪し authenticated のみ許可）
-- ===========================================================================
revoke execute on function public.current_actor_id() from public;
revoke execute on function public.current_actor_id() from anon;
grant  execute on function public.current_actor_id() to authenticated;

revoke execute on function public.create_lease_batch(uuid, text, date, text, uuid, text, jsonb, uuid) from public;
revoke execute on function public.create_lease_batch(uuid, text, date, text, uuid, text, jsonb, uuid) from anon;
grant  execute on function public.create_lease_batch(uuid, text, date, text, uuid, text, jsonb, uuid) to authenticated;

revoke execute on function public.approve_lease_batch(uuid, uuid) from public;
revoke execute on function public.approve_lease_batch(uuid, uuid) from anon;
grant  execute on function public.approve_lease_batch(uuid, uuid) to authenticated;

revoke execute on function public.cancel_lease_batch(uuid, uuid) from public;
revoke execute on function public.cancel_lease_batch(uuid, uuid) from anon;
grant  execute on function public.cancel_lease_batch(uuid, uuid) to authenticated;

revoke execute on function public.receive_lease_batch_item(uuid, numeric, uuid) from public;
revoke execute on function public.receive_lease_batch_item(uuid, numeric, uuid) from anon;
grant  execute on function public.receive_lease_batch_item(uuid, numeric, uuid) to authenticated;

revoke execute on function public.close_lease_batch_item_receiving(uuid, text, uuid) from public;
revoke execute on function public.close_lease_batch_item_receiving(uuid, text, uuid) from anon;
grant  execute on function public.close_lease_batch_item_receiving(uuid, text, uuid) to authenticated;

revoke execute on function public.ship_lease_stock_to_site(uuid, uuid, numeric, uuid) from public;
revoke execute on function public.ship_lease_stock_to_site(uuid, uuid, numeric, uuid) from anon;
grant  execute on function public.ship_lease_stock_to_site(uuid, uuid, numeric, uuid) to authenticated;

revoke execute on function public.return_lease_stock_from_site(uuid, uuid, numeric, uuid) from public;
revoke execute on function public.return_lease_stock_from_site(uuid, uuid, numeric, uuid) from anon;
grant  execute on function public.return_lease_stock_from_site(uuid, uuid, numeric, uuid) to authenticated;

revoke execute on function public.return_lease_to_company(uuid, numeric, uuid) from public;
revoke execute on function public.return_lease_to_company(uuid, numeric, uuid) from anon;
grant  execute on function public.return_lease_to_company(uuid, numeric, uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) 旧シグネチャが残っていないこと（レビュー再指摘 #1）
-- --     pg_get_function_identity_arguments は型リストのみを返し引数名は含まないため、
-- --     「関数名ごとに行が1件だけか」「型の個数が新シグネチャと一致するか」で判定する。
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.pronargs
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('create_lease_batch','approve_lease_batch','cancel_lease_batch',
--                      'receive_lease_batch_item','close_lease_batch_item_receiving',
--                      'ship_lease_stock_to_site','return_lease_stock_from_site','return_lease_to_company')
--  order by p.proname, args;
-- -- 期待: 各関数につき1行のみ（旧シグネチャが別行として並存していないこと）。
-- --       pronargs は create_lease_batch=8, approve/cancel_lease_batch=2,
-- --       receive_lease_batch_item/return_lease_to_company=3,
-- --       close_lease_batch_item_receiving=3, ship/return_lease_stock_from_site=4。
-- --       旧シグネチャはこれよりそれぞれ 1 少ない（例: approve_lease_batch(uuid) は pronargs=1）。
--
-- -- (b) 関数の存在とガード
-- select p.proname,
--        position('is_admin'  in pg_get_functiondef(p.oid)) > 0 as admin_guard,
--        position('is_center' in pg_get_functiondef(p.oid)) > 0 as center_guard,
--        position('operation_id_required' in pg_get_functiondef(p.oid)) > 0 as requires_operation_id
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public'
--    and p.proname in ('create_lease_batch','approve_lease_batch','cancel_lease_batch',
--                      'receive_lease_batch_item','close_lease_batch_item_receiving',
--                      'ship_lease_stock_to_site','return_lease_stock_from_site','return_lease_to_company')
--  order by p.proname;
-- -- 期待: 全行 requires_operation_id = true
--
-- -- (c) 内部関数が authenticated から呼べないこと
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name in ('apply_lease_stock_movement','refresh_lease_batch_status')
--  order by routine_name, grantee;
-- -- 期待: 0 行
--
-- -- (d) 公開 RPC の EXECUTE が authenticated のみであること
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name in ('create_lease_batch','approve_lease_batch','cancel_lease_batch',
--                         'receive_lease_batch_item','close_lease_batch_item_receiving',
--                         'ship_lease_stock_to_site','return_lease_stock_from_site','return_lease_to_company')
--  order by routine_name, grantee;
-- -- 期待: grantee は authenticated のみ（anon / PUBLIC が無いこと）
--
-- -- (e) lease_operations に直接アクセス権が無いこと
-- select table_name, grantee, privilege_type from information_schema.table_privileges
--  where table_schema='public' and table_name='lease_operations';
-- -- 期待: 0 行
--
-- -- (f) search_path が全関数で固定されていること
-- select p.proname, p.proconfig
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public'
--    and p.proname in ('create_lease_batch','approve_lease_batch','cancel_lease_batch',
--                      'receive_lease_batch_item','close_lease_batch_item_receiving',
--                      'ship_lease_stock_to_site','return_lease_stock_from_site','return_lease_to_company',
--                      'apply_lease_stock_movement','refresh_lease_batch_status','current_actor_id');
-- -- 期待: 全行 proconfig に search_path=public,pg_temp を含む

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.return_lease_to_company(uuid, numeric, uuid);
-- drop function if exists public.return_lease_stock_from_site(uuid, uuid, numeric, uuid);
-- drop function if exists public.ship_lease_stock_to_site(uuid, uuid, numeric, uuid);
-- drop function if exists public.close_lease_batch_item_receiving(uuid, text, uuid);
-- drop function if exists public.receive_lease_batch_item(uuid, numeric, uuid);
-- drop function if exists public.cancel_lease_batch(uuid, uuid);
-- drop function if exists public.approve_lease_batch(uuid, uuid);
-- drop function if exists public.create_lease_batch(uuid, text, date, text, uuid, text, jsonb, uuid);
-- drop function if exists public.apply_lease_stock_movement(uuid, text, uuid, numeric, text);
-- drop function if exists public.refresh_lease_batch_status(uuid);
-- drop function if exists public.current_actor_id();
-- drop table if exists public.lease_operations;
-- commit;
-- notify pgrst, 'reload schema';
