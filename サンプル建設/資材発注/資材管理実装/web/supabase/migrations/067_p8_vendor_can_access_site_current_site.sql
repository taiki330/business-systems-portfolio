-- 067_p8_vendor_can_access_site_current_site.sql
-- 066 適用後に Supabase SQL Editor で実行
-- 在庫調整申請: vendor_can_access_site() が current_site_id() を見ていない問題の修正
--
-- 背景:
--   - 047（Phase 6-3）で追加した vendor_can_access_site(p_site_id) は
--     vendor_sites（1業者:多現場マスタ）のみで判定していた。
--   - 054（P1-E Phase E-1）で「1アカウント＝1現場」の app_users.site_id /
--     current_site_id() を導入したとき、site_product_plans・stock_requests の
--     RLS には site_id ベースの許可条件を OR で追加したが、
--     stock_adjustment_requests（vendor_can_access_site 経由）は対象に
--     含めていなかった。
--   - 在庫調整の申請フォームで保管場所選択を廃止し、常に
--     current_site_id() を申請先として送るようにしたため（アプリ側変更）、
--     vendor_sites に current_site_id() の現場が含まれていないアカウントが
--     あると申請そのものが permission_denied になる。054 と同じ OR 条件を
--     ここにも足して揃える。
--
-- 影響範囲: vendor_can_access_site() を参照する箇所（RLS
--   stock_adjustment_requests_vendor_select ／ RPC request_stock_adjustment）。
--   条件を緩める（OR で追加）だけなので、既存の vendor_sites ベースの許可は
--   そのまま維持される。
--
-- 冪等性: create or replace function のみ。再実行しても安全。

begin;

create or replace function public.vendor_can_access_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_site_id is not null
     and (
       p_site_id = public.current_site_id()
       or exists (
         select 1
           from public.vendor_sites vs
          where vs.vendor_id = public.current_vendor_id()
            and vs.site_id   = p_site_id
       )
     );
$$;

comment on function public.vendor_can_access_site is
  'ログイン中の vendor が担当する現場か（current_site_id() または vendor_sites 経由）。Phase 6-3 / 067 で current_site_id() を追加';

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select prosrc from pg_proc where proname = 'vendor_can_access_site';

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- create or replace function public.vendor_can_access_site(p_site_id uuid)
-- returns boolean
-- language sql
-- stable
-- security definer
-- set search_path = public, pg_temp
-- as $$
--   select p_site_id is not null
--      and exists (
--        select 1
--          from public.vendor_sites vs
--         where vs.vendor_id = public.current_vendor_id()
--           and vs.site_id   = p_site_id
--      );
-- $$;
--
-- comment on function public.vendor_can_access_site is
--   'ログイン中の vendor が担当する現場か（vendor_sites 経由）。Phase 6-3';
--
-- commit;
-- notify pgrst, 'reload schema';
