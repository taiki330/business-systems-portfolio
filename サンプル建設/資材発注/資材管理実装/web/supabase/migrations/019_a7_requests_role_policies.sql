-- 019_a7_requests_role_policies.sql
-- 018 適用後に Supabase SQL Editor で実行
-- P1-A / フェーズ A-7-DB-4: 出庫依頼系（stock_requests / ship_stock_request）の
-- authenticated policy を role 別に分割し、RPC に internal ガードを追加する。
-- 詳細設計: docs/13 §4-5 / §6 / §13-12 / A-7
--
-- 適用前の実 DB 確認結果（2026-06-01）:
--   - stock_requests       : anon=0 / auth=3（select/insert/update）
--   - ship_stock_request   : security definer=true / authenticated execute あり / anon execute なし
--   - status 分布          : requested=18 / accepted=4 / shipped=13 / cancelled=2（total=37）
--   - requested_by 埋まり率: 9/37（28 件 NULL は vendor から見えなくなる・許容）
--
-- 設計方針:
--   - 既存 *_authenticated_* policy（3 件）を drop し、internal 用 + vendor 用に分割
--   - DELETE policy は引き続き作らない（キャンセルは status='cancelled' への UPDATE）
--   - vendor の SELECT/INSERT/UPDATE は policy レベルで以下を強制:
--       SELECT : requested_by = auth.uid()::text
--       INSERT : requested_by = auth.uid()::text かつ status='requested' かつ
--                site_id が vendor_sites（current_vendor_id()）に存在
--       UPDATE : 自分の status='requested' 行を status='cancelled' へ遷移する場合のみ可
--   - ship_stock_request は security definer のため、関数先頭に internal ガード追加（018 と同手法）
--   - anon には触れない（A-6-5 完了）
--   - A-7-app の Server Action / middleware ガードは別フェーズ

begin;

-- ===========================================================================
-- 1) stock_requests : internal 全権 / vendor は自分の依頼を限定的に操作
-- ===========================================================================
drop policy if exists "stock_requests_authenticated_select" on public.stock_requests;
drop policy if exists "stock_requests_authenticated_insert" on public.stock_requests;
drop policy if exists "stock_requests_authenticated_update" on public.stock_requests;

-- ---- internal: 全件 SELECT / INSERT / UPDATE ----
create policy "stock_requests_internal_select"
  on public.stock_requests for select to authenticated
  using (public.current_app_role() = 'internal');

create policy "stock_requests_internal_insert"
  on public.stock_requests for insert to authenticated
  with check (public.current_app_role() = 'internal');

create policy "stock_requests_internal_update"
  on public.stock_requests for update to authenticated
  using (public.current_app_role() = 'internal')
  with check (public.current_app_role() = 'internal');

-- ---- vendor: 自分の依頼のみ SELECT ----
create policy "stock_requests_vendor_select"
  on public.stock_requests for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and requested_by = auth.uid()::text
  );

-- ---- vendor: 自分の担当現場かつ status='requested' な依頼の作成のみ ----
create policy "stock_requests_vendor_insert"
  on public.stock_requests for insert to authenticated
  with check (
    public.current_app_role() = 'vendor'
    and requested_by = auth.uid()::text
    and status       = 'requested'
    and exists (
      select 1
        from public.vendor_sites vs
       where vs.vendor_id = public.current_vendor_id()
         and vs.site_id   = stock_requests.site_id
    )
  );

-- ---- vendor: 自分の requested 依頼を cancelled に遷移する UPDATE のみ ----
--   - using : 対象行が「vendor 自身の requested」であること
--   - with check : 変更後が「vendor 自身の cancelled」であること
--   - これにより accepted/shipped/他人の依頼の改変、note 単独編集、再 requested 化等は不可
create policy "stock_requests_vendor_update_cancel"
  on public.stock_requests for update to authenticated
  using (
    public.current_app_role() = 'vendor'
    and requested_by = auth.uid()::text
    and status       = 'requested'
  )
  with check (
    public.current_app_role() = 'vendor'
    and requested_by = auth.uid()::text
    and status       = 'cancelled'
  );

