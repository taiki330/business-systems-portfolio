-- 043_p6_operation_logs.sql
-- 042 適用後に Supabase SQL Editor で実行
-- Phase 6-1: 汎用操作履歴（operation_logs）の基盤
--
-- 背景・方針:
--   - 既存の audit_logs（007）は event_type が stock_request 系 4 値の CHECK 制約、
--     request_id が stock_requests への FK という「出庫依頼専用」設計であり、
--     Phase 6 が求める汎用の操作履歴（在庫・調整・返却・過入庫・マスタ・権限 …）を
--     載せられない。制約を緩める改修は既存の出庫依頼監査の挙動に影響するため行わず、
--     operation_logs を新設して併存させる（audit_logs は現行のまま一切変更しない）。
--   - 記録の粒度は「利用者の 1 操作 = 1 行」とする。stock_ledger は 1 移動 = 1 行
--     （出庫確定 1 回で center out / site in の 2 行）であり操作履歴とは粒度が異なるため、
--     stock_ledger を操作履歴として流用せず別テーブルとする。
--   - 書込経路は SECURITY DEFINER 関数（log_operation）とトリガのみ。
--     authenticated には INSERT/UPDATE/DELETE を一切与えず、追記専用・改竄不可とする。
--     業務 RPC からは同一トランザクション内で呼ぶため「処理は成功したが履歴が残らない」
--     状態が発生しない（既存 recordAudit の best-effort 方式は audit_logs 用に据え置き）。
--   - 資材マスタ・現場情報・権限の変更は Server Action から PostgREST 経由で直接 UPDATE して
--     おり RPC が存在しない。これらを RPC 化するのは既存機能への影響が大きいため、
--     テーブルに AFTER トリガを付けて DB 側で確実に記録する（アプリコードの変更が不要で、
--     どの経路から更新されても取りこぼさない）。
--   - 在庫増減・出庫依頼・返却の各 RPC への記録追加、過入庫・在庫調整申請の記録は、
--     それぞれの機能を実装する後続 migration（044 以降）で当該 RPC を
--     create or replace する際に併せて行う。本 migration では基盤のみを用意する。
--
-- 参照整合性の扱い:
--   - operation_logs は監査証跡のため、他テーブルへの外部キーを一切張らない。
--     マスタ削除で履歴行が消えたり、履歴があるために削除がブロックされたりするのを防ぎ、
--     actor / 対象の情報は操作時点のスナップショット（actor_role・actor_name・detail）
--     として保持する。
--
-- 冪等性: create table if not exists / create or replace function /
--         drop trigger if exists → create trigger / drop policy if exists。再実行しても安全。

begin;

-- ===========================================================================
-- 1) operation_logs テーブル
-- ===========================================================================
create table if not exists public.operation_logs (
  id uuid primary key default gen_random_uuid(),

  -- 操作種別。既存 audit_logs.event_type と同じドット区切りの命名規則に合わせる。
  -- Phase 7（現場進捗）・Phase 8（オーダー・伝票）の値も先に許可しておき、
  -- 後続 Phase で CHECK 制約の張り替え migration が不要になるようにする。
  operation text not null check (operation in (
    -- 在庫増減
    'stock.moved',
    'stock.adjusted',
    -- 在庫調整申請
    'stock_adjustment.requested',
    'stock_adjustment.approved',
    'stock_adjustment.rejected',
    -- 出庫依頼
    'stock_request.created',
    'stock_request.accepted',
    'stock_request.shipped',
    'stock_request.cancelled',
    -- 返却
    'stock_return.created',
    'lease_return.created',
    -- 過入庫
    'over_return.created',
    'over_return.confirmed',
    -- マスタ・権限
    'product.created',
    'product.updated',
    'product.deleted',
    'site.created',
    'site.updated',
    'site.deleted',
    'user_role.changed',
    -- Phase 7: 現場進捗
    'site_progress.assembly_completed',
    'site_progress.dismantle_started',
    'site_progress.dismantle_completed',
    -- Phase 8: オーダー・伝票
    'order.created',
    'order.updated',
    'order.deleted',
    'slip.created',
    'slip.updated',
    'slip.deleted'
  )),

  entity_type text not null check (entity_type in (
    'stock', 'stock_adjustment', 'stock_request', 'stock_return',
    'lease_return', 'over_return', 'product', 'site', 'app_user',
    'site_progress', 'order', 'slip'
  )),

  -- 対象レコードの ID。FK は張らない（上部コメント参照）。
  entity_id uuid,

  -- 操作者。app_users への FK は張らず、操作時点の値をスナップショットする。
  actor_id   uuid,
  actor_role text,
  actor_name text,

  -- 絞り込み用（FK なし）。現場・商品に紐づかない操作では NULL。
  site_id    uuid,
  product_id uuid,

  -- 数量を伴う操作のみ設定（在庫増減・返却・過入庫など）
  quantity numeric(12, 2),

  -- 操作固有の最小事実。マスタ変更では before / after の行スナップショットを入れる。
  detail jsonb,

  created_at timestamptz not null default now()
);

