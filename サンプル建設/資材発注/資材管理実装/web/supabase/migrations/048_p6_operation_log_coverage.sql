-- 048_p6_operation_log_coverage.sql
-- 047 適用後に Supabase SQL Editor で実行
-- Phase 6-4: 操作履歴の記録範囲を要件の全カテゴリへ広げる
--
-- 対象（043〜047 でまだ記録されていなかったもの）:
--   - 在庫増減（入出庫登録）
--   - 出庫依頼の作成・受付・出庫確定・取消
--   - リース返却（現場→センター / センター→リース会社）
--   併せてリースの受入・出庫も在庫増減として記録する（リース在庫も在庫であるため）。
--
-- 方針（記録は「利用者の 1 操作 = 1 行」を保つ）:
--   1) 在庫増減（入出庫登録）
--      apply_stock_movement は出庫確定・返却など他の RPC からも内部的に呼ばれる共有部品であり、
--      ここに記録を入れると「出庫確定」等の業務ログと二重に出てしまう。
--      そこで既存関数には一切手を加えず、手動の入出庫登録専用の薄いラッパー
--      record_stock_movement を新設し、アプリ（/stock/move）はこちらを呼ぶ。
--      これにより手動の在庫増減だけが 1 行記録される。
--
--   2) 出庫依頼
--      出庫依頼の作成・受付・取消は Server Action から stock_requests を直接 UPDATE しており
--      RPC が存在しない。043 のマスタ変更と同じ考え方で、テーブルに AFTER トリガを付けて
--      status の遷移から記録する。どの経路で更新されても取りこぼさず、アプリコードの変更も不要。
--      既存の audit_logs（007）への記録は従来どおり残す（本 migration では一切変更しない）。
--
--   3) リース
--      リース在庫の台帳書込はすべて apply_lease_stock_movement 経由で lease_stock_ledger に入る。
--      ただし 1 つの業務操作で 2 行（出庫元の out と入庫先の in）書かれる場合があるため、
--      業務操作ごとに一意に決まる行だけをトリガで拾って 1 行だけ記録する:
--        receive           : in  1 行のみ            → stock.moved（リース受入）
--        ship              : out（センター側）       → stock.moved（リース出庫）
--        return_from_site  : out（現場側）           → lease_return.created
--        return_to_company : out  1 行のみ           → lease_return.created
--
-- 冪等性: create or replace function / drop trigger if exists → create trigger。再実行しても安全。

begin;

-- ===========================================================================
-- 1) record_stock_movement: 手動の入出庫登録（center）
--    apply_stock_movement 本体は変更しない（他 RPC からの内部利用に影響させないため）。
-- ===========================================================================
create or replace function public.record_stock_movement(
  p_product_id    uuid,
  p_location      text,
  p_movement_type text,
  p_quantity      numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ledger_id uuid;
  v_site_id   uuid;
begin
  if not public.is_center() then
    raise exception 'permission_denied: center role required'
      using errcode = '42501';
  end if;

  v_ledger_id := public.apply_stock_movement(
    p_product_id, p_location, p_movement_type, p_quantity
  );

  select si.site_id into v_site_id
    from public.stock_items si
   where si.product_id = p_product_id
     and si.location   = p_location;

  perform public.log_operation(
    'stock.moved', 'stock', v_ledger_id,
    v_site_id, p_product_id, p_quantity,
    jsonb_build_object(
      'ownership',     'owned',
      'location',      p_location,
      'movement_type', p_movement_type
    )
  );

  return v_ledger_id;
end;
$$;

comment on function public.record_stock_movement is
  '手動の入出庫登録（center）。apply_stock_movement を呼び、操作履歴を 1 行記録する。'
  ' 出庫確定・返却など他 RPC 経由の在庫増減はそれぞれの業務ログで記録されるため本関数は通さない。Phase 6-4';

revoke execute on function public.record_stock_movement(uuid, text, text, numeric) from public;
revoke execute on function public.record_stock_movement(uuid, text, text, numeric) from anon;
grant  execute on function public.record_stock_movement(uuid, text, text, numeric) to authenticated;

-- ===========================================================================
-- 2) 出庫依頼のトリガ（作成・受付・出庫確定・取消）
-- ===========================================================================
create or replace function public.tg_operation_log_stock_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation text;
begin
  if tg_op = 'INSERT' then
    v_operation := 'stock_request.created';
  else
    -- status が変わっていないときは業務上の状態遷移ではないので記録しない
    if new.status is not distinct from old.status then
      return null;
    end if;

    v_operation := case new.status
                     when 'accepted'  then 'stock_request.accepted'
                     when 'shipped'   then 'stock_request.shipped'
                     when 'cancelled' then 'stock_request.cancelled'
                     else null
                   end;

    if v_operation is null then
      return null;
    end if;
  end if;

  perform public.log_operation(
    v_operation, 'stock_request', new.id,
    new.site_id, new.product_id, new.quantity,
    jsonb_build_object(
      'status',      new.status,
      'prev_status', case when tg_op = 'UPDATE' then old.status else null end
    )
  );

  return null;
