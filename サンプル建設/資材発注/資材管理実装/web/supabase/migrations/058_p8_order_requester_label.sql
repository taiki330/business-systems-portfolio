-- 058_p8_order_requester_label.sql
-- 057 適用後に Supabase SQL Editor で実行
-- 資材発注書の「発注者名」を、オーダーを作成したアカウントの表示名から取得する。
-- app_users の他ユーザー参照は通常RLSで制限されるため、admin/center が帳票を
-- 表示する用途に限って SECURITY DEFINER 関数経由で公開する。

begin;

create or replace function public.get_order_requester_label(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(trim(au.display_name), '')
    from public.orders o
    left join public.app_users au on au.id::text = o.requested_by
   where o.id = p_order_id
     and public.is_admin_or_center();
$$;

comment on function public.get_order_requester_label(uuid) is
  'admin/center が資材発注書に表示する、オーダー作成アカウントの表示名。P1-E Phase E-3。';

revoke execute on function public.get_order_requester_label(uuid) from public;
revoke execute on function public.get_order_requester_label(uuid) from anon;
grant execute on function public.get_order_requester_label(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ROLLBACK SQL:
-- drop function if exists public.get_order_requester_label(uuid);
