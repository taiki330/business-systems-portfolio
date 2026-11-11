-- 036_p3_2_vendor_site_stock_select.sql
-- 035 適用後に Supabase SQL Editor で実行
-- Phase 3-2: vendor が担当現場の自社所有在庫を参照できるようにする
--
-- 背景・方針:
--   - 要件定義書 §4-3 で vendor の主な操作として
--       「担当現場の在庫確認」「自社所有資材とリース資材の数量確認」
--     が明記されている。
--   - しかし既存の stock_items_vendor_select（018）は location='center' の厳密一致であり、
--     現場行（location='site:...'）は vendor から一切見えなかった。
--     この状態では在庫内訳画面（/leases/stock）で vendor にリース分しか表示されず、
--     「自社所有とリースの内訳」という要件を満たせない。
--   - そこで、担当現場の行のみを対象とする SELECT policy を追加する。
--     既存の stock_items_vendor_select は変更・削除しない（センター在庫の参照は従来どおり）。
--     PostgreSQL の複数 policy は OR 結合されるため、既存の可視範囲は狭まらない。
--   - 参照のみ。vendor に INSERT / UPDATE / DELETE の policy は与えない。
--   - 他業者の現場は vendor_sites による絞り込みで除外される（要件定義書 §4-3 操作できないもの）。
--   - 対象は stock_items のみ。stock_ledger（履歴）は従来どおり vendor に公開しない。
--
-- 冪等性: drop policy if exists → create policy。再実行しても安全。

begin;

drop policy if exists "stock_items_vendor_site_select" on public.stock_items;

create policy "stock_items_vendor_site_select" on public.stock_items
  for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and storage_kind = 'site'
    and site_id in (
      select vs.site_id
        from public.vendor_sites vs
       where vs.vendor_id = public.current_vendor_id()
    )
  );

comment on policy "stock_items_vendor_site_select" on public.stock_items is
  'vendor は担当現場の自社所有在庫のみ参照可（要件定義書 §4-3）。センター在庫は stock_items_vendor_select が担当';

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) policy が既存分を含めて並んでいること
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='stock_items'
--  order by cmd, policyname;
-- -- 期待: stock_items_read / admin×3 / stock_items_vendor_select / stock_items_vendor_site_select
--
-- -- (b) 既存 policy（センター参照）が変更されていないこと
-- select pg_get_expr(pol.qual, pol.polrelid) as using_expr
--   from pg_policy pol join pg_class c on c.oid = pol.polrelid
--  where c.relname='stock_items' and pol.polname='stock_items_vendor_select';
-- -- 期待: 式に "location = 'center'::text" が含まれ、018 から変わっていない
--
-- -- (c) vendor に書込 policy が無いこと
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='stock_items'
--    and policyname like '%vendor%' and cmd <> 'SELECT';
-- -- 期待: 0 行

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop policy if exists "stock_items_vendor_site_select" on public.stock_items;
-- commit;
-- notify pgrst, 'reload schema';
