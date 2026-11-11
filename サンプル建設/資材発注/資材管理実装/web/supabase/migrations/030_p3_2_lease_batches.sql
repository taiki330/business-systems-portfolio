-- 030_p3_2_lease_batches.sql
-- 029 適用後に Supabase SQL Editor で実行
-- Phase 3-2: リース借用ヘッダー（lease_batches）＋ 借用明細（lease_batch_items）
--
-- 方針:
--   - 要件定義書 §2「リース管理の単位」に従い、ヘッダー＋明細の2階層で管理する。
--   - 借用単位 = lease_batch_items の1行。同一リース会社・同一商品でも借用日/伝票が異なれば
--     別ヘッダー・別明細となるため、返却期限の違いを自然に区別できる（要件定義書 §15-3）。
--   - 未返却数量は列として保存しない。quantity - returned_quantity で都度計算する（確定事項）。
--     参照用に生成列 unreturned_quantity（stored generated）を置き、SQL/画面双方で同じ式を使う。
--     ※ この列は「借用総数に対する未返却」であり、返却期限・警告判定には使わない（下記参照）。
--   - コードレビュー指摘（Critical）への対応:
--     (1) 承認後は lease_batches / lease_batch_items を直接 UPDATE/DELETE できない。
--         RLS の admin_update / admin_delete を「親バッチが draft のときのみ」に制限する。
--         承認後の数量・状態変更は 032 の SECURITY DEFINER RPC のみが行える
--         （RPC は関数所有者権限で実行され RLS を経由しないため、この制限の影響を受けない）。
--         訂正はレコードの上書きではなく、RPC が stock_ledger 相当の履歴
--         （lease_stock_ledger）に理由・操作者・日時を追記する形で行う。
--     (2) lease_batches の作成は 032 の create_lease_batch RPC 一本化に伴い、
--         直接 INSERT policy を廃止する（クライアントからの直接ヘッダー作成を禁止）。
--         lease_batch_items の INSERT/UPDATE/DELETE は「親バッチが draft のときのみ」
--         admin に許可する（draft 中の明細編集用。承認後は上記(1)と同様に禁止）。
--     (4) 部分受入・返却残の是正: 受入が数量に届かないまま納品が完了するケースに対応するため
--         receiving_closed 系列を追加する。返却義務残は
--           received_quantity - returned_quantity （未受入分は返却対象に含めない）
--         であり、生成列 return_obligation_quantity として持つ。
--         完了判定（032 の refresh_lease_batch_status）は「受入完了（数量到達 or 受入終了）
--         かつ 返却義務残ゼロ」を実受入数基準で行う。
--   - 業務フロー（確定事項）:
--       admin が借用登録(draft) → admin が承認(approved) → 納品 → center が受入確定(receive RPC)
--     未承認(draft)の借用は受入できない。現場直送でも admin 承認が必須。
--   - status は「登録済み/受入待ち/一部受入/受入済み/全量返却済み/キャンセル」を
--     draft / approved / receiving / received / closed / cancelled で表現する。
--     期限超過は保存せず return_due_date と return_obligation_quantity から都度判定する。
--   - RLS: 参照=admin+center / 書込=admin（draft のみ）。center の受入・返却は
--     032 の SECURITY DEFINER RPC（RLS バイパス）で行う。
--     vendor は borrow 情報（リース会社・伝票）に一切アクセスできない。
--   - 026/027 のヘルパー関数（is_admin / is_admin_or_center）のみを参照し、
--     role 文字列を policy 内に直接書かない。
--
-- 冪等性: create table if not exists / add column if not exists /
--         drop policy if exists → create policy。再実行しても安全。

begin;