comment on table public.operation_logs is
  '業務データを変更した操作の履歴（追記専用・利用者の1操作=1行）。'
  ' 書込は log_operation / トリガ（SECURITY DEFINER）経由のみ。検索・閲覧は記録しない。Phase 6-1';
comment on column public.operation_logs.operation is
  '操作種別。audit_logs.event_type と同じドット区切り命名。Phase 7/8 の値も先行許可済み';
comment on column public.operation_logs.entity_id is
  '対象レコード ID。監査証跡のため FK は張らない（対象削除後も履歴を残す）';
comment on column public.operation_logs.actor_role is
  '操作時点のロールのスナップショット。以後 権限変更があっても当時の値を保持する';
comment on column public.operation_logs.detail is
  '操作固有の最小事実。マスタ変更は {"before":…, "after":…} の行スナップショット';

create index if not exists operation_logs_created_at_idx
  on public.operation_logs (created_at desc);
create index if not exists operation_logs_operation_created_idx
  on public.operation_logs (operation, created_at desc);
create index if not exists operation_logs_entity_idx
  on public.operation_logs (entity_type, entity_id);
create index if not exists operation_logs_actor_idx
  on public.operation_logs (actor_id, created_at desc);
create index if not exists operation_logs_site_idx
  on public.operation_logs (site_id, created_at desc);

-- ===========================================================================
-- 2) RLS / GRANT
--    参照は admin（事務）のみ。書込 policy は作らない＝ authenticated からは
--    どの経路でも INSERT/UPDATE/DELETE できない（追記専用・改竄不可）。
-- ===========================================================================
alter table public.operation_logs enable row level security;

revoke all on table public.operation_logs from public, anon, authenticated;
grant select on table public.operation_logs to authenticated;

drop policy if exists "operation_logs_admin_select" on public.operation_logs;
create policy "operation_logs_admin_select"
  on public.operation_logs for select to authenticated
  using (public.is_admin());

