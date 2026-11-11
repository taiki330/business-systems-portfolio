-- 044_p6_operation_log_trigger_fix.sql
-- 043 適用後に Supabase SQL Editor で実行（緊急度: 高）
-- Phase 6-1 レビュー修正: マスタ更新が操作履歴トリガで失敗する不具合の修正
--
-- 背景（適用済みの開発 Supabase で確認した事象）:
--   update public.products set name = name where id = '<product_id>';
--     → ERROR: record "new" has no field "role"
--   043 の tg_operation_log_master は、app_users 用のガード節を
--     if tg_table_name = 'app_users' and tg_op = 'UPDATE'
--        and new.role is not distinct from old.role ...
--   という「単一の IF 式」で書いていた。PL/pgSQL は IF の条件式をひとつの SQL 文として
--   実行時のレコード型に対して準備するため、products / sites の行で評価すると
--   存在しない new.role の解決に失敗して例外になる（SQL の AND は短絡評価が保証されない）。
--   この結果 043 適用後は products / sites への INSERT・UPDATE・DELETE が全て失敗する。
--
-- 方針:
--   - 043 は適用済みのため直接変更せず、create or replace function で関数本体のみ置き換える。
--   - app_users 固有の列（role / vendor_id）を参照する条件を、tg_table_name で分岐した
--     内側のブロックへ移す。内側の文は当該テーブルのトリガが実行されたときにだけ
--     準備・評価されるため、products / sites では new.role が参照されない。
--   - テーブル・トリガ・log_operation・RLS・権限は 043 のまま変更しない。
--   - 記録される内容（operation / entity_type / detail の before・after）も 043 と同一。
--
-- 冪等性: create or replace function のみ。再実行しても安全。

begin;

create or replace function public.tg_operation_log_master()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity_type text;
  v_operation   text;
  v_entity_id   uuid;
  v_site_id     uuid;
  v_product_id  uuid;
  v_detail      jsonb;
  v_row         jsonb;
begin
  -- 行スナップショット（DELETE では NEW、INSERT では OLD が未割当のため分岐する）
  if tg_op = 'DELETE' then
    v_row    := to_jsonb(old);
    v_detail := jsonb_build_object('before', to_jsonb(old));
  elsif tg_op = 'INSERT' then
    v_row    := to_jsonb(new);
    v_detail := jsonb_build_object('after', to_jsonb(new));
  else
    v_row    := to_jsonb(new);
    v_detail := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
  end if;

  v_entity_id := (v_row ->> 'id')::uuid;

  if tg_table_name = 'products' then
    v_entity_type := 'product';
    v_product_id  := v_entity_id;
    v_operation   := case tg_op
                       when 'INSERT' then 'product.created'
                       when 'UPDATE' then 'product.updated'
                       else 'product.deleted'
                     end;

  elsif tg_table_name = 'sites' then
    v_entity_type := 'site';
    v_site_id     := v_entity_id;
    v_operation   := case tg_op
                       when 'INSERT' then 'site.created'
                       when 'UPDATE' then 'site.updated'
                       else 'site.deleted'
                     end;

  elsif tg_table_name = 'app_users' then
    -- 権限の付与（INSERT）・変更（UPDATE）のみを記録する。
    -- role / vendor_id を参照する条件はこのブロック内に置くこと。
    -- 外側の IF 条件に混ぜると products / sites の行でも式が評価され、
    -- 存在しない列の参照で実行時エラーになる（043 の不具合）。
    if tg_op = 'UPDATE'
       and new.role      is not distinct from old.role
       and new.vendor_id is not distinct from old.vendor_id then
      -- 表示名だけの更新は業務データ変更ではないため記録しない
      return null;
    end if;

    v_entity_type := 'app_user';
    v_operation   := 'user_role.changed';

  else
    return null;
  end if;

  perform public.log_operation(
    v_operation, v_entity_type, v_entity_id,
    v_site_id, v_product_id, null, v_detail
  );

  return null;
end;
$$;

comment on function public.tg_operation_log_master is
  'products / sites / app_users の変更を operation_logs へ記録する AFTER トリガ関数。'
  ' Phase 6-1（044 で app_users 固有列の参照位置を修正）';

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) 資材マスタの更新がエラーにならず、履歴が 1 件増えること
-- --     （name を同じ値で更新するので実データは変わらない）
-- update public.products set name = name
--  where id = (select id from public.products order by created_at limit 1);
-- select operation, entity_type, actor_role, product_id, created_at
--   from public.operation_logs order by created_at desc limit 3;
-- -- 期待: product.updated が 1 件
--
-- -- (b) 現場情報の更新も同様に記録されること
-- update public.sites set name = name
--  where id = (select id from public.sites order by created_at limit 1);
-- select operation, entity_type, site_id from public.operation_logs
--  order by created_at desc limit 1;
-- -- 期待: site.updated
--
-- -- (c) 表示名だけの更新では権限変更として記録されないこと
-- -- update public.app_users set display_name = display_name where id = '<user_id>';
-- -- select count(*) from public.operation_logs where operation = 'user_role.changed';
-- -- 期待: 実行前後で件数が変わらない

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合）
-- ---------------------------------------------------------------------------
-- 043 の tg_operation_log_master 定義を再実行すると、マスタ更新が失敗する状態に戻るため
-- 通常は行わない。トリガごと止める場合は下記。
-- begin;
-- drop trigger if exists products_operation_log on public.products;
-- drop trigger if exists sites_operation_log on public.sites;
-- drop trigger if exists app_users_operation_log on public.app_users;
-- commit;
-- notify pgrst, 'reload schema';
