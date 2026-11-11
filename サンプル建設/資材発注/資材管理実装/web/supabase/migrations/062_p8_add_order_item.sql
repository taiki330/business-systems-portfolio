-- 062_p8_add_order_item.sql
-- 061 適用後に Supabase SQL Editor で実行
-- P1-E: 既存オーダーへの明細追加（docs/20 D-20260805-03 ⑤(b)）
--
-- 背景:
--   実際の運用は「センターが資材発注書を印刷 → 紙が事務に届く → 事務が紙の
--   オーダー番号でシステムを開き、センターが紙に手書きした追加分を登録する」。
--   このため **事務（admin）／センター（center）が既存オーダーに明細を追加できる**必要がある。
--
-- 現状の制約:
--   stock_requests の INSERT policy は vendor 用（stock_requests_vendor_insert）のみ。
--   admin/center は INSERT できない。
--
-- 方針:
--   - admin/center 向けの広い INSERT policy は作らず、SECURITY DEFINER RPC に限定する
--     （どのオーダーに・どの状態で追加できるかを関数内で強制したいため。
--      update_stock_request_quantity（056）と同じ考え方）。
--   - 追加した明細は vendor 由来の明細と同じく status='requested' で始める。
--     受付・出庫・キャンセルは既存フローのまま（docs/09 を壊さない）。
--   - requested_by には実行者（事務／センター）の uuid を入れる。
--     「誰が追加したか」を追跡できるようにするため、元の依頼者で偽装しない。

begin;

create or replace function public.add_order_item(
  p_order_id   uuid,
  p_product_id uuid,
  p_quantity   numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site_id uuid;
  v_request_id uuid;
begin
  if not public.is_admin_or_center() then
    raise exception 'permission_denied: admin or center role required'
      using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity';
  end if;

  select site_id into v_site_id
    from public.orders
   where id = p_order_id;

  if not found then
    raise exception 'order_not_found';
  end if;

  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'invalid_product_id';
  end if;

  insert into public.stock_requests (
    site_id, product_id, quantity, requested_by, order_id
  ) values (
    v_site_id, p_product_id, p_quantity, auth.uid()::text, p_order_id
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.add_order_item(uuid, uuid, numeric) is
  'admin/center 限定。既存オーダーに出庫依頼明細を追加する。'
  ' センターが紙に手書きした追加分を事務が登録する運用のため（D-20260805-03 ⑤(b)）。P1-E';

revoke execute on function public.add_order_item(uuid, uuid, numeric) from public;
revoke execute on function public.add_order_item(uuid, uuid, numeric) from anon;
grant  execute on function public.add_order_item(uuid, uuid, numeric) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc where proname = 'add_order_item';

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- drop function if exists public.add_order_item(uuid, uuid, numeric);
