-- 059_p8_order_form_fields.sql
-- 058 適用後に Supabase SQL Editor で実行
-- P1-E Phase E-3: 2026-08-05 ヒアリング（docs/20 D-20260805-01）の確定事項を反映する。
--
-- 反映する決定:
--   #1 納期        : 職人（vendor）がオーダー時に入力。日付＋時刻（15分単位）
--   #2 ヤード積込日: サンプル市Aセンター（center）が確認時に入力（日付のみ）
--   #5 合計重量    : 商品ごとの重量を商品マスタに登録し、帳票で自動算出
--   #6 自社/リース : 「自社在庫に無く、リース在庫にある商品」をリースと判定
--   #8 オーダー番号: システムが自動採番（登録順の連番）
--
-- 方針:
--   - 納期は日付と時刻を1つの timestamptz で持つ（15分単位の制約は UI 側の step で表現し、
--     DB では丸め制約を課さない。運用で例外時刻が必要になった場合に DB 変更を伴わないため）。
--   - オーダー番号は sequence を使い、text 列の DEFAULT で採番する。
--     text のままにするのは、将来クライアントが桁数や接頭辞のある規則を決めた場合に
--     列型を変えずに移行できるようにするため（D-20260801-04 の「枠だけ用意」を踏襲）。
--   - 自社/リース判定はビューで表現する。products に区分列を持たせないのは、
--     区分が「商品の属性」ではなく「その商品を自社在庫として持っているか」という
--     在庫側の事実から導かれるため（二重管理を避ける）。

begin;

-- ===========================================================================
-- 1) orders: 納期・ヤード積込日
-- ===========================================================================
alter table public.orders
  add column if not exists delivery_deadline timestamptz;

alter table public.orders
  add column if not exists yard_loading_date date;

comment on column public.orders.delivery_deadline is
  '納期（日付＋時刻）。職人がオーダー時に入力する。UI は15分単位で選択（D-20260805-01 #1）';
comment on column public.orders.yard_loading_date is
  'ヤード積込日。サンプル市Aセンターがオーダー確認時に入力する（D-20260805-01 #2）';

-- ===========================================================================
-- 2) orders.order_number: 登録順の自動採番
--    既存行（NULL）は作成順にバックフィルする。
-- ===========================================================================
create sequence if not exists public.orders_order_number_seq as bigint start with 1;

-- 既存行を作成順に採番し、シーケンスを次の値へ進める
do $$
declare
  v_row record;
  v_next bigint := 0;
begin
  for v_row in
    select id from public.orders where order_number is null order by created_at, id
  loop
    v_next := nextval('public.orders_order_number_seq');
    update public.orders set order_number = v_next::text where id = v_row.id;
  end loop;
end;
$$;

alter table public.orders
  alter column order_number set default nextval('public.orders_order_number_seq')::text;

comment on column public.orders.order_number is
  'オーダー番号。システムが登録順に自動採番する（D-20260805-01 #8）。'
  ' 将来クライアントが接頭辞・桁数のある規則を定めた場合に備えて text のまま保持する';

-- ===========================================================================
-- 3) products.weight_kg: 合計重量の自動算出用
-- ===========================================================================
alter table public.products
  add column if not exists weight_kg numeric(12, 3);

alter table public.products
  drop constraint if exists products_weight_kg_check;
alter table public.products
  add constraint products_weight_kg_check
  check (weight_kg is null or weight_kg >= 0);

comment on column public.products.weight_kg is
  '1単位あたりの重量(kg)。資材発注書の合計重量を自動算出するために使う。'
  ' NULL は未登録（合計には含めない）。D-20260805-01 #5';

-- ===========================================================================
-- 4) 自社／リース判定ビュー
--    ルール（D-20260805-01 #6）:
--      自社在庫（stock_items）に無く、リース在庫（lease_stock_items）にある → 'leased'
--      それ以外（両方にある／自社のみ／どちらにも無い）               → 'owned'
--    「どちらにも無い」を owned に寄せるのは、リースだと確証が無いものを
--    リース扱いにして誤った帳票を出すより安全なため（両方にある枠等と同じ扱い）。
--
--    security_invoker = on: 参照者の RLS がそのまま効く。本ビューは帳票（admin/center）
--    からのみ参照する。vendor は lease_stock_items を参照できないため使用しない。
-- ===========================================================================
drop view if exists public.product_ownership_kind;

create view public.product_ownership_kind
with (security_invoker = on)
as
  select
    p.id as product_id,
    case
      when not exists (
        select 1 from public.stock_items si where si.product_id = p.id
      )
      and exists (
        select 1 from public.lease_stock_items lsi where lsi.product_id = p.id
      )
      then 'leased'
      else 'owned'
    end as ownership_kind
  from public.products p;

-- 他のビューと同様に authenticated へ SELECT を付与する
-- （付け忘れると帳票画面がデータ取得に失敗する。061 で追補済み）。
grant select on public.product_ownership_kind to authenticated;

comment on view public.product_ownership_kind is
  '資材発注書の自社／リース区分。自社在庫に無くリース在庫にある商品のみ leased。'
  ' 両方に存在する資材（枠等）は owned とし、必要なら事務が手で直す運用（D-20260805-01 #6）';

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL（任意・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) 列の追加確認
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_schema='public' and table_name='orders'
--    and column_name in ('delivery_deadline','yard_loading_date','order_number');
--
-- -- (b) 既存オーダーに番号が入ったこと（NULL が 0 件）
-- select count(*) filter (where order_number is null) as null_count, count(*) as total
--   from public.orders;
--
-- -- (c) 自社／リース判定の分布
-- select ownership_kind, count(*) from public.product_ownership_kind group by ownership_kind;

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL（本 migration を取り消す場合・SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- begin;
-- drop view if exists public.product_ownership_kind;
-- alter table public.products drop constraint if exists products_weight_kg_check;
-- alter table public.products drop column if exists weight_kg;
-- alter table public.orders alter column order_number drop default;
-- drop sequence if exists public.orders_order_number_seq;
-- alter table public.orders drop column if exists yard_loading_date;
-- alter table public.orders drop column if exists delivery_deadline;
-- commit;
-- notify pgrst, 'reload schema';
