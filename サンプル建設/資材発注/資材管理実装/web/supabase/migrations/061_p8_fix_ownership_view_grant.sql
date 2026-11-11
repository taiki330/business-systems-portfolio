-- 061_p8_fix_ownership_view_grant.sql
-- 060 適用後に Supabase SQL Editor で実行
--
-- 不具合修正: 059 で作成した product_ownership_kind ビューに GRANT を付け忘れていたため、
-- authenticated ロールから SELECT できず、資材発注書のプレビュー・印刷画面
-- （/orders/[id]/print）がデータ取得に失敗して開けなかった。
--
-- 他のビュー（stock_request_lot_size_status / material_stock_breakdown /
-- site_product_plan_status 等）と同じく authenticated に SELECT を付与する。
-- ビューは security_invoker = on のため、実際に見える行は参照者の RLS に従う
-- （admin/center は在庫を参照できるが、vendor は lease_stock_items を参照できないため
--  リース側が見えず判定が変わる。本ビューは帳票＝admin/center からのみ使用する）。

begin;

grant select on public.product_ownership_kind to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select grantee, privilege_type
--   from information_schema.role_table_grants
--  where table_schema='public' and table_name='product_ownership_kind';
-- -- 期待: authenticated / SELECT

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- revoke select on public.product_ownership_kind from authenticated;
