-- 038_p4_plan_context_rpc.sql
-- 037 適用後に Supabase SQL Editor で実行
-- Phase 4: 出庫依頼作成時に「予定数量・既出庫数量・未処理依頼数量」を表示するための RPC
--
-- 背景（なぜビューを直接 SELECT せず RPC が必要か）:
--   - Phase 3-7 で作成した site_product_plan_status ビューは security_invoker = on のため、
--     参照者自身の RLS が適用される。
--   - ところが vendor は以下のテーブルを参照できない:
--       * stock_ledger      … 027 で参照は is_admin_or_center() に限定（vendor policy なし）
--       * lease_stock_ledger… 031 で参照は is_admin_or_center() に限定
--       * stock_requests    … vendor は「自分が作成した依頼」のみ参照可
--     このため vendor が site_product_plan_status を読むと、
--     shipped_quantity が 0、pending_quantity が自分の依頼分のみ、という
--     「エラーにはならないが数値が過少」という最も危険な形の誤表示になる。
--   - Phase 4 要件2「現場側の出庫依頼時に、予定数量・現在出庫済み・今回依頼・依頼後数量を表示する」
--     を正しく満たすには、vendor にも正しい実績値を見せる必要がある。
--
-- 方針:
--   - SECURITY DEFINER RPC で必要な集計値だけを返す（既存の RPC 設計パターンを踏襲）。
--     vendor に stock_ledger / lease_stock_ledger の参照権を与えることはしない
--     （履歴全体の閲覧は依然として admin/center 限定のまま。最小権限を維持する）。
--   - 認可は RPC 内で明示的に行う:
--       admin / center … 全現場について取得可
--       vendor         … vendor_sites に紐づく担当現場のみ。担当外は permission_denied
--       それ以外       … permission_denied（フェイルクローズ）
--   - 返す値の定義は site_product_plan_status / stock_request_plan_status（034）と一致させる:
--       planned_quantity … site_product_plans.planned_quantity（未登録なら NULL）
--       shipped_quantity … その現場へ入った累計数量（material_movement_ledger の site 側 'in'）
--       pending_quantity … 未処理（requested / accepted）の依頼数量合計
--     ※ shipped / cancelled の依頼は pending に含めない（二重計上防止・Phase 4 要件5）。
--   - 本 RPC は参照専用。予定数量超過でも例外にはせず、単に数値を返すだけにする
--     （Phase 4 要件3「超過時は警告するが、依頼は拒否しない」。
--       出庫や依頼作成を止める制約・トリガーは一切追加しない）。
--
-- 冪等性: create or replace function のみ。再実行しても安全。

begin;

create or replace function public.get_site_product_plan_context(
  p_site_id    uuid,
  p_product_id uuid
)
returns table (
  planned_quantity numeric,
  shipped_quantity numeric,
  pending_quantity numeric,
  plan_exists      boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role     text;
  v_vendor   uuid;
  v_allowed  boolean := false;
begin
  if p_site_id is null or p_product_id is null then
    raise exception 'site_and_product_required';
  end if;

  v_role := public.current_app_role();

  if public.is_admin_or_center() then
    v_allowed := true;
  elsif v_role = 'vendor' then
    v_vendor := public.current_vendor_id();
    select exists (
      select 1 from public.vendor_sites vs
       where vs.vendor_id = v_vendor
         and vs.site_id   = p_site_id
    ) into v_allowed;
  end if;

  if not v_allowed then
    raise exception 'permission_denied: not allowed for this site'
      using errcode = '42501';
  end if;

  return query
  with plan as (
    select p.planned_quantity
      from public.site_product_plans p
     where p.site_id = p_site_id
       and p.product_id = p_product_id
  ),
  shipped as (
    select coalesce(
             sum(case when m.movement_type = 'in' then m.quantity else 0 end),
             0
           ) as qty
      from public.material_movement_ledger m
     where m.site_id    = p_site_id
       and m.product_id = p_product_id
  ),
  pending as (
    select coalesce(sum(r.quantity), 0) as qty
      from public.stock_requests r
     where r.site_id    = p_site_id
       and r.product_id = p_product_id
       and r.status in ('requested', 'accepted')
  )
  select
    (select plan.planned_quantity from plan),
    (select shipped.qty from shipped),
    (select pending.qty from pending),
    exists (select 1 from plan);
end;
$$;

comment on function public.get_site_product_plan_context is
  '出庫依頼作成時の予定数量コンテキスト（予定 / 既出庫 / 未処理依頼）を返す。'
  ' vendor は担当現場のみ取得可。vendor に履歴テーブルの参照権を与えずに正しい実績値を見せるための'
  ' SECURITY DEFINER RPC。参照専用で、超過しても例外にはしない（Phase 4 要件3）。Phase 4';

revoke execute on function public.get_site_product_plan_context(uuid, uuid) from public;
revoke execute on function public.get_site_product_plan_context(uuid, uuid) from anon;
grant  execute on function public.get_site_product_plan_context(uuid, uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) EXECUTE が authenticated のみであること
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='get_site_product_plan_context'
--  order by grantee;
-- -- 期待: authenticated のみ（anon / PUBLIC が無いこと）
--
-- -- (b) search_path が固定されていること
-- select p.proname, p.proconfig
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname='get_site_product_plan_context';
-- -- 期待: proconfig に search_path=public,pg_temp
--
-- -- (c) admin セッションでの動作確認
-- -- select * from public.get_site_product_plan_context('<site_id>', '<product_id>');
--
-- -- (d) vendor セッションで担当外現場を指定すると permission_denied になること（要手動確認）
--
-- -- (e) ビューと値が一致すること（予定が登録済みの現場×商品で比較）
-- -- select s.planned_quantity, s.shipped_quantity, s.pending_quantity
-- --   from public.site_product_plan_status s
-- --  where s.site_id='<site_id>' and s.product_id='<product_id>';
-- -- select * from public.get_site_product_plan_context('<site_id>', '<product_id>');
--
-- -- (f) 出庫を止める制約・トリガーが増えていないこと（超過は警告のみ）
-- select tgname from pg_trigger
--  where tgrelid='public.stock_requests'::regclass and not tgisinternal;
-- -- 期待: stock_requests_set_updated_at と stock_requests_set_original_quantity のみ

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.get_site_product_plan_context(uuid, uuid);
-- commit;
-- notify pgrst, 'reload schema';
