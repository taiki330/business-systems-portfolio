-- 021_p1b2_return_from_site.sql
-- 020 適用後に Supabase SQL Editor で実行
-- P1-B Phase2: 返却（現場 → センター）
-- 詳細設計: docs/14 §5-1（方針）。具体化・合意内容は本Phaseの実装前レビュー（会話履歴）を正とする。
--
-- 方針:
--   - stock_returns 専用テーブルを新設（返却イベントの正）。stock_ledger のスキーマは変更しない
--   - stock_ledger には既存語彙のまま site 'out' + center 'in' の2行を記録
--   - return_from_site RPC を新規追加。site 減算・center 加算・ledger 2行・stock_returns 1行を
--     すべて 1 トランザクションで実行する
--   - center 側の加算・ledger 'in' 記録は既存 apply_stock_movement をそのまま再利用する
--     （apply_stock_movement / ship_stock_request 本体は無変更）
--   - site 行の location は既存ヘルパー public.site_stock_location(site_id) をそのまま使う
--   - 現場在庫が 0 になっても stock_items 行は削除しない（既存 quantity>=0 制約のまま残す）
--   - RLS: internal のみ SELECT/INSERT（stock_ledger と同方針）。anon は最初から付与しない
--   - audit_logs は拡張しない（返却履歴は stock_returns を正とする）
--   - 現場間移動・棚卸・差異管理・リース・返却承認フローは対象外

begin;

-- ===========================================================================
-- 1) stock_returns テーブル
-- ===========================================================================
create table if not exists public.stock_returns (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  site_id uuid not null references public.sites (id) on delete restrict,
  quantity numeric(12, 2) not null check (quantity > 0),
  memo text,
  returned_by text,
  created_at timestamptz not null default now()
);

comment on table public.stock_returns is
  '返却イベント（現場→センター）の記録。追記のみ。P1-B Phase2';
comment on column public.stock_returns.returned_by is
  '返却操作者。stock_requests.requested_by 等と同じく当面 text（uuid文字列）運用、将来 uuid 化予定';
comment on column public.stock_returns.memo is
  '任意メモ';

create index if not exists stock_returns_product_id_idx
  on public.stock_returns (product_id);
create index if not exists stock_returns_site_id_idx
  on public.stock_returns (site_id);
create index if not exists stock_returns_created_at_idx
  on public.stock_returns (created_at desc);

-- ===========================================================================
-- 2) RLS: internal のみ SELECT/INSERT。anon は付与しない（A-6完了後の新規テーブルのため）
-- ===========================================================================
alter table public.stock_returns enable row level security;

grant select, insert on table public.stock_returns to authenticated;

drop policy if exists "stock_returns_internal_select" on public.stock_returns;
drop policy if exists "stock_returns_internal_insert" on public.stock_returns;

create policy "stock_returns_internal_select"
  on public.stock_returns for select to authenticated
  using (public.current_app_role() = 'internal');

create policy "stock_returns_internal_insert"
  on public.stock_returns for insert to authenticated
  with check (public.current_app_role() = 'internal');

-- ===========================================================================
-- 3) return_from_site RPC
--    - site 行を for update でロックし、在庫不足なら例外
--    - site 減算 → center 加算（apply_stock_movement 再利用）→ site 側 ledger 'out' 追記
--      → stock_returns 追記、を 1 トランザクションで実行
-- ===========================================================================
create or replace function public.return_from_site(
  p_product_id  uuid,
  p_site_id     uuid,
  p_quantity    numeric,
  p_memo        text default null,
  p_returned_by text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_location text;
  v_site_quantity numeric(12, 2);
  v_return_id     uuid;
begin
  if public.current_app_role() is distinct from 'internal' then
    raise exception 'permission_denied: internal role required'
      using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  v_site_location := public.site_stock_location(p_site_id);

  select si.quantity
    into v_site_quantity
  from public.stock_items si
  where si.product_id = p_product_id
    and si.location   = v_site_location
    and si.storage_kind = 'site'
  for update;

  if v_site_quantity is null then
    raise exception 'site_stock_item_not_found';
  end if;

  if v_site_quantity < p_quantity then
    raise exception 'insufficient_site_stock';
  end if;

  -- site 減算
  update public.stock_items
     set quantity = quantity - p_quantity
   where product_id = p_product_id
     and location    = v_site_location;

  -- center 加算 + center 側 ledger 'in'（既存 apply_stock_movement を再利用・無変更）
  perform public.apply_stock_movement(p_product_id, 'center', 'in', p_quantity);

  -- site 側 ledger 'out'（既存語彙のまま追記）
  insert into public.stock_ledger (product_id, location, movement_type, quantity)
  values (p_product_id, v_site_location, 'out', p_quantity);

  -- 返却イベント記録
  insert into public.stock_returns (product_id, site_id, quantity, memo, returned_by)
  values (p_product_id, p_site_id, p_quantity, p_memo, p_returned_by)
  returning id into v_return_id;

  return v_return_id;
end;
$$;

comment on function public.return_from_site is
  '現場在庫を減算しセンター在庫を加算、stock_ledger に site out / center in を記録、'
  ' stock_returns に返却イベントを記録（1トランザクション）。internal 限定。P1-B Phase2';

revoke execute on function public.return_from_site(uuid, uuid, numeric, text, text) from public;
revoke execute on function public.return_from_site(uuid, uuid, numeric, text, text) from anon;
grant execute on function public.return_from_site(uuid, uuid, numeric, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) テーブル・列の存在確認
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema='public' and table_name='stock_returns'
--  order by ordinal_position;
--
-- -- (b) RLS policy（internal のみ、vendor policy なし）
-- select policyname, roles, cmd
--   from pg_policies
--  where schemaname='public' and tablename='stock_returns';
-- -- 期待: stock_returns_internal_select（select）, stock_returns_internal_insert（insert）の2件のみ
--
-- -- (c) anon には権限が付与されていないこと
-- select grantee, privilege_type
--   from information_schema.table_privileges
--  where table_schema='public' and table_name='stock_returns' and grantee='anon';
-- -- 期待: 0 行
--
-- -- (d) return_from_site の EXECUTE（anon なし / authenticated あり）
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='return_from_site'
--    and grantee in ('anon','authenticated','public')
--  order by grantee;
-- -- 期待: authenticated EXECUTE のみ
--
-- -- (e) apply_stock_movement / ship_stock_request が無変更であること（定義に return_from_site を含まない）
-- select position('return_from_site' in pg_get_functiondef(p.oid)) as pos
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname in ('apply_stock_movement','ship_stock_request');
-- -- 期待: 両方とも 0（無関係）

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
--
-- drop function if exists public.return_from_site(uuid, uuid, numeric, text, text);
--
-- drop policy if exists "stock_returns_internal_select" on public.stock_returns;
-- drop policy if exists "stock_returns_internal_insert" on public.stock_returns;
--
-- drop table if exists public.stock_returns;
--
-- commit;
-- notify pgrst, 'reload schema';
