-- 047_p6_stock_adjustment_requests.sql
-- 046 適用後に Supabase SQL Editor で実行
-- Phase 6-3: 在庫調整の申請 → 承認 / 却下フロー
--
-- 背景・方針:
--   - 現場（vendor）またはセンター（center）が在庫の食い違いを申請し、事務（admin）が承認・却下する。
--     承認されたときにのみ在庫数量を増減し、在庫台帳に履歴を残し、操作履歴を保存する。
--   - 既存の adjust_stock_item（admin の直接補正）は廃止しない。事務が自分で気づいた分を
--     即時補正する手段として残し、本フローはそれと並走する追加経路とする。
--     承認時の在庫書込も adjust_stock_item を内部で呼ぶことで、在庫・台帳への
--     書込経路を 037 で一本化した設計から逸脱させない。
--   - 申請の入力は「実際に数えた数量」（絶対値）とする。現場担当者にとって自然な入力であり、
--     数え直した結果をそのまま打てるため。ただし承認時に適用するのは
--     「申請時のシステム数量との差分（delta）」とする。絶対値をそのまま適用すると、
--     申請から承認までの間に出庫・返却で在庫が動いた場合にその移動を打ち消してしまう。
--     差分適用なら移動を保持したまま食い違い分だけを補正できる。
--   - 同一の在庫（商品 × 保管場所）に未処理の申請が複数あると、同じ食い違いに対する
--     delta が二重に適用されうる。部分ユニーク索引で未処理は 1 件のみに制限する。
--   - 禁止事項（要件）:
--       申請者本人による承認 / 二重承認 / 承認済みデータの再処理
--     いずれも承認 RPC 内で FOR UPDATE + 状態・申請者チェックにより拒否する。
--   - vendor は自分の担当現場の在庫についてのみ申請・参照できる。
--     admin は本フローでの申請者にはならない（直接補正の手段を持つため）。
--   - role 文字列を policy / 関数に直書きしないため、026 と同じ方針で
--     is_vendor() / vendor_can_access_site() ヘルパーを追加する。
--
-- 冪等性: create table if not exists / create or replace function / drop policy if exists /
--         create index if not exists。再実行しても安全。

begin;

-- ===========================================================================
-- 1) 役割ヘルパー（026 と同方針: security definer / stable / search_path 固定）
-- ===========================================================================
create or replace function public.is_vendor()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_app_role() = 'vendor';
$$;

comment on function public.is_vendor is
  'ログイン中のユーザーが vendor（現場・業者）か。Phase 6-3';

create or replace function public.vendor_can_access_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_site_id is not null
     and exists (
       select 1
         from public.vendor_sites vs
        where vs.vendor_id = public.current_vendor_id()
          and vs.site_id   = p_site_id
     );
$$;

comment on function public.vendor_can_access_site is
  'ログイン中の vendor が担当する現場か（vendor_sites 経由）。Phase 6-3';

revoke execute on function public.is_vendor() from public;
revoke execute on function public.is_vendor() from anon;
grant  execute on function public.is_vendor() to authenticated;

revoke execute on function public.vendor_can_access_site(uuid) from public;
revoke execute on function public.vendor_can_access_site(uuid) from anon;
grant  execute on function public.vendor_can_access_site(uuid) to authenticated;

