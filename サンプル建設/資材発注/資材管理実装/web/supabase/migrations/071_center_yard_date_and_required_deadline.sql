-- 071_center_yard_date_and_required_deadline.sql
-- 070 適用後に Supabase SQL Editor で実行
-- center は参照専用を維持しつつ、帳票に必要なヤード積込日だけを更新可能にする。

begin;

-- 069 の最終防衛トリガーを更新する。
-- center が変更できるのは orders.yard_loading_date だけで、他列を同時に変えた更新は拒否する。
create or replace function public.prevent_center_data_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_app_role() = 'center' then
    if tg_table_name = 'orders'
       and tg_op = 'UPDATE'
       and (to_jsonb(new) - 'yard_loading_date') is not distinct from
           (to_jsonb(old) - 'yard_loading_date') then
      return new;
    end if;

    raise exception 'permission_denied: center role is read only except yard loading date'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.prevent_center_data_changes() is
  'center を参照専用にする最終防衛。orders.yard_loading_date のみ更新を許可する。D-20260806-06。';

-- 069 で is_admin_or_center を admin/internal 専用にしたため、帳票用途の本RPCは
-- current_app_role を明示して center を許可する。
create or replace function public.update_order_yard_loading_date(
  p_order_id uuid,
  p_yard_loading_date date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_app_role() not in ('admin', 'center', 'internal') then
    raise exception 'permission_denied: admin or center role required'
      using errcode = '42501';
  end if;

  update public.orders
     set yard_loading_date = p_yard_loading_date
   where id = p_order_id;

  if not found then
    raise exception 'order_not_found';
  end if;
end;
$$;

comment on function public.update_order_yard_loading_date(uuid, date) is
  'admin/center 限定。ヤード積込日を登録する。center はこの列だけ更新可能。D-20260806-06。';

commit;

notify pgrst, 'reload schema';

-- ROLLBACK:
-- 069 の prevent_center_data_changes と 060 の update_order_yard_loading_date を再実行すること。
