-- 064_p8_ownership_override.sql
-- 063 適用後に Supabase SQL Editor で実行
-- P1-E: 事務が明細ごとに自社／リースを選べるようにする（docs/20 D-20260805-05）
--
-- 背景:
--   自社／リースの自動判定（059 の product_ownership_kind）は
--   「自社在庫に無く、リース在庫にある商品」だけを leased とする。
--   枠のように**自社とリースの両方で持っている資材は自動では判別できず** owned に寄る。
--   ヒアリングでもクライアントは「こういう明らかな分は判断して」「（混在分は）
--   こっちで手打ちになってしまう」と述べており、**事務が手で直せること**が前提だった。
--
-- 方針:
--   - 明細（stock_requests）ごとに ownership_override を持たせる。
--     NULL = 自動判定に従う / 'owned' = 自社に固定 / 'leased' = リースに固定。
--   - 自動判定の結果は保存しない（在庫状況から都度導出する。二重管理を避ける）。
--     保存するのは「事務が上書きした」という事実だけ。
--   - オーダー単位ではなく明細単位。1オーダーの中に自社とリースが混在するため。
--   - 更新は admin 限定の RPC 経由（承認と同じく事務の作業。set_order_approval と同方針）。

begin;

-- ===========================================================================
-- 1) stock_requests に上書き列を追加
-- ===========================================================================
alter table public.stock_requests
  add column if not exists ownership_override text;

alter table public.stock_requests
  drop constraint if exists stock_requests_ownership_override_check;
alter table public.stock_requests
  add constraint stock_requests_ownership_override_check
  check (ownership_override is null or ownership_override in ('owned', 'leased'));

comment on column public.stock_requests.ownership_override is
  '資材発注書の自社／リース区分を事務が手で上書きした値。'
  ' NULL は自動判定（product_ownership_kind）に従う。D-20260805-05';

-- ===========================================================================
-- 2) set_order_item_ownership(): 明細の自社／リース区分を上書き（admin 限定）
--    p_ownership = 'owned' | 'leased' | NULL（NULL で自動判定に戻す）
-- ===========================================================================
create or replace function public.set_order_item_ownership(
  p_request_id uuid,
  p_ownership  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 紙を見て判断するのは事務（D-20260805-03 ⑤）。センターは対象外。
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_ownership is not null and p_ownership not in ('owned', 'leased') then
    raise exception 'invalid_ownership';
  end if;

  update public.stock_requests
     set ownership_override = p_ownership
   where id = p_request_id;

  if not found then
    raise exception 'stock_request_not_found';
  end if;
end;
$$;

comment on function public.set_order_item_ownership(uuid, text) is
  'admin 限定。資材発注書の明細ごとの自社／リース区分を上書きする。'
  ' NULL を渡すと自動判定に戻す（D-20260805-05）。P1-E';

revoke execute on function public.set_order_item_ownership(uuid, text) from public;
revoke execute on function public.set_order_item_ownership(uuid, text) from anon;
grant  execute on function public.set_order_item_ownership(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='stock_requests'
--    and column_name='ownership_override';
--
-- select proname from pg_proc where proname='set_order_item_ownership';

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.set_order_item_ownership(uuid, text);
-- alter table public.stock_requests
--   drop constraint if exists stock_requests_ownership_override_check;
-- alter table public.stock_requests drop column if exists ownership_override;
-- commit;
-- notify pgrst, 'reload schema';
