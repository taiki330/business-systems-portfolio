-- 091_center_master_extensibility.sql
-- 090 適用後に Supabase SQL Editor で実行
-- 地域センターマスタを3拠点固定から拡張可能にする。
-- 既存の関西（stock_location='center'）はそのまま維持し、追加センターだけ
-- 'center:{code}' を自動採番するため、既存の在庫・履歴・RPCとの互換性を保つ。

begin;

-- 089 が設定した3拠点限定チェックを解除する。
alter table public.centers
  drop constraint if exists centers_code_check;

comment on table public.centers is
  '地域センターマスタ。事務が追加・名称変更できる。センターコードは在庫保管場所キーでもあるため作成後は変更しない。';
comment on column public.centers.code is
  '英小文字・数字・ハイフン・アンダースコアの内部コード。作成後は変更しない。kansai は既存互換のため stock_location=center、他は center:{code}。';

-- 直接テーブル更新を許可せず、認可・入力検証を持つ RPC だけで管理する。
create or replace function public.admin_create_center(
  p_code text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
  v_location text;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'center_name_required';
  end if;

  if v_code !~ '^[a-z][a-z0-9_-]{1,29}$' then
    raise exception 'invalid_center_code';
  end if;

  if exists (select 1 from public.centers where code = v_code) then
    raise exception 'center_code_already_exists';
  end if;

  -- kansai は既存データとの互換専用。新規追加は必ず名前空間付きの保管場所にする。
  v_location := case when v_code = 'kansai' then 'center' else 'center:' || v_code end;

  insert into public.centers (code, name, stock_location)
  values (v_code, v_name, v_location)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_update_center_name(
  p_center_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required' using errcode = '42501';
  end if;

  if p_center_id is null or v_name = '' then
    raise exception 'invalid_center';
  end if;

  update public.centers
     set name = v_name
   where id = p_center_id;

  if not found then
    raise exception 'center_not_found';
  end if;
end;
$$;

revoke execute on function public.admin_create_center(text, text) from public, anon;
revoke execute on function public.admin_update_center_name(uuid, text) from public, anon;
grant execute on function public.admin_create_center(text, text) to authenticated;
grant execute on function public.admin_update_center_name(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';
