-- 005_stock_requests.sql
-- 001〜004 実行後に Supabase SQL Editor で実行
-- 出庫依頼ヘッダ（最小・1依頼=1商品=1数量）と shipped 化用 RPC
-- 仕様根拠: docs/09_出庫依頼_MVP仕様.md

-- ① 依頼ヘッダ
create table if not exists public.stock_requests (
  id uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites (id)    on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity   numeric(12, 2) not null check (quantity > 0),

  status text not null default 'requested'
    check (status in ('requested', 'accepted', 'shipped', 'cancelled')),

  -- 認証未実装のため当面 NULL 運用（将来 user_id へ移行する箱）
  requested_by text,
  accepted_by  text,
  shipped_by   text,

  requested_at timestamptz not null default now(),
  accepted_at  timestamptz,
  shipped_at   timestamptz,
  cancelled_at timestamptz,

  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ② 索引（unique は付けない＝同一 site_id+product_id の未完了複数許容）
create index if not exists stock_requests_status_idx
  on public.stock_requests (status);
create index if not exists stock_requests_site_id_idx
  on public.stock_requests (site_id);
create index if not exists stock_requests_product_id_idx
  on public.stock_requests (product_id);
create index if not exists stock_requests_requested_at_idx
  on public.stock_requests (requested_at desc);

-- ③ updated_at（既存 set_updated_at を再利用）
drop trigger if exists stock_requests_set_updated_at on public.stock_requests;
create trigger stock_requests_set_updated_at
  before update on public.stock_requests
  for each row execute function public.set_updated_at();

comment on table  public.stock_requests is '出庫依頼ヘッダ（1依頼=1商品=1数量）';
comment on column public.stock_requests.status is
  'requested=依頼中, accepted=受付済み, shipped=出庫済み, cancelled=キャンセル';
comment on column public.stock_requests.requested_by is '将来 user_id 化予定（当面 NULL）';
comment on column public.stock_requests.accepted_by  is '将来 user_id 化予定（当面 NULL）';
comment on column public.stock_requests.shipped_by   is '将来 user_id 化予定（当面 NULL）';

-- ④ accepted → shipped を 1 トランザクションで実行
--    在庫減算（apply_stock_movement）とステータス更新を原子化する。
--    location は center 固定（docs/09 §4）。
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
  -- 1) 依頼行をロックして取得
  select status, product_id, quantity
    into v_status, v_product_id, v_quantity
  from public.stock_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'stock_request_not_found';
  end if;

  -- 2) accepted 以外からの shipped は不可
  if v_status <> 'accepted' then
    raise exception 'invalid_status_transition';
  end if;

  -- 3) 在庫減算（在庫不足なら insufficient_stock で例外 → ロールバック）
  v_ledger_id := public.apply_stock_movement(
    v_product_id, 'center', 'out', v_quantity
  );

  -- 4) ステータス更新
  update public.stock_requests
     set status      = 'shipped',
         shipped_at  = now(),
         shipped_by  = p_shipped_by
   where id = p_request_id;

  return v_ledger_id;
end;
$$;

comment on function public.ship_stock_request is
  'accepted の依頼を shipped にし、center 在庫を OUT 減算・ledger に履歴追加（1トランザクション）';

-- ⑤ GRANT（開発用）
grant select, insert, update on table public.stock_requests
  to anon, authenticated;
grant execute on function public.ship_stock_request(uuid, text)
  to anon, authenticated;

-- ⑥ RLS（開発用・002〜004 と同様 anon 全許可）
alter table public.stock_requests enable row level security;

drop policy if exists "stock_requests_anon_select" on public.stock_requests;
drop policy if exists "stock_requests_anon_insert" on public.stock_requests;
drop policy if exists "stock_requests_anon_update" on public.stock_requests;
drop policy if exists "stock_requests_authenticated_select" on public.stock_requests;
drop policy if exists "stock_requests_authenticated_insert" on public.stock_requests;
drop policy if exists "stock_requests_authenticated_update" on public.stock_requests;

create policy "stock_requests_anon_select"
  on public.stock_requests for select to anon using (true);

create policy "stock_requests_anon_insert"
  on public.stock_requests for insert to anon with check (true);

create policy "stock_requests_anon_update"
  on public.stock_requests for update to anon using (true) with check (true);

create policy "stock_requests_authenticated_select"
  on public.stock_requests for select to authenticated using (true);

create policy "stock_requests_authenticated_insert"
  on public.stock_requests for insert to authenticated with check (true);

create policy "stock_requests_authenticated_update"
  on public.stock_requests for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 実行後の確認（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select to_regclass('public.stock_requests') as stock_requests_table;
-- select proname, pg_get_function_identity_arguments(oid) as args
--   from pg_proc where proname = 'ship_stock_request';
-- notify pgrst, 'reload schema';
