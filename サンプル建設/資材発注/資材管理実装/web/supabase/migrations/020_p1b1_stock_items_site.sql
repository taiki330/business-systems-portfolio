-- 020_p1b1_stock_items_site.sql
-- 019 適用後に Supabase SQL Editor で実行
-- P1-B Phase1: 現場在庫（storage_kind='site' / site_id）の土台
-- 詳細設計: docs/14 §5-1（方針）。具体化・合意内容は本Phaseの実装前レビュー（会話履歴）を正とする。
--
-- 方針:
--   - stock_items に storage_kind / site_id を追加。既存 unique(product_id, location) は維持・変更しない
--   - site 行の location は 'site:' || site_id を互換値として使用し、
--     この組み立てルールは public.site_stock_location() の1箇所に集約する（ハードコーディング防止）
--   - ship_stock_request を直接拡張し、center OUT と同一トランザクションで site IN を行う（v2並走はしない）
--   - stock_ledger のスキーマ・movement_type 語彙は変更しない（既存 'in' を site 側にもそのまま使う）
--   - RLS: stock_items_vendor_select（018 で作成済み）は location = 'center' の厳密一致のため、
--     site 行（location='site:...'）は元々対象外。本ファイルは policy を変更しない（末尾の確認SQLで検証）
--   - 返却・履歴拡張（stock_ledger への site_id/reference列追加）・リース・棚卸・差異管理は対象外（次Phase）

begin;

-- ===========================================================================
-- 1) stock_items 拡張
-- ===========================================================================
alter table public.stock_items
  add column if not exists storage_kind text not null default 'center'
    check (storage_kind in ('center', 'site')),
  add column if not exists site_id uuid null
    references public.sites (id) on delete restrict;

alter table public.stock_items
  drop constraint if exists stock_items_storage_site_consistency;

alter table public.stock_items
  add constraint stock_items_storage_site_consistency
  check (
    (storage_kind = 'center' and site_id is null)
    or (storage_kind = 'site' and site_id is not null)
  );

comment on column public.stock_items.storage_kind is
  'center=センター倉庫 / site=現場在庫。P1-B Phase1 で追加';
comment on column public.stock_items.site_id is
  'storage_kind=site のとき必須。sites.id を参照（on delete restrict）。P1-B Phase1 で追加';

create index if not exists stock_items_site_id_idx
  on public.stock_items (site_id)
  where site_id is not null;

-- ===========================================================================
-- 2) site 行の location 互換値を組み立てる共通ヘルパー
--    既存 unique(product_id, location) を満たすため、site 行にも一意な location 値を入れる。
--    'site:' || site_id という組み立てルールをこの1箇所にのみ持たせる。
-- ===========================================================================
create or replace function public.site_stock_location(p_site_id uuid)
returns text
language sql
immutable
as $$
  select 'site:' || p_site_id::text;
$$;

comment on function public.site_stock_location is
  'site 行の stock_items.location 互換値（''site:''||site_id）を組み立てる。P1-B Phase1';

-- ===========================================================================
-- 3) ship_stock_request 拡張: center OUT に加えて同一トランザクションで site IN
--    - 元定義（019_a7_requests_role_policies.sql）の internal ガード・ステータス遷移チェックは維持
--    - stock_ledger の movement_type は既存 'in' を再利用（スキーマ変更なし）
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
  v_status        text;
  v_product_id    uuid;
  v_quantity      numeric(12, 2);
  v_site_id       uuid;
  v_site_location text;
  v_ledger_id     uuid;