-- ===========================================================================
-- 2) stock_adjustment_requests テーブル
-- ===========================================================================
create table if not exists public.stock_adjustment_requests (
  id uuid primary key default gen_random_uuid(),

  product_id uuid not null references public.products (id) on delete restrict,

  -- 対象在庫の位置。location は storage_kind / site_id から RPC が組み立てる
  -- （書込経路は RPC のみのため、three 列の整合は構築時点で保証される）。
  storage_kind text not null check (storage_kind in ('center', 'site')),
  site_id      uuid references public.sites (id) on delete restrict,
  location     text not null,

  -- 申請者が実際に数えた数量（絶対値）
  counted_quantity numeric(12, 2) not null check (counted_quantity >= 0),
  -- 申請時点のシステム上の数量（スナップショット）
  system_quantity  numeric(12, 2) not null check (system_quantity >= 0),
  -- 承認時に適用する差分。絶対値ではなくこれを適用する（冒頭の方針を参照）
  delta            numeric(12, 2) not null check (delta <> 0),

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),

  note         text,
  decided_note text,

  requested_by uuid,
  requested_at timestamptz not null default now(),
  decided_by   uuid,
  decided_at   timestamptz,

  -- 承認時に adjust_stock_item が作成した在庫台帳行（追跡用）
  applied_ledger_id uuid,

  constraint stock_adjustment_requests_delta_consistency
    check (delta = counted_quantity - system_quantity),
  constraint stock_adjustment_requests_site_shape
    check ((storage_kind = 'site' and site_id is not null)
        or (storage_kind = 'center' and site_id is null)),
  constraint stock_adjustment_requests_decided_consistency
    check ((status = 'pending') = (decided_at is null))
);

comment on table public.stock_adjustment_requests is
  '在庫調整の申請。承認されたときにのみ在庫へ delta を適用する。Phase 6-3';
comment on column public.stock_adjustment_requests.counted_quantity is
  '申請者が実際に数えた数量（絶対値）。承認時にそのまま設定するのではなく delta を適用する';
comment on column public.stock_adjustment_requests.delta is
  '承認時に現在庫へ加算する差分。申請〜承認の間の出庫・返却を打ち消さないために絶対値ではなく差分を適用する';

-- 同一在庫に未処理の申請が複数あると delta が二重適用されうるため 1 件に制限する
create unique index if not exists stock_adjustment_requests_pending_unique
  on public.stock_adjustment_requests (product_id, location)
  where status = 'pending';

create index if not exists stock_adjustment_requests_status_idx
  on public.stock_adjustment_requests (status, requested_at desc);
create index if not exists stock_adjustment_requests_site_idx
  on public.stock_adjustment_requests (site_id, requested_at desc);

-- ===========================================================================
-- 3) RLS / GRANT
--    参照: admin / center は全件、vendor は担当現場のみ。
--    書込 policy は作らない（SECURITY DEFINER RPC 経由のみ）。
-- ===========================================================================
alter table public.stock_adjustment_requests enable row level security;

revoke all on table public.stock_adjustment_requests from public, anon, authenticated;
grant select on table public.stock_adjustment_requests to authenticated;

drop policy if exists "stock_adjustment_requests_internal_select" on public.stock_adjustment_requests;
drop policy if exists "stock_adjustment_requests_vendor_select" on public.stock_adjustment_requests;

create policy "stock_adjustment_requests_internal_select"
  on public.stock_adjustment_requests for select to authenticated
  using (public.is_admin_or_center());

create policy "stock_adjustment_requests_vendor_select"
  on public.stock_adjustment_requests for select to authenticated
  using (public.is_vendor() and public.vendor_can_access_site(site_id));