-- ===========================================================================
-- 2) ship_stock_request : security definer の穴を塞ぐ internal ガード
-- ---------------------------------------------------------------------------
--   - 元定義（005）と同一シグネチャ・同一ロジック
--   - 先頭で current_app_role() = 'internal' を確認し、それ以外は permission_denied
-- ===========================================================================
create or replace function public.ship_stock_request(
  p_request_id uuid,
  p_shipped_by text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status     text;
  v_product_id uuid;
  v_quantity   numeric(12, 2);
  v_ledger_id  uuid;
begin
  if public.current_app_role() is distinct from 'internal' then
    raise exception 'permission_denied: internal role required'
      using errcode = '42501';
  end if;

  select status, product_id, quantity
    into v_status, v_product_id, v_quantity
  from public.stock_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'stock_request_not_found';
  end if;

  if v_status <> 'accepted' then
    raise exception 'invalid_status_transition';
  end if;

  v_ledger_id := public.apply_stock_movement(
    v_product_id, 'center', 'out', v_quantity
  );

  update public.stock_requests
     set status     = 'shipped',
         shipped_at = now(),
         shipped_by = p_shipped_by
   where id = p_request_id;

  return v_ledger_id;
end;
$$;

comment on function public.ship_stock_request is
  'accepted の依頼を shipped にし、center 在庫を OUT 減算・ledger に履歴追加（1トランザクション）。'
  || ' A-7-DB-4 で先頭に internal ガード追加（docs/13 §13-12）。';

-- A-6-5 時点で anon EXECUTE は剥奪済み。create or replace 後は public への
-- 自動付与が発生し得るため、念のため anon / public への EXECUTE を明示剥奪する。
revoke execute on function public.ship_stock_request(uuid, text) from public;
revoke execute on function public.ship_stock_request(uuid, text) from anon;

-- authenticated には EXECUTE 維持（005 / 009 で付与済み・冪等のため再付与）
grant execute on function public.ship_stock_request(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) policy 数（stock_requests = 6: internal×3 + vendor×3）
-- select tablename, count(*) as auth_policies,
--        count(*) filter (where policyname like '%internal%') as internal_cnt,
--        count(*) filter (where policyname like '%vendor%')   as vendor_cnt,
--        count(*) filter (where policyname like '%_authenticated_%') as legacy_cnt
--   from pg_policies
--  where schemaname='public'
--    and tablename='stock_requests'
--    and roles::text like '%authenticated%'
--  group by tablename;
-- -- 期待: auth=6 internal=3 vendor=3 legacy=0
--
-- -- (b) anon は 0 件のまま
-- select count(*) as anon_cnt
--   from pg_policies
--  where schemaname='public' and tablename='stock_requests'
--    and roles::text like '%anon%';
-- -- 期待: 0
--
-- -- (c) ship_stock_request の EXECUTE（anon なし / authenticated あり）
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name='ship_stock_request'
--    and grantee in ('anon','authenticated','public')
--  order by grantee;
-- -- 期待: authenticated EXECUTE のみ
--
-- -- (d) 関数本体に internal ガードが入っていること
-- select position('permission_denied: internal role required'
--                 in pg_get_functiondef(p.oid)) > 0 as has_internal_guard
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and p.proname='ship_stock_request';
-- -- 期待: true
--
-- -- (e) データ無変更
-- select status, count(*) from public.stock_requests group by status order by status;
-- -- 期待: requested=18 accepted=4 shipped=13 cancelled=2（適用前と同一）

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（A-7-DB-4 を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- drop policy if exists "stock_requests_internal_select"      on public.stock_requests;
-- drop policy if exists "stock_requests_internal_insert"      on public.stock_requests;
-- drop policy if exists "stock_requests_internal_update"      on public.stock_requests;
-- drop policy if exists "stock_requests_vendor_select"        on public.stock_requests;
-- drop policy if exists "stock_requests_vendor_insert"        on public.stock_requests;
-- drop policy if exists "stock_requests_vendor_update_cancel" on public.stock_requests;
-- create policy "stock_requests_authenticated_select"
--   on public.stock_requests for select to authenticated using (true);
-- create policy "stock_requests_authenticated_insert"
--   on public.stock_requests for insert to authenticated with check (true);
-- create policy "stock_requests_authenticated_update"
--   on public.stock_requests for update to authenticated using (true) with check (true);
--
-- -- ship_stock_request（005 の本体に戻す）
-- create or replace function public.ship_stock_request(
--   p_request_id uuid,
--   p_shipped_by text default null
-- )
-- returns uuid
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- declare
--   v_status     text;
--   v_product_id uuid;
--   v_quantity   numeric(12, 2);
--   v_ledger_id  uuid;
-- begin
--   select status, product_id, quantity
--     into v_status, v_product_id, v_quantity
--   from public.stock_requests where id = p_request_id for update;
--   if not found then raise exception 'stock_request_not_found'; end if;
--   if v_status <> 'accepted' then raise exception 'invalid_status_transition'; end if;
--   v_ledger_id := public.apply_stock_movement(v_product_id, 'center', 'out', v_quantity);
--   update public.stock_requests
--      set status = 'shipped', shipped_at = now(), shipped_by = p_shipped_by
--    where id = p_request_id;
--   return v_ledger_id;
-- end;
-- $$;
-- revoke execute on function public.ship_stock_request(uuid, text) from public;
-- revoke execute on function public.ship_stock_request(uuid, text) from anon;
-- grant  execute on function public.ship_stock_request(uuid, text) to authenticated;
--
-- commit;
-- notify pgrst, 'reload schema';