begin
  if public.current_app_role() is distinct from 'internal' then
    raise exception 'permission_denied: internal role required'
      using errcode = '42501';
  end if;

  select status, product_id, quantity, site_id
    into v_status, v_product_id, v_quantity, v_site_id
  from public.stock_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'stock_request_not_found';
  end if;

  if v_status <> 'accepted' then
    raise exception 'invalid_status_transition';
  end if;

  -- center OUT（既存ロジック・無変更）
  v_ledger_id := public.apply_stock_movement(
    v_product_id, 'center', 'out', v_quantity
  );

  -- site IN（新規: P1-B Phase1）
  v_site_location := public.site_stock_location(v_site_id);

  insert into public.stock_items (product_id, location, storage_kind, site_id, quantity)
  values (v_product_id, v_site_location, 'site', v_site_id, 0)
  on conflict (product_id, location) do nothing;

  update public.stock_items
     set quantity = quantity + v_quantity
   where product_id = v_product_id
     and location   = v_site_location;

  insert into public.stock_ledger (product_id, location, movement_type, quantity)
  values (v_product_id, v_site_location, 'in', v_quantity);

  update public.stock_requests
     set status     = 'shipped',
         shipped_at = now(),
         shipped_by = p_shipped_by
   where id = p_request_id;

  return v_ledger_id;
end;
$$;

comment on function public.ship_stock_request is
  'accepted の依頼を shipped にし、center 在庫を OUT・現場(site)在庫を IN、ledger に履歴追加（1トランザクション）。'
  ' P1-B Phase1 で現場IN処理を追加（docs/14 §5-1）。internal ガードは A-7-DB-4 のまま維持。';

revoke execute on function public.ship_stock_request(uuid, text) from public;
revoke execute on function public.ship_stock_request(uuid, text) from anon;
grant execute on function public.ship_stock_request(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) 列・制約が追加されていること
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema='public' and table_name='stock_items'
--    and column_name in ('storage_kind','site_id')
--  order by column_name;
--
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'public.stock_items'::regclass
--    and conname in ('stock_items_storage_site_consistency','stock_items_site_id_fkey');
--
-- -- (b) 既存 unique(product_id, location) が維持されていること
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'public.stock_items'::regclass
--    and contype = 'u';
-- -- 期待: stock_items_product_id_location_key が変わらず存在
--
-- -- (c) 既存データが無回帰（全行 center / storage_kind='center' / site_id is null）
-- select storage_kind, site_id, count(*)
--   from public.stock_items
--  group by storage_kind, site_id;
--
-- -- (d) vendor 用 RLS が site 行を除外できていること（location='center' 厳密一致の確認）
-- select pg_get_expr(pol.qual, pol.polrelid) as using_expr
--   from pg_policy pol
--   join pg_class c on c.oid = pol.polrelid
--  where c.relname = 'stock_items' and pol.polname = 'stock_items_vendor_select';
-- -- 期待: 式に "location = 'center'::text" が含まれる
--   → site 行(location='site:...')は文字列が一致しないため、vendor には元々見えない。
--   → 実際にアプリで vendor ユーザーが /stock/sites に到達不能であることは access-rules.ts のテスト手順で確認する。
--
-- -- (e) ship_stock_request の EXECUTE（anon なし / authenticated あり）
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='ship_stock_request'
--    and grantee in ('anon','authenticated','public')
--  order by grantee;
-- -- 期待: authenticated EXECUTE のみ
--
-- -- (f) ship_stock_request 本体に site IN 処理が入っていること
-- select position('site_stock_location' in pg_get_functiondef(p.oid)) > 0 as has_site_logic
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname='ship_stock_request';
-- -- 期待: true

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- -- ship_stock_request を 019 の定義に戻す
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
--   if public.current_app_role() is distinct from 'internal' then
--     raise exception 'permission_denied: internal role required'
--       using errcode = '42501';
--   end if;
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
-- -- stock_items を元に戻す
-- drop index if exists public.stock_items_site_id_idx;
-- alter table public.stock_items drop constraint if exists stock_items_storage_site_consistency;
-- alter table public.stock_items drop column if exists site_id;
-- alter table public.stock_items drop column if exists storage_kind;
--
-- drop function if exists public.site_stock_location(uuid);
--
-- commit;
-- notify pgrst, 'reload schema';
