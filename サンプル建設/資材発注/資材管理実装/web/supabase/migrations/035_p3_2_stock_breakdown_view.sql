-- 035_p3_2_stock_breakdown_view.sql
-- 034 適用後に Supabase SQL Editor で実行
-- Phase 3-2: 自社所有 / リース会社別 / 借用単位別 の在庫内訳ビュー
--
-- 方針:
--   - 確定事項「同一商品でも 自社所有 / リース会社A / リース会社B を区別して管理・表示する」
--     および要件定義書 §3 の一覧項目（商品名・自社所有数量・リース会社別数量・合計数量・
--     現在地・借用日・返却期限・未返却数量）を1つのビューで満たす。
--   - 自社在庫（stock_items）とリース在庫（lease_stock_items）を UNION する。
--     どちらのテーブルにも変更を加えない。
--   - security_invoker = on。参照者の RLS がそのまま適用される。
--       admin / center : 全件（リース会社名まで参照可）
--       vendor         : 担当現場の行のみ。lease_companies は vendor に参照権が無いため
--                        LEFT JOIN により会社名は NULL となり、数量のみ確認できる。
--                        （vendor は「自社所有・リース内訳の数量確認」までが権限。確定事項 §9）
--   - 合計数量は画面側で ownership 別の数量を合算する。ビューは明細行を返すことに徹する。
--   - コードレビュー指摘（Critical #4）対応: 「未返却数量」列は返却義務残
--     （received_quantity - returned_quantity・生成列 return_obligation_quantity）を用いる。
--     借用総数基準（quantity - returned_quantity）だと未受入分まで「未返却」に見えてしまうため。
--
-- 冪等性: drop view if exists → create view。再実行しても安全。

begin;

drop view if exists public.material_stock_breakdown;

create view public.material_stock_breakdown
with (security_invoker = on)
as
  -- 自社所有在庫
  select
    si.id                       as row_id,
    'owned'::text               as ownership,
    si.product_id,
    null::uuid                  as lease_company_id,
    null::text                  as lease_company_name,
    null::uuid                  as lease_batch_item_id,
    null::text                  as slip_number,
    null::date                  as borrowed_at,
    null::date                  as return_due_date,
    null::numeric(12, 2)        as return_obligation_quantity,
    si.storage_kind,
    si.site_id,
    si.location,
    si.quantity
  from public.stock_items si

  union all

  -- リース在庫（借用単位ごと）
  select
    lsi.id                      as row_id,
    'leased'::text              as ownership,
    lsi.product_id,
    lsi.lease_company_id,
    lc.name                     as lease_company_name,
    lsi.lease_batch_item_id,
    lb.slip_number,
    lb.borrowed_at,
    lbi.return_due_date,
    lbi.return_obligation_quantity,
    lsi.storage_kind,
    lsi.site_id,
    lsi.location,
    lsi.quantity
  from public.lease_stock_items lsi
  left join public.lease_batch_items lbi on lbi.id = lsi.lease_batch_item_id
  left join public.lease_batches     lb  on lb.id  = lbi.lease_batch_id
  left join public.lease_companies   lc  on lc.id  = lsi.lease_company_id;

comment on view public.material_stock_breakdown is
  '在庫内訳（自社所有 / リース会社別 / 借用単位別）。現在地・借用日・返却期限・未返却数量を含む。Phase 3-2';

grant select on public.material_stock_breakdown to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) ビュー定義と security_invoker
-- select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public' and c.relname='material_stock_breakdown';
-- -- 期待: reloptions に security_invoker=on
--
-- -- (b) 商品別の内訳（自社 / リース会社別 / 合計）
-- select p.name as product,
--        sum(b.quantity) filter (where b.ownership='owned')  as owned_qty,
--        sum(b.quantity) filter (where b.ownership='leased') as leased_qty,
--        sum(b.quantity)                                     as total_qty
--   from public.material_stock_breakdown b
--   join public.products p on p.id = b.product_id
--  group by p.name
--  order by p.name;
--
-- -- (c) リース会社別の内訳
-- select b.lease_company_name, p.name as product, b.location, b.quantity,
--        b.borrowed_at, b.return_due_date, b.return_obligation_quantity
--   from public.material_stock_breakdown b
--   join public.products p on p.id = b.product_id
--  where b.ownership = 'leased'
--  order by b.lease_company_name, p.name;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop view if exists public.material_stock_breakdown;
-- commit;
-- notify pgrst, 'reload schema';
