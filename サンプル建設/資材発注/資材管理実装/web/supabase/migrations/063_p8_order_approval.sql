-- 063_p8_order_approval.sql
-- 062 適用後に Supabase SQL Editor で実行
-- P1-E: 事務によるオーダー承認（docs/20 D-20260805-04）
--
-- 背景:
--   実運用は「現場が依頼 → センターが資材発注書を印刷 → 紙が事務に届く →
--   事務が紙のオーダー番号でシステムを開き、承認する」。
--   承認は **センターが出庫する前に事務が OK を出した記録**。
--
-- 重要な設計判断:
--   承認は **記録のみで、出庫をブロックしない**（ユーザー確認済み）。
--   したがって:
--     - stock_requests のステータス（requested/accepted/shipped/cancelled）は**変更しない**。
--       docs/09 のステータス機械には一切手を入れない。
--     - ship_stock_request にも承認チェックを入れない。未承認でも出庫できる。
--     - 承認はオーダー（orders）単位で持つ。事務は紙1枚＝1オーダー単位で承認するため。
--
--   承認の取り消しも許可する（誤操作の訂正のため）。「いつ・誰が」を残すため
--   approved_at / approved_by を両方 NULL に戻す方式にする。

begin;

-- ===========================================================================
-- 1) orders に承認記録の列を追加
-- ===========================================================================
alter table public.orders
  add column if not exists approved_at timestamptz;

alter table public.orders
  add column if not exists approved_by text;

comment on column public.orders.approved_at is
  '事務が承認した日時。NULL は未承認。承認は記録のみで出庫をブロックしない（D-20260805-04）';
comment on column public.orders.approved_by is
  '承認した事務ユーザーの auth uid（stock_requests の *_by と同じく text 運用）';

create index if not exists orders_approved_at_idx on public.orders (approved_at);

-- ===========================================================================
-- 2) set_order_approval(): 承認・承認取消（admin 限定）
--    p_approved = true  → 承認（approved_at=now(), approved_by=実行者）
--    p_approved = false → 承認取消（両方 NULL）
-- ===========================================================================
create or replace function public.set_order_approval(
  p_order_id uuid,
  p_approved boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 承認するのは事務（admin）のみ。センターは承認しない（D-20260805-03 の役割分担）。
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  update public.orders
     set approved_at = case when p_approved then now() else null end,
         approved_by = case when p_approved then auth.uid()::text else null end
   where id = p_order_id;

  if not found then
    raise exception 'order_not_found';
  end if;
end;
$$;

comment on function public.set_order_approval(uuid, boolean) is
  'admin 限定。オーダーの承認・承認取消を記録する。'
  ' 承認は記録のみで出庫をブロックしない（D-20260805-04）。P1-E';

revoke execute on function public.set_order_approval(uuid, boolean) from public;
revoke execute on function public.set_order_approval(uuid, boolean) from anon;
grant  execute on function public.set_order_approval(uuid, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='orders'
--    and column_name in ('approved_at','approved_by');
--
-- select proname from pg_proc where proname='set_order_approval';
--
-- -- 承認は出庫をブロックしないこと（ship_stock_request に承認チェックが無い）
-- select position('approved' in pg_get_functiondef(p.oid)) = 0 as no_approval_check
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and p.proname='ship_stock_request';
-- -- 期待: true

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.set_order_approval(uuid, boolean);
-- alter table public.orders drop column if exists approved_by;
-- alter table public.orders drop column if exists approved_at;
-- commit;
-- notify pgrst, 'reload schema';