-- ===========================================================================
-- 1) lease_batches（リース借用ヘッダー）
-- ===========================================================================
create table if not exists public.lease_batches (
  id uuid primary key default gen_random_uuid(),

  lease_company_id uuid not null
    references public.lease_companies (id) on delete restrict,

  slip_number text,
  borrowed_at  date not null default current_date,

  -- 納品先: センター納品 or 現場直送。現場直送でも admin 承認必須（確定事項）
  delivery_kind    text not null default 'center'
    check (delivery_kind in ('center', 'site')),
  delivery_site_id uuid references public.sites (id) on delete restrict,

  note text,

  status text not null default 'draft'
    check (status in ('draft', 'approved', 'receiving', 'received', 'closed', 'cancelled')),

  registered_by uuid references public.app_users (id) on delete set null,
  approved_by   uuid references public.app_users (id) on delete set null,
  approved_at   timestamptz,
  cancelled_at  timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lease_batches
  drop constraint if exists lease_batches_delivery_consistency;

alter table public.lease_batches
  add constraint lease_batches_delivery_consistency
  check (
    (delivery_kind = 'center' and delivery_site_id is null)
    or (delivery_kind = 'site' and delivery_site_id is not null)
  );

comment on table public.lease_batches is
  'リース借用ヘッダー（1伝票 = 1リース会社 × 1納品先）。作成は 032 の create_lease_batch RPC のみ。Phase 3-2';
comment on column public.lease_batches.delivery_kind is
  'center=センター納品 / site=現場直送。現場直送でも admin 承認後のみ受入可';
comment on column public.lease_batches.status is
  'draft=登録済(未承認) / approved=承認済(受入待ち) / receiving=一部受入 / received=受入済 / closed=全量返却済 / cancelled=キャンセル';
comment on column public.lease_batches.registered_by is '借用を登録した admin（app_users.id）';
comment on column public.lease_batches.approved_by is '借用を承認した admin（app_users.id）';

create index if not exists lease_batches_company_idx
  on public.lease_batches (lease_company_id);
create index if not exists lease_batches_status_idx
  on public.lease_batches (status);
create index if not exists lease_batches_status_borrowed_idx
  on public.lease_batches (status, borrowed_at desc);
create index if not exists lease_batches_delivery_site_idx
  on public.lease_batches (delivery_site_id)
  where delivery_site_id is not null;

drop trigger if exists lease_batches_set_updated_at on public.lease_batches;
create trigger lease_batches_set_updated_at
  before update on public.lease_batches
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2) lease_batch_items（リース借用明細 = 借用単位）
-- ===========================================================================
create table if not exists public.lease_batch_items (
  id uuid primary key default gen_random_uuid(),

  lease_batch_id uuid not null
    references public.lease_batches (id) on delete cascade,
  product_id uuid not null
    references public.products (id) on delete restrict,

  quantity numeric(12, 2) not null check (quantity > 0),

  -- 返却期限。未定の場合があるため NULL 許容（要件定義書 §12）
  return_due_date date,

  received_quantity numeric(12, 2) not null default 0
    check (received_quantity >= 0),
  returned_quantity numeric(12, 2) not null default 0
    check (returned_quantity >= 0),

  -- 未受入のまま納品を打ち切る場合の記録（Critical #4）。
  -- 受入完了の判定は「quantity に到達」または「receiving_closed=true」のいずれかとする。
  receiving_closed        boolean not null default false,
  receiving_closed_at     timestamptz,
  receiving_closed_by     uuid references public.app_users (id) on delete set null,
  receiving_closed_reason text,

  -- 未返却数量（借用総数基準） = 借用数量 - 返却済み数量（確定事項。保存値ではなく式で導出）
  -- 参考値であり、返却期限の警告・リース会社への返却可否判定には使わない。
  unreturned_quantity numeric(12, 2)
    generated always as (quantity - returned_quantity) stored,

  -- 返却義務残（Critical #4） = 受入済み数量 - 返却済み数量。
  -- 未受入分は返却対象に含めない。返却期限の警告・返却 RPC の上限判定はこちらを使う。
  return_obligation_quantity numeric(12, 2)
    generated always as (received_quantity - returned_quantity) stored,

  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lease_batch_items
  drop constraint if exists lease_batch_items_received_within_quantity;
alter table public.lease_batch_items
  add constraint lease_batch_items_received_within_quantity
  check (received_quantity <= quantity);

alter table public.lease_batch_items
  drop constraint if exists lease_batch_items_returned_within_received;
alter table public.lease_batch_items
  add constraint lease_batch_items_returned_within_received
  check (returned_quantity <= received_quantity);

alter table public.lease_batch_items
  drop constraint if exists lease_batch_items_closed_reason_required;
alter table public.lease_batch_items
  add constraint lease_batch_items_closed_reason_required
  check (
    (receiving_closed = false)
    or (receiving_closed = true and receiving_closed_reason is not null)
  );

comment on table public.lease_batch_items is
  'リース借用明細（= 借用単位）。同一商品でも借用日・返却期限が異なれば別行。'
  ' draft 中のみ直接編集可。承認後は 032 の RPC のみが更新できる。Phase 3-2';
comment on column public.lease_batch_items.quantity is '借用数量';
comment on column public.lease_batch_items.received_quantity is '受入済み数量（center が受入確定した累計）';
comment on column public.lease_batch_items.returned_quantity is 'リース会社へ返却済みの累計数量';
comment on column public.lease_batch_items.receiving_closed is
  '未受入のまま受入を終了したか（欠品・納品打ち切り等）。true の場合、受入完了とみなす';
comment on column public.lease_batch_items.receiving_closed_reason is
  '受入終了の理由（receiving_closed=true のとき必須）';
comment on column public.lease_batch_items.unreturned_quantity is
  '未返却数量（借用総数基準） = 借用数量 - 返却済み数量。参考値（生成列）';
comment on column public.lease_batch_items.return_obligation_quantity is
  '返却義務残 = 受入済み数量 - 返却済み数量。未受入分を含まない（生成列）';
comment on column public.lease_batch_items.return_due_date is
  '返却期限。未定の場合は NULL。期限超過は本列と return_obligation_quantity から都度判定する';

create index if not exists lease_batch_items_batch_idx
  on public.lease_batch_items (lease_batch_id);
create index if not exists lease_batch_items_product_idx
  on public.lease_batch_items (product_id);
create index if not exists lease_batch_items_due_date_idx
  on public.lease_batch_items (return_due_date)
  where return_due_date is not null;
create index if not exists lease_batch_items_batch_product_idx
  on public.lease_batch_items (lease_batch_id, product_id);

drop trigger if exists lease_batch_items_set_updated_at on public.lease_batch_items;
create trigger lease_batch_items_set_updated_at
  before update on public.lease_batch_items
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 3) GRANT（authenticated のみ。anon には一切付与しない）
--    lease_batches への INSERT は付与しない（作成は create_lease_batch RPC のみ）。
-- ===========================================================================
grant select, update, delete on table public.lease_batches      to authenticated;
grant select, insert, update, delete on table public.lease_batch_items  to authenticated;

