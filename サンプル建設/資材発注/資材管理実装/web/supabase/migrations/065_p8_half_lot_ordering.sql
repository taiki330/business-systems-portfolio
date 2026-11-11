-- 065_p8_half_lot_ordering.sql
-- 064 適用後に Supabase SQL Editor で実行
-- 半端もん判定を「1束の倍数」から「半束（0.5束）の倍数」に変更する（docs/20 D-20260805-09）
--
-- 背景:
--   053 では「数量が lot_size の倍数でなければ半端もん」としていたが、実際の運用では
--   **0.5束単位での依頼が認められている**（1束20本なら10本ずつ頼める）。
--   このため 10 本の依頼が半端もんとして誤検出されていた。
--
-- 変更点:
--   判定の基準を lot_size ではなく **lot_size / 2（＝発注可能な最小単位）** にする。
--   例（lot_size = 20）:
--     10 → 0.5束     → 半端もんではない（変更前は半端もん扱いだった）
--     20 → 1束       → 半端もんではない
--     30 → 1.5束     → 半端もんではない（変更前は半端もん扱いだった）
--     25 → 1.25束    → 半端もん
--
-- 方針:
--   - 発注可能な最小単位を `order_unit` としてビューに出す。画面が同じ割り算を
--     持たなくて済むようにし、将来 0.5 以外に変える場合の変更点を1か所にまとめる。
--   - `allow_partial_lot`（現場×商品ごとの許可設定）の意味は変えない。
--     true（既定）なら従来どおり判定しない。false のときだけ半束の倍数を要求する。
--   - 判定は警告のみで、依頼の登録・出庫は妨げない（D-20260801-05 の方針を維持）。
--
-- 冪等性: drop view if exists → create view。再実行しても安全。

begin;

drop view if exists public.stock_request_lot_size_status;

create view public.stock_request_lot_size_status
with (security_invoker = on)
as
  select
    r.id           as request_id,
    r.site_id,
    r.product_id,
    r.quantity,
    r.status,
    r.requested_by,
    r.requested_at,
    p.lot_size,
    -- 発注可能な最小単位（半束）。lot_size 未設定の資材は NULL
    (p.lot_size / 2) as order_unit,
    coalesce(sp.allow_partial_lot, true) as allow_partial_lot,
    (
      p.lot_size is not null
      and coalesce(sp.allow_partial_lot, true) = false
      and mod(r.quantity, p.lot_size / 2) <> 0
    ) as is_lot_size_violation
  from public.stock_requests r
  join public.products p
    on p.id = r.product_id
  left join public.site_products sp
    on sp.site_id = r.site_id
   and sp.product_id = r.product_id;

comment on view public.stock_request_lot_size_status is
  '半端もん（半束の倍数以外）の依頼を検出する確認用ビュー。'
  ' 0.5束単位での依頼は認められているため、判定基準は lot_size ではなく lot_size/2（order_unit）。'
  ' 出庫依頼の作成・出庫は妨げない（警告のみ）。事務向け一覧ページ /plans/lot-size で使用する。'
  ' D-20260805-09';

-- 053 と同じく authenticated に SELECT を付与する（drop したため再付与が必要）
grant select on public.stock_request_lot_size_status to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) 列に order_unit が増えていること
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='stock_request_lot_size_status'
--  order by ordinal_position;
--
-- -- (b) GRANT が付いていること
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema='public' and table_name='stock_request_lot_size_status';
-- -- 期待: authenticated / SELECT
--
-- -- (c) 半束の依頼が半端もん扱いされないこと
-- select quantity, lot_size, order_unit, is_lot_size_violation
--   from public.stock_request_lot_size_status
--  where lot_size is not null
--  order by requested_at desc limit 20;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（053 の判定に戻す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
-- drop view if exists public.stock_request_lot_size_status;
-- create view public.stock_request_lot_size_status
-- with (security_invoker = on)
-- as
--   select r.id as request_id, r.site_id, r.product_id, r.quantity, r.status,
--          r.requested_by, r.requested_at, p.lot_size,
--          coalesce(sp.allow_partial_lot, true) as allow_partial_lot,
--          (p.lot_size is not null
--            and coalesce(sp.allow_partial_lot, true) = false
--            and mod(r.quantity, p.lot_size) <> 0) as is_lot_size_violation
--     from public.stock_requests r
--     join public.products p on p.id = r.product_id
--     left join public.site_products sp
--       on sp.site_id = r.site_id and sp.product_id = r.product_id;
-- grant select on public.stock_request_lot_size_status to authenticated;
-- commit;
-- notify pgrst, 'reload schema';
