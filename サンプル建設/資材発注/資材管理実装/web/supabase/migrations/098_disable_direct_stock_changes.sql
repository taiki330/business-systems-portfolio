-- 098_disable_direct_stock_changes.sql
--
-- 在庫数量は、出庫完了・返却登録・仕入れ・センター間移動・棚卸確定・
-- 在庫調整申請の承認という業務記録を伴う経路だけで変える。
-- 旧「手動入出庫」「在庫メンテ」用 RPC を外部から直接実行できないようにする。

begin;

revoke execute on function public.record_stock_movement(uuid, text, text, numeric)
  from public, anon, authenticated;

revoke execute on function public.adjust_stock_item(uuid, text, numeric, text)
  from public, anon, authenticated;

comment on function public.record_stock_movement(uuid, text, text, numeric) is
  '旧手動入出庫用。直接実行は禁止。出庫完了・返却・仕入れ・センター間移動・棚卸・調整承認を使用する。';

comment on function public.adjust_stock_item(uuid, text, numeric, text) is
  '内部処理用。直接実行は禁止。棚卸・在庫調整申請の承認など、業務記録を伴うRPCからのみ呼び出す。';

commit;

notify pgrst, 'reload schema';
