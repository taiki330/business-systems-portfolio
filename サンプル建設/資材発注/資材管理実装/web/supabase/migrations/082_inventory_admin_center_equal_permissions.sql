-- 082_inventory_admin_center_equal_permissions.sql
-- 棚卸に限り、事務(admin)とセンター(center)が開始・入力・確定まで同じ権限を持つ。
-- それ以外のセンター権限は069以降の限定運用を維持する。

begin;

-- 081適用済み環境で、069の互換ヘルパー定義を誤って広げた状態を修正する。
-- この関数を使う既存RLS/RPCには「事務系だけ」の意味で利用されている箇所がある。
create or replace function public.is_admin_or_center()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() in ('admin', 'internal'), false);
$$;

comment on function public.is_admin_or_center() is
  '互換名。069以降はadmin/internalのみtrue。centerの権限は棚卸等の用途別RPC・RLSで個別に許可する。';

-- 075で実装済みの棚卸RPCだけを、事務・センター共通操作として明示する。
-- current_app_role()は081で未登録ユーザーを__unregistered__へ倒すため、必ず拒否側になる。
revoke execute on function public.start_inventory_count(text) from public, anon;
revoke execute on function public.complete_inventory_count(uuid, jsonb) from public, anon;
grant execute on function public.start_inventory_count(text) to authenticated;
grant execute on function public.complete_inventory_count(uuid, jsonb) to authenticated;

comment on function public.start_inventory_count(text) is
  '事務・センター共通。センター現在庫の棚卸を開始し、開始時点のシステム数量を保存する。';
comment on function public.complete_inventory_count(uuid, jsonb) is
  '事務・センター共通。実在庫数を確定し、差異をセンター在庫と在庫履歴へ反映する。';

-- migration適用後の権限回帰防止。
do $$
begin
  if not has_function_privilege('authenticated', 'public.start_inventory_count(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.complete_inventory_count(uuid,jsonb)', 'EXECUTE') then
    raise exception 'inventory_count_authenticated_execute_missing';
  end if;

  if has_function_privilege('anon', 'public.start_inventory_count(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_inventory_count(uuid,jsonb)', 'EXECUTE') then
    raise exception 'inventory_count_anon_execute_detected';
  end if;
end;
$$;

commit;
notify pgrst, 'reload schema';
