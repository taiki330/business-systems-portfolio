-- 007_audit_logs.sql
-- 001〜006 実行後に Supabase SQL Editor で実行
-- 出庫依頼の主要操作を追跡する最小監査ログ（event_type 4 値固定）
-- MVP: 閲覧画面なし・UPDATE/DELETE 不可・汎用 diff なし

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),

  event_type text not null
    check (event_type in (
      'stock_request.created',
      'stock_request.accepted',
      'stock_request.cancelled',
      'stock_request.shipped'
    )),

  request_id uuid references public.stock_requests (id) on delete set null,

  actor text,

  payload jsonb,

  created_at timestamptz not null default now()
);

-- 索引
create index if not exists audit_logs_request_id_idx
  on public.audit_logs (request_id);

create index if not exists audit_logs_event_type_idx
  on public.audit_logs (event_type);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

comment on table public.audit_logs is
  '出庫依頼まわりの最小監査ログ（追記のみ）';
comment on column public.audit_logs.event_type is
  'stock_request.created / accepted / cancelled / shipped';
comment on column public.audit_logs.request_id is
  '対象の出庫依頼 ID（依頼削除時は SET NULL で監査行は残す）';
comment on column public.audit_logs.actor is
  '操作者（認証未実装のため当面 NULL。将来 user_id 化予定）';
comment on column public.audit_logs.payload is
  'イベント別の最小事実のみ（汎用 diff は入れない）';

-- GRANT（開発用・追記のみ）
grant select, insert on table public.audit_logs
  to anon, authenticated;

-- RLS（開発用・002〜006 と同様。INSERT/SELECT のみ）
alter table public.audit_logs enable row level security;

drop policy if exists "audit_logs_anon_select" on public.audit_logs;
drop policy if exists "audit_logs_anon_insert" on public.audit_logs;
drop policy if exists "audit_logs_authenticated_select" on public.audit_logs;
drop policy if exists "audit_logs_authenticated_insert" on public.audit_logs;

create policy "audit_logs_anon_select"
  on public.audit_logs for select to anon using (true);

create policy "audit_logs_anon_insert"
  on public.audit_logs for insert to anon with check (true);

create policy "audit_logs_authenticated_select"
  on public.audit_logs for select to authenticated using (true);

create policy "audit_logs_authenticated_insert"
  on public.audit_logs for insert to authenticated with check (true);

-- ---------------------------------------------------------------------------
-- 実行後の確認（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select to_regclass('public.audit_logs') as audit_logs_table;
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'audit_logs'
--  order by ordinal_position;
-- select conname, pg_get_constraintdef(c.oid)
--   from pg_constraint c join pg_class t on t.oid = c.conrelid
--  where t.relname = 'audit_logs';
-- notify pgrst, 'reload schema';
