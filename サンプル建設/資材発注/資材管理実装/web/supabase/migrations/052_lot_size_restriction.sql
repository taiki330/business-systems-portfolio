-- 052_lot_size_restriction.sql
-- 051 適用後に Supabase SQL Editor で実行
-- 半端もん機能: 資材ごとのセット数と、現場×資材ごとの半端もん許可設定
--
-- 仕様（ユーザーヒアリング要旨・2026-07-30）:
--   - 資材ごとにセット数を設定できる（種別単位ではなく商品単位）。セット数が無い資材は
--     従来通り自由な数量で依頼できる。入力方式は変えず、これまで通り実数量で入力する。
--   - 半端もん（セット数の倍数以外の数量）を許可するかどうかは、現場×資材の組み合わせ単位で
--     決める。既存の site_products（現場×商品の補助マスタ）に許可フラグを追加する。
--     デフォルトは許可＝true。site_products に紐付けが無い組み合わせも許可扱いとする
--     （「何も設定していない組み合わせは今まで通り自由」）。
--   - 検証対象は「資材にセット数が設定されている」かつ「現場×資材で半端もんが許可されて
--     いない」場合のみ。数量がセット数の倍数でなければ、出庫依頼の作成を拒否する。
--   - チェックは DB のトリガーレベルで強制する（フェイルクローズ。どの経路から依頼が
--     作られても必ずチェックされる）。
--   - 対象は自社資材（stock_requests）のみ。リース資材は別経路（lease_stock 系。
--     stock_requests を経由しない）のため、そもそも対象になり得ない。
--   - 事務による例外対応（現場×資材ごとの許可フラグの個別 ON/OFF）はマスタ設定の一機能として
--     用意する。個別の依頼だけを一時的にスルーする機能は作らない。
--   - 帳票上のマーク表示は今回対象外（Phase8 で対応）。
--
-- 冪等性: add column if not exists / create or replace function /
--         drop trigger if exists → create trigger。再実行しても安全。

begin;

-- ===========================================================================
-- 1) products.lot_size（セット数。NULL = 制約なし）
-- ===========================================================================
alter table public.products
  add column if not exists lot_size numeric(12, 2) null;

alter table public.products
  drop constraint if exists products_lot_size_check;
alter table public.products
  add constraint products_lot_size_check check (lot_size is null or lot_size > 0);

comment on column public.products.lot_size is
  'セット数（半端もん機能）。NULL=制約なし。数量入力自体は従来通り実数量。'
  ' 出庫依頼作成時、site_products.allow_partial_lot が false の現場×資材でのみ'
  ' この値の倍数かどうかを検証する。';

-- ===========================================================================
-- 2) site_products.allow_partial_lot（現場×資材ごとの半端もん許可。既定 true）
-- ===========================================================================
alter table public.site_products
  add column if not exists allow_partial_lot boolean not null default true;

comment on column public.site_products.allow_partial_lot is
  '半端もん（セット数の倍数以外の数量）を許可するか。既定 true。'
  ' false のときのみ products.lot_size の倍数チェックを強制する。'
  ' 現場×資材の紐付けが存在しない組み合わせは常に許可扱い（半端もん機能）。';

-- ===========================================================================
-- 3) 出庫依頼作成時の倍数チェック（フェイルクローズ）
--    - security definer は使わない。stock_requests への INSERT/UPDATE が許可されている
--      ロール（internal / vendor）は、019/017 の既存 RLS により products は常に SELECT 可、
--      site_products も自分が依頼可能な site_id については SELECT 可であるため、
--      呼び出し元の権限のまま実行して問題ない（最小権限）。
-- ===========================================================================
create or replace function public.check_stock_request_lot_size()
returns trigger
language plpgsql
as $$
declare
  v_lot_size numeric(12, 2);
  v_allow    boolean;
begin
  select p.lot_size into v_lot_size
    from public.products p
   where p.id = new.product_id;

  if v_lot_size is not null then
    select sp.allow_partial_lot into v_allow
      from public.site_products sp
     where sp.site_id = new.site_id
       and sp.product_id = new.product_id;

    -- 紐付けが無い組み合わせは既定で許可（v_allow は null → true 扱い）
    if coalesce(v_allow, true) = false
       and mod(new.quantity, v_lot_size) <> 0 then
      raise exception 'lot_size_violation'
        using detail = format(
          'quantity=%s lot_size=%s product_id=%s site_id=%s',
          new.quantity, v_lot_size, new.product_id, new.site_id
        );
    end if;
  end if;

  return new;
end;
$$;

comment on function public.check_stock_request_lot_size is
  '出庫依頼(stock_requests)作成・数量変更時、資材にセット数(products.lot_size)が設定されており、'
  ' かつ現場×資材で半端もんが許可されていない(site_products.allow_partial_lot=false)場合、'
  ' 数量がセット数の倍数でなければ拒否する。半端もん機能。';

drop trigger if exists stock_requests_check_lot_size on public.stock_requests;
create trigger stock_requests_check_lot_size
  before insert or update of quantity, product_id, site_id
  on public.stock_requests
  for each row execute function public.check_stock_request_lot_size();

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) カラムの存在確認
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema='public'
--    and ((table_name='products' and column_name='lot_size')
--      or (table_name='site_products' and column_name='allow_partial_lot'));
--
-- -- (b) トリガーの存在確認
-- select tgname from pg_trigger
--  where tgrelid='public.stock_requests'::regclass and not tgisinternal;
-- -- 期待: stock_requests_set_updated_at, stock_requests_set_original_quantity,
-- --       stock_requests_operation_log, stock_requests_check_lot_size
--
-- -- (c) 倍数チェックの動作確認（product に lot_size=50 を設定、対象 site_products の
-- --     allow_partial_lot を false にしたうえで）
-- -- insert into public.stock_requests (site_id, product_id, quantity)
-- --   values ('<site_id>', '<product_id>', 60); -- 失敗するはず（lot_size_violation）
-- -- insert into public.stock_requests (site_id, product_id, quantity)
-- --   values ('<site_id>', '<product_id>', 100); -- 成功するはず
--
-- -- (d) 紐付けが無い組み合わせ・allow_partial_lot=true では制約なしで従来通り依頼できること

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合）
-- ---------------------------------------------------------------------------
-- begin;
-- drop trigger if exists stock_requests_check_lot_size on public.stock_requests;
-- drop function if exists public.check_stock_request_lot_size();
-- alter table public.site_products drop column if exists allow_partial_lot;
-- alter table public.products drop constraint if exists products_lot_size_check;
-- alter table public.products drop column if exists lot_size;
-- commit;
-- notify pgrst, 'reload schema';