-- ===========================================================================
-- 3) log_operation: 操作履歴の追記ヘルパー（内部専用）
--    他の SECURITY DEFINER 関数・トリガからのみ呼ぶ。EXECUTE は誰にも与えない
--    （関数所有者として実行される呼び出し元からは引き続き呼べる）。
-- ===========================================================================
create or replace function public.log_operation(
  p_operation   text,
  p_entity_type text,
  p_entity_id   uuid    default null,
  p_site_id     uuid    default null,
  p_product_id  uuid    default null,
  p_quantity    numeric default null,
  p_detail      jsonb   default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_role  text;
  v_name  text;
  v_id    uuid;
begin
  v_actor := public.current_actor_id();

  if v_actor is not null then
    select au.role, au.display_name
      into v_role, v_name
      from public.app_users au
     where au.id = v_actor;
  end if;

  insert into public.operation_logs (
    operation, entity_type, entity_id,
    actor_id, actor_role, actor_name,
    site_id, product_id, quantity, detail
  )
  values (
    p_operation, p_entity_type, p_entity_id,
    v_actor, v_role, v_name,
    p_site_id, p_product_id, p_quantity, p_detail
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.log_operation is
  '操作履歴を追記する内部ヘルパー。業務 RPC・トリガから同一トランザクションで呼ぶ。Phase 6-1';

revoke execute on function public.log_operation(text, text, uuid, uuid, uuid, numeric, jsonb) from public;
revoke execute on function public.log_operation(text, text, uuid, uuid, uuid, numeric, jsonb) from anon;
revoke execute on function public.log_operation(text, text, uuid, uuid, uuid, numeric, jsonb) from authenticated;

-- ===========================================================================
-- 4) マスタ変更の記録トリガ
--    資材マスタ（products）・現場情報（sites）・権限（app_users）は Server Action から
--    直接 UPDATE されており RPC が無いため、テーブル側で確実に記録する。
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
  -- 権限変更のみを対象にする（表示名だけの更新は業務データ変更ではないため記録しない）
  if tg_table_name = 'app_users' and tg_op = 'UPDATE'
     and new.role is not distinct from old.role
     and new.vendor_id is not distinct from old.vendor_id then
    return null;
  end if;

  -- 行スナップショット（DELETE では NEW、INSERT では OLD が未割当のため分岐する）
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
    -- 権限の付与（INSERT）・変更（UPDATE）のみを記録する
    v_entity_type := 'app_user';
    v_operation   := 'user_role.changed';
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
  'products / sites / app_users の変更を operation_logs へ記録する AFTER トリガ関数。Phase 6-1';

drop trigger if exists products_operation_log on public.products;
create trigger products_operation_log
  after insert or update or delete on public.products
  for each row execute function public.tg_operation_log_master();

drop trigger if exists sites_operation_log on public.sites;
create trigger sites_operation_log
  after insert or update or delete on public.sites
  for each row execute function public.tg_operation_log_master();

-- app_users は権限の付与・変更のみ（削除は権限変更ではないため対象外）
drop trigger if exists app_users_operation_log on public.app_users;
create trigger app_users_operation_log
  after insert or update on public.app_users
  for each row execute function public.tg_operation_log_master();

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) テーブル・索引・RLS
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name='operation_logs'
--  order by ordinal_position;
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='operation_logs';
-- -- 期待: operation_logs_admin_select（SELECT）1 件のみ（INSERT/UPDATE/DELETE policy 無し）
--
-- -- (b) authenticated に SELECT 以外の権限が無いこと
-- select grantee, privilege_type
--   from information_schema.table_privileges
--  where table_schema='public' and table_name='operation_logs'
--  order by grantee, privilege_type;
-- -- 期待: authenticated は SELECT のみ、anon は 0 行
--
-- -- (c) log_operation の EXECUTE が誰にも付与されていないこと
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='log_operation';
-- -- 期待: 0 行（所有者のみが実行できる状態）
--
-- -- (d) マスタ変更が記録されること（admin で実行し、名前を元に戻すこと）
-- -- update public.products set name = name || ' ' where id = '<product_id>';
-- -- select operation, entity_type, actor_role, detail -> 'after' ->> 'name'
-- --   from public.operation_logs order by created_at desc limit 3;
--
-- -- (e) トリガの登録状況
-- select tgname, tgrelid::regclass as table_name
--   from pg_trigger
--  where tgname in ('products_operation_log','sites_operation_log','app_users_operation_log');

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合）
-- ---------------------------------------------------------------------------
-- begin;
-- drop trigger if exists app_users_operation_log on public.app_users;
-- drop trigger if exists sites_operation_log on public.sites;
-- drop trigger if exists products_operation_log on public.products;
-- drop function if exists public.tg_operation_log_master();
-- drop function if exists public.log_operation(text, text, uuid, uuid, uuid, numeric, jsonb);
-- drop policy if exists "operation_logs_admin_select" on public.operation_logs;
-- drop table if exists public.operation_logs;
-- commit;
-- notify pgrst, 'reload schema';