end;
$$;

comment on function public.tg_operation_log_stock_request is
  '出庫依頼の作成・状態遷移を operation_logs へ記録する AFTER トリガ関数。Phase 6-4';

drop trigger if exists stock_requests_operation_log on public.stock_requests;
create trigger stock_requests_operation_log
  after insert or update on public.stock_requests
  for each row execute function public.tg_operation_log_stock_request();

-- ===========================================================================
-- 3) リース在庫台帳のトリガ（受入・出庫・返却）
--    1 業務操作で 2 行書かれるケースがあるため、一意に決まる行だけを記録する。
-- ===========================================================================
create or replace function public.tg_operation_log_lease_ledger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation   text;
  v_entity_type text;
  v_kind        text;
begin
  if new.reason = 'receive' and new.movement_type = 'in' then
    v_operation   := 'stock.moved';
    v_entity_type := 'stock';
    v_kind        := 'lease_receive';

  elsif new.reason = 'ship' and new.movement_type = 'out' then
    -- 出庫はセンター out と現場 in の 2 行になるため out 側だけを拾う
    v_operation   := 'stock.moved';
    v_entity_type := 'stock';
    v_kind        := 'lease_ship';

  elsif new.reason = 'return_from_site' and new.movement_type = 'out' then
    -- 返却は現場 out とセンター in の 2 行になるため out 側だけを拾う
    v_operation   := 'lease_return.created';
    v_entity_type := 'lease_return';
    v_kind        := 'from_site';

  elsif new.reason = 'return_to_company' and new.movement_type = 'out' then
    v_operation   := 'lease_return.created';
    v_entity_type := 'lease_return';
    v_kind        := 'to_company';

  else
    -- 対になるもう一方の行（同一操作の反対側）は記録しない
    return null;
  end if;

  perform public.log_operation(
    v_operation, v_entity_type, new.id,
    new.site_id, new.product_id, new.quantity,
    jsonb_build_object(
      'ownership',        'leased',
      'kind',             v_kind,
      'reason',           new.reason,
      'movement_type',    new.movement_type,
      'location',         new.location,
      'lease_company_id', new.lease_company_id
    )
  );

  return null;
end;
$$;

comment on function public.tg_operation_log_lease_ledger is
  'リース在庫の受入・出庫・返却を operation_logs へ 1 操作 1 行で記録する AFTER トリガ関数。Phase 6-4';

drop trigger if exists lease_stock_ledger_operation_log on public.lease_stock_ledger;
create trigger lease_stock_ledger_operation_log
  after insert on public.lease_stock_ledger
  for each row execute function public.tg_operation_log_lease_ledger();

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) トリガの登録状況
-- select tgname, tgrelid::regclass as table_name from pg_trigger
--  where tgname in ('stock_requests_operation_log', 'lease_stock_ledger_operation_log');
--
-- -- (b) 記録されている操作の種類（アプリで一通り操作したあとに確認）
-- select operation, count(*), max(created_at) as latest
--   from public.operation_logs group by operation order by operation;
--
-- -- (c) 出庫確定 1 回につき stock_request.shipped が 1 行だけであること
-- select entity_id, count(*) from public.operation_logs
--  where operation = 'stock_request.shipped' group by entity_id having count(*) > 1;
-- -- 期待: 0 行
--
-- -- (d) リース返却 1 回につき lease_return.created が 1 行だけであること
-- select detail ->> 'kind' as kind, count(*) from public.operation_logs
--  where operation = 'lease_return.created' group by 1;
--
-- -- (e) record_stock_movement の EXECUTE
-- select grantee, privilege_type from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='record_stock_movement';
-- -- 期待: authenticated のみ

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合）
-- ---------------------------------------------------------------------------
-- begin;
-- drop trigger if exists lease_stock_ledger_operation_log on public.lease_stock_ledger;
-- drop trigger if exists stock_requests_operation_log on public.stock_requests;
-- drop function if exists public.tg_operation_log_lease_ledger();
-- drop function if exists public.tg_operation_log_stock_request();
-- drop function if exists public.record_stock_movement(uuid, text, text, numeric);
-- commit;
-- notify pgrst, 'reload schema';
-- ※ src/lib/stock/apply-movement.ts の RPC 名を apply_stock_movement へ戻すこと。