-- ===========================================================================
-- 4) request_stock_adjustment: 申請（center / vendor）
-- ===========================================================================
create or replace function public.request_stock_adjustment(
  p_product_id       uuid,
  p_storage_kind     text,
  p_site_id          uuid,
  p_counted_quantity numeric,
  p_note             text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_location text;
  v_current  numeric(12, 2);
  v_delta    numeric(12, 2);
  v_id       uuid;
begin
  -- 権限: center は全在庫、vendor は担当現場のみ。admin は直接補正を使うため対象外。
  if public.is_center() then
    null;
  elsif public.is_vendor() then
    if p_storage_kind <> 'site' or not public.vendor_can_access_site(p_site_id) then
      raise exception 'permission_denied: vendor can request own sites only'
        using errcode = '42501';
    end if;
  else
    raise exception 'permission_denied: center or vendor role required'
      using errcode = '42501';
  end if;

  if p_storage_kind not in ('center', 'site') then
    raise exception 'invalid_storage_kind';
  end if;
  if p_storage_kind = 'site' and p_site_id is null then
    raise exception 'site_required';
  end if;
  if p_storage_kind = 'center' and p_site_id is not null then
    raise exception 'site_not_allowed_for_center';
  end if;
  if p_counted_quantity is null or p_counted_quantity < 0 then
    raise exception 'quantity_must_be_non_negative';
  end if;

  v_location := case
                  when p_storage_kind = 'center' then 'center'
                  else public.site_stock_location(p_site_id)
                end;

  select si.quantity into v_current
    from public.stock_items si
   where si.product_id = p_product_id
     and si.location   = v_location;

  v_current := coalesce(v_current, 0);
  v_delta   := p_counted_quantity - v_current;

  if v_delta = 0 then
    raise exception 'no_adjustment_needed';
  end if;

  -- 同一在庫の未処理申請は 1 件のみ（部分ユニーク索引と同じ条件を事前に判定して
  -- 分かりやすいエラーにする）
  if exists (
    select 1 from public.stock_adjustment_requests r
     where r.product_id = p_product_id
       and r.location   = v_location
       and r.status     = 'pending'
  ) then
    raise exception 'pending_request_exists';
  end if;

  insert into public.stock_adjustment_requests (
    product_id, storage_kind, site_id, location,
    counted_quantity, system_quantity, delta, note, requested_by
  )
  values (
    p_product_id, p_storage_kind, p_site_id, v_location,
    p_counted_quantity, v_current, v_delta, nullif(trim(p_note), ''),
    public.current_actor_id()
  )
  returning id into v_id;

  perform public.log_operation(
    'stock_adjustment.requested', 'stock_adjustment', v_id,
    p_site_id, p_product_id, v_delta,
    jsonb_build_object(
      'counted_quantity', p_counted_quantity,
      'system_quantity',  v_current,
      'delta',            v_delta,
      'location',         v_location
    )
  );

  return v_id;
end;
$$;

comment on function public.request_stock_adjustment is
  '在庫調整を申請する（center は全在庫 / vendor は担当現場のみ）。この時点では在庫を変更しない。Phase 6-3';

revoke execute on function public.request_stock_adjustment(uuid, text, uuid, numeric, text) from public;
revoke execute on function public.request_stock_adjustment(uuid, text, uuid, numeric, text) from anon;
grant  execute on function public.request_stock_adjustment(uuid, text, uuid, numeric, text) to authenticated;

-- ===========================================================================
-- 5) approve_stock_adjustment: 承認（admin のみ・ここで初めて在庫が動く）
-- ===========================================================================
create or replace function public.approve_stock_adjustment(
  p_id   uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req       public.stock_adjustment_requests%rowtype;
  v_current   numeric(12, 2);
  v_new       numeric(12, 2);
  v_ledger_id uuid;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  select * into v_req
    from public.stock_adjustment_requests
   where id = p_id
   for update;

  if not found then
    raise exception 'adjustment_request_not_found';
  end if;

  -- 二重承認・承認済みデータの再処理を防ぐ
  if v_req.status <> 'pending' then
    raise exception 'adjustment_request_already_decided';
  end if;

  -- 申請者本人の承認を防ぐ
  if v_req.requested_by is not null
     and v_req.requested_by = public.current_actor_id() then
    raise exception 'self_approval_not_allowed';
  end if;

  -- 現在庫をロックしてから差分を適用する（申請時の絶対値ではなく delta を足す）
  select si.quantity into v_current
    from public.stock_items si
   where si.product_id = v_req.product_id
     and si.location   = v_req.location
   for update;

  v_current := coalesce(v_current, 0);
  v_new     := v_current + v_req.delta;

  if v_new < 0 then
    raise exception 'resulting_quantity_negative';
  end if;

  -- 在庫・台帳への書込は既存の adjust_stock_item に一本化する（037 の設計を維持）
  v_ledger_id := public.adjust_stock_item(
    v_req.product_id, v_req.location, v_new, 'inventory_adjustment'
  );

  update public.stock_adjustment_requests
     set status            = 'approved',
         decided_by        = public.current_actor_id(),
         decided_at        = now(),
         decided_note      = nullif(trim(p_note), ''),
         applied_ledger_id = v_ledger_id
   where id = p_id;

  perform public.log_operation(
    'stock_adjustment.approved', 'stock_adjustment', p_id,
    v_req.site_id, v_req.product_id, v_req.delta,
    jsonb_build_object(
      'delta',            v_req.delta,
      'quantity_before',  v_current,
      'quantity_after',   v_new,
      'location',         v_req.location,
      'ledger_id',        v_ledger_id
    )
  );

  return v_ledger_id;
end;
$$;

comment on function public.approve_stock_adjustment is
  '在庫調整申請を承認し、差分を在庫へ適用する（admin のみ）。申請者本人の承認・二重承認は拒否。Phase 6-3';

revoke execute on function public.approve_stock_adjustment(uuid, text) from public;
revoke execute on function public.approve_stock_adjustment(uuid, text) from anon;
grant  execute on function public.approve_stock_adjustment(uuid, text) to authenticated;

-- ===========================================================================
-- 6) reject_stock_adjustment: 却下（admin のみ・在庫は動かさない）
-- ===========================================================================
create or replace function public.reject_stock_adjustment(
  p_id   uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.stock_adjustment_requests%rowtype;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  select * into v_req
    from public.stock_adjustment_requests
   where id = p_id
   for update;

  if not found then
    raise exception 'adjustment_request_not_found';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'adjustment_request_already_decided';
  end if;

  update public.stock_adjustment_requests
     set status       = 'rejected',
         decided_by   = public.current_actor_id(),
         decided_at   = now(),
         decided_note = nullif(trim(p_note), '')
   where id = p_id;

  perform public.log_operation(
    'stock_adjustment.rejected', 'stock_adjustment', p_id,
    v_req.site_id, v_req.product_id, v_req.delta,
    jsonb_build_object('delta', v_req.delta, 'location', v_req.location)
  );
end;
$$;

comment on function public.reject_stock_adjustment is
  '在庫調整申請を却下する（admin のみ）。在庫は一切変更しない。Phase 6-3';

revoke execute on function public.reject_stock_adjustment(uuid, text) from public;
revoke execute on function public.reject_stock_adjustment(uuid, text) from anon;
grant  execute on function public.reject_stock_adjustment(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) policy / 権限
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='stock_adjustment_requests';
-- -- 期待: internal_select / vendor_select の SELECT 2 件のみ
-- select grantee, privilege_type from information_schema.table_privileges
--  where table_schema='public' and table_name='stock_adjustment_requests' order by grantee;
-- -- 期待: authenticated は SELECT のみ、anon は 0 行
--
-- -- (b) 申請 → 承認で在庫が動くこと（center で申請し admin で承認するのが本来の流れ）
-- select r.status, r.counted_quantity, r.system_quantity, r.delta, r.location,
--        p.name as product
--   from public.stock_adjustment_requests r
--   join public.products p on p.id = r.product_id
--  order by r.requested_at desc limit 10;
--
-- -- (c) 承認済みの再処理が拒否されること
-- -- select public.approve_stock_adjustment('<approved_id>');
-- -- 期待: adjustment_request_already_decided
--
-- -- (d) 未処理の重複申請が拒否されること
-- -- 同一 product/location で 2 回 request_stock_adjustment を呼ぶ
-- -- 期待: 2 回目が pending_request_exists

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合）
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.reject_stock_adjustment(uuid, text);
-- drop function if exists public.approve_stock_adjustment(uuid, text);
-- drop function if exists public.request_stock_adjustment(uuid, text, uuid, numeric, text);
-- drop policy if exists "stock_adjustment_requests_internal_select" on public.stock_adjustment_requests;
-- drop policy if exists "stock_adjustment_requests_vendor_select" on public.stock_adjustment_requests;
-- drop table if exists public.stock_adjustment_requests;
-- drop function if exists public.vendor_can_access_site(uuid);
-- drop function if exists public.is_vendor();
-- commit;
-- notify pgrst, 'reload schema';