-- ===========================================================================
-- 4) RLS
--    参照=admin+center / 書込=admin かつ「親バッチが draft のときのみ」。
--    承認後の状態・数量変更は 032 の SECURITY DEFINER RPC 経由（RLS をバイパス）。
-- ===========================================================================
alter table public.lease_batches     enable row level security;
alter table public.lease_batch_items enable row level security;

drop policy if exists "lease_batches_read"         on public.lease_batches;
drop policy if exists "lease_batches_admin_insert" on public.lease_batches;
drop policy if exists "lease_batches_admin_update" on public.lease_batches;
drop policy if exists "lease_batches_admin_delete" on public.lease_batches;

create policy "lease_batches_read" on public.lease_batches
  for select to authenticated using (public.is_admin_or_center());

-- INSERT policy は作らない: 作成は 032 の create_lease_batch RPC のみ（RLS を経由しない）。

create policy "lease_batches_admin_update" on public.lease_batches
  for update to authenticated
  using (public.is_admin() and status = 'draft')
  with check (public.is_admin() and status = 'draft');
create policy "lease_batches_admin_delete" on public.lease_batches
  for delete to authenticated
  using (public.is_admin() and status = 'draft');

drop policy if exists "lease_batch_items_read"         on public.lease_batch_items;
drop policy if exists "lease_batch_items_admin_insert" on public.lease_batch_items;
drop policy if exists "lease_batch_items_admin_update" on public.lease_batch_items;
drop policy if exists "lease_batch_items_admin_delete" on public.lease_batch_items;

create policy "lease_batch_items_read" on public.lease_batch_items
  for select to authenticated using (public.is_admin_or_center());

-- draft 中の明細追加（create_lease_batch RPC 以外での手動追加）のみ許可
create policy "lease_batch_items_admin_insert" on public.lease_batch_items
  for insert to authenticated
  with check (
    public.is_admin()
    and exists (
      select 1 from public.lease_batches b
       where b.id = lease_batch_items.lease_batch_id
         and b.status = 'draft'
    )
  );

create policy "lease_batch_items_admin_update" on public.lease_batch_items
  for update to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.lease_batches b
       where b.id = lease_batch_items.lease_batch_id
         and b.status = 'draft'
    )
  )
  with check (
    public.is_admin()
    and exists (
      select 1 from public.lease_batches b
       where b.id = lease_batch_items.lease_batch_id
         and b.status = 'draft'
    )
  );

create policy "lease_batch_items_admin_delete" on public.lease_batch_items
  for delete to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.lease_batches b
       where b.id = lease_batch_items.lease_batch_id
         and b.status = 'draft'
    )
  );

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) テーブル・列
-- select table_name, column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name in ('lease_batches','lease_batch_items')
--  order by table_name, ordinal_position;
--
-- -- (b) 生成列が stored generated であること
-- select column_name, is_generated, generation_expression
--   from information_schema.columns
--  where table_schema='public' and table_name='lease_batch_items'
--    and column_name in ('unreturned_quantity','return_obligation_quantity');
--
-- -- (c) lease_batches に INSERT policy が無いこと（RPC 経由のみ）
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='lease_batches'
--  order by cmd, policyname;
-- -- 期待: SELECT / UPDATE / DELETE の3件のみ（INSERT が無い）
--
-- -- (d) draft 以外では UPDATE/DELETE が拒否されること（要手動確認: admin セッションで
-- --     status='approved' の行に対し直接 UPDATE を試み、0 rows affected になること）
--
-- -- (e) 既存テーブルが無変更であること
-- select count(*) from pg_policies
--  where schemaname='public' and tablename in ('stock_items','stock_ledger','stock_requests');

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop table if exists public.lease_batch_items;
-- drop table if exists public.lease_batches;
-- commit;
-- notify pgrst, 'reload schema';
