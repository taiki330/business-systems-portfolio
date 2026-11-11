-- 053_lot_size_warning_only.sql
-- 052 適用後に Supabase SQL Editor で実行
-- 半端もん機能の方針転換: フェイルクローズ(依頼拒否) → 警告のみ(事務が一覧で確認)
--
-- 背景（ユーザー指示・2026-07-30）:
--   052 では「半端もんが許可されていない現場×資材で、数量がセット数の倍数でなければ
--   出庫依頼の作成自体を拒否する」フェイルクローズ設計にしていた。
--   その後の指示で「半端な数の依頼が現場から来た場合でも発注はいつも通りできるように
--   してほしい。そのうえで事務がそれを認知できるようにしたい」と方針が変わったため、
--   ブロッキングをやめ、既存の「予定数量超過」機能（034/038、/plans/over）と同じ
--   「警告のみ・確認用ビュー＋一覧ページ」の設計に揃える。
--
-- 方針:
--   - 052 で追加した BEFORE INSERT/UPDATE トリガー（check_stock_request_lot_size）は削除する。
--     出庫依頼の作成・数量変更は常に成功するようになる（半端もんでも拒否されない）。
--   - products.lot_size / site_products.allow_partial_lot のカラムはそのまま維持する
--     （「セット数」「半端もんを許可するか」という設定自体は引き続き必要。
--     意味だけが「制約」から「警告対象の判定材料」に変わる）。
--   - stock_request_plan_status（予定数量超過確認用ビュー・034/039）と同じ形で
--     stock_request_lot_size_status ビューを新設し、依頼ごとに
--     lot_size 設定済み かつ allow_partial_lot=false かつ数量が非倍数 のとき
--     is_lot_size_violation=true を返す。事務向け一覧ページ（/plans/lot-size）で使用する。
--   - ビューは security_invoker のため、閲覧範囲は products/site_products/stock_requests の
--     既存 RLS（vendor は自分の依頼・自分の担当現場のみ等）にそのまま従う。
--
-- 冪等性: drop trigger/function if exists / create or replace view /
--         grant は再実行しても安全。

begin;

-- ===========================================================================
-- 1) ブロッキングトリガー・関数を削除（052 の巻き戻し）
-- ===========================================================================
drop trigger if exists stock_requests_check_lot_size on public.stock_requests;
drop function if exists public.check_stock_request_lot_size();

-- ===========================================================================
-- 2) 半端もん確認用ビュー（警告のみ。出庫依頼の作成・出庫は妨げない）
-- ===========================================================================
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
    coalesce(sp.allow_partial_lot, true) as allow_partial_lot,
    (
      p.lot_size is not null
      and coalesce(sp.allow_partial_lot, true) = false
      and mod(r.quantity, p.lot_size) <> 0
    ) as is_lot_size_violation
  from public.stock_requests r
  join public.products p
    on p.id = r.product_id
  left join public.site_products sp
    on sp.site_id = r.site_id
   and sp.product_id = r.product_id;

comment on view public.stock_request_lot_size_status is
  '半端もん（セット数の倍数以外）の依頼を検出する確認用ビュー。'
  ' 出庫依頼の作成・出庫は妨げない（警告のみ）。事務向け一覧 /plans/lot-size で使用。';

grant select on public.stock_request_lot_size_status to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) ブロッキングトリガーが消えていること
-- select tgname from pg_trigger
--  where tgrelid='public.stock_requests'::regclass and not tgisinternal;
-- -- 期待: stock_requests_check_lot_size が含まれていないこと
--
-- -- (b) 半端もんの依頼を作成しても拒否されないこと
-- -- insert into public.stock_requests (site_id, product_id, quantity)
-- --   values ('<site_id>', '<lot_size=50かつallow_partial_lot=falseの product_id>', 60);
-- -- → 成功するはず
--
-- -- (c) ビューで is_lot_size_violation=true になっていること
-- -- select * from public.stock_request_lot_size_status where is_lot_size_violation;
--
-- -- (d) ビューの select 権限
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema='public' and table_name='stock_request_lot_size_status';

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消し、052 のブロッキング仕様に戻す場合）
-- ---------------------------------------------------------------------------
-- begin;
-- drop view if exists public.stock_request_lot_size_status;
--
-- create or replace function public.check_stock_request_lot_size()
-- returns trigger
-- language plpgsql
-- as $$
-- declare
--   v_lot_size numeric(12, 2);
--   v_allow    boolean;
-- begin
--   select p.lot_size into v_lot_size from public.products p where p.id = new.product_id;
--   if v_lot_size is not null then
--     select sp.allow_partial_lot into v_allow
--       from public.site_products sp
--      where sp.site_id = new.site_id and sp.product_id = new.product_id;
--     if coalesce(v_allow, true) = false and mod(new.quantity, v_lot_size) <> 0 then
--       raise exception 'lot_size_violation'
--         using detail = format(
--           'quantity=%s lot_size=%s product_id=%s site_id=%s',
--           new.quantity, v_lot_size, new.product_id, new.site_id
--         );
--     end if;
--   end if;
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists stock_requests_check_lot_size on public.stock_requests;
-- create trigger stock_requests_check_lot_size
--   before insert or update of quantity, product_id, site_id
--   on public.stock_requests
--   for each row execute function public.check_stock_request_lot_size();
-- commit;
-- notify pgrst, 'reload schema';
