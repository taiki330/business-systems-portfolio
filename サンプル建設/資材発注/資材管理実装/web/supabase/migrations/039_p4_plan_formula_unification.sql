-- 039_p4_plan_formula_unification.sql
-- 038 適用後に Supabase SQL Editor で実行
-- Phase 4（コードレビュー対応）: 予定数量超過の判定式を全レイヤで統一する
--
-- 統一する式:
--   依頼後見込数量 = 既出庫数量 + 他の未処理依頼数量 + 今回依頼数量
--   超過数量       = max(0, 依頼後見込数量 - 予定数量)
--   「未処理」は stock_requests.status in ('requested','accepted') のみ。
--   shipped / cancelled は未処理に含めない（二重計上防止）。
--
-- 各レイヤでの現れ方（すべて上式と一致する）:
--   (a) site_product_plan_status（現場×商品の集計。「今回依頼」という概念が無い）
--         expected = shipped + pending
--       → 既に上式と一致しているため本 migration では変更しない（034 のまま）。
--
--   (b) stock_request_plan_status（依頼1件ごと）
--         expected = shipped + 他の未処理 + 今回依頼
--       ここで「今回依頼」は、その依頼自身が未処理(requested/accepted)のときのみ加算する。
--       出庫済み(shipped)の依頼の数量は既に shipped_quantity（在庫台帳）に含まれており、
--       キャンセル済みの依頼は実行されないため、いずれも加算してはならない。
--       この規則を適用すると、どの行でも結果的に
--         expected = shipped + 未処理合計（その依頼が未処理ならそれ自身を含む）
--       となり、(a) と完全に同じ値になる。
--       ※ 旧実装は「他の未処理依頼」を一切加算していなかったため、
--         同一現場×商品に複数の未処理依頼がある場合に見込数量を過少評価していた。
--         これが本 migration の主たる修正点。
--
--   (c) get_site_product_plan_context RPC（依頼作成画面用・038）
--         まだ保存されていない「今回入力中の数量」は pending に含まれないため、
--         RPC は shipped と pending を別々に返し、画面側で
--           expected = shipped + pending + 入力中の数量
--         を計算する。これも上式と一致する。
--
-- 併せて対応するレビュー指摘:
--   [#5] RPC に site / product の存在確認を追加する。存在しない ID でゼロ値を返すと
--        「予定も実績も無い現場」と区別できず誤解を招くため、固定のエラーコードを返す。
--        vendor に対しては担当現場の確認を先に行い、担当外の場合は商品の存在有無に
--        関わらず permission_denied とする（商品マスタの存在を推測させないため）。
--   [#6] lease_stock_ledger に (product_id, site_id) の複合インデックスを追加する。
--        stock_ledger には 037 で (product_id, site_id, created_at desc) を作成済みだが、
--        lease_stock_ledger 側は product_id 単独・site_id 部分インデックス・
--        (product_id, lease_company_id, created_at) しか無く、
--        「現場×商品」で絞る集計（material_movement_ledger 経由の shipped 算出）に
--        効く複合インデックスが存在しないため。
--
-- 超過しても依頼は登録できる仕様は維持する（本 migration でも出庫・依頼を止める
-- 制約・トリガーは一切追加しない）。
--
-- 冪等性: create or replace view / create or replace function /
--         create index if not exists。再実行しても安全。

begin;

-- ===========================================================================
-- 1) stock_request_plan_status: 「他の未処理依頼」を見込に含めるよう修正
-- ===========================================================================
create or replace view public.stock_request_plan_status
with (security_invoker = on)
as
  with shipped as (
    select m.site_id, m.product_id,
           sum(case when m.movement_type = 'in' then m.quantity else 0 end)
             as shipped_quantity
      from public.material_movement_ledger m
     where m.site_id is not null
     group by m.site_id, m.product_id
  ),
  pending as (
    select r.site_id, r.product_id, sum(r.quantity) as pending_quantity
      from public.stock_requests r
     where r.status in ('requested', 'accepted')
     group by r.site_id, r.product_id
  ),
  base as (
    select
      r.id                                     as request_id,
      r.site_id,
      r.product_id,
      r.status,
      r.requested_by,
      r.requested_at,
      coalesce(r.original_quantity, r.quantity) as requested_quantity,
      r.quantity                               as adjusted_quantity,
      (r.quantity is distinct from coalesce(r.original_quantity, r.quantity))
                                                as is_adjusted,
      pl.planned_quantity,
      coalesce(s.shipped_quantity, 0)          as shipped_quantity,
      -- 他の未処理依頼数量 = 同一現場×商品の未処理合計 − （この依頼が未処理ならその数量）
      coalesce(pd.pending_quantity, 0)
        - case when r.status in ('requested', 'accepted') then r.quantity else 0 end
                                               as other_pending_quantity,
      -- 今回依頼数量: 未処理の依頼のみ加算する。
      --   shipped … その数量は既に shipped_quantity（在庫台帳）に含まれる
      --   cancelled … 実行されないため加算しない
      case when r.status in ('requested', 'accepted') then r.quantity else 0 end
                                               as counted_request_quantity,
      (pl.planned_quantity is null)            as plan_missing
    from public.stock_requests r
    left join public.site_product_plans pl
      on pl.site_id = r.site_id and pl.product_id = r.product_id
    left join shipped s
      on s.site_id = r.site_id and s.product_id = r.product_id
    left join pending pd
      on pd.site_id = r.site_id and pd.product_id = r.product_id
  ),
  computed as (
    select
      base.*,
      -- 統一式: 既出庫 + 他の未処理 + 今回依頼
      shipped_quantity + other_pending_quantity + counted_request_quantity
        as expected_quantity
    from base
  )
  -- 列順は 034 の既存ビューと完全に一致させる（1〜15 列目）。
  -- create or replace view は既存列の名前・型・順序の変更を許さないため、
  -- 追加列 other_pending_quantity は必ず末尾（16 列目）に置く。
  --   1..15: request_id, site_id, product_id, status, requested_by, requested_at,
  --          requested_quantity, adjusted_quantity, is_adjusted, planned_quantity,
  --          shipped_quantity, expected_quantity, over_quantity, is_over, plan_missing
  --   16   : other_pending_quantity（新規・末尾追加）
  select
    request_id, site_id, product_id, status, requested_by, requested_at,
    requested_quantity, adjusted_quantity, is_adjusted, planned_quantity,
    shipped_quantity, expected_quantity,
    case
      -- キャンセル済みの依頼は「超過依頼」として管理者に提示しない
      -- （実行されない依頼を超過一覧に出しても対処のしようがないため）
      when status = 'cancelled' then null
      when planned_quantity is null then null
      else greatest(0, expected_quantity - planned_quantity)
    end as over_quantity,
    case
      when status = 'cancelled' then false
      when planned_quantity is null then false
      else expected_quantity > planned_quantity
    end as is_over,
    plan_missing,
    other_pending_quantity
  from computed;

comment on view public.stock_request_plan_status is
  '出庫依頼ごとの予定数量比較。見込 = 既出庫 + 他の未処理依頼 + 今回依頼（未処理の依頼のみ自身を加算）。'
  ' shipped/cancelled は自身の数量を二重加算しない。cancelled は超過対象外。'
  ' site_product_plan_status と同じ値になる。admin の超過確認用。Phase 4（式統一）';

-- ===========================================================================
-- 2) get_site_product_plan_context: site / product の存在確認を追加
--    （038 の定義を置き換える。返す列は変更しないため画面側の互換性は保たれる）
-- ===========================================================================
create or replace function public.get_site_product_plan_context(
  p_site_id    uuid,
  p_product_id uuid
)
returns table (
  planned_quantity numeric,
  shipped_quantity numeric,
  pending_quantity numeric,
  plan_exists      boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role    text;
  v_vendor  uuid;
  v_allowed boolean := false;
begin
  if p_site_id is null or p_product_id is null then
    raise exception 'site_and_product_required';
  end if;

  v_role := public.current_app_role();

  -- 認可を先に判定する。vendor が担当外現場を指定した場合、
  -- 商品の存在確認より前に permission_denied で打ち切ることで、
  -- 担当外現場・商品マスタの存在有無を推測されないようにする。
  if public.is_admin_or_center() then
    -- admin / center は全現場を参照できるため、まず現場の存在を確認する
    if not exists (select 1 from public.sites s where s.id = p_site_id) then
      raise exception 'site_not_found';
    end if;
    v_allowed := true;
  elsif v_role = 'vendor' then
    v_vendor := public.current_vendor_id();
    -- 担当現場かどうかのみで判定する。
    -- 現場が存在しない場合もここで false となり permission_denied になる
    -- （site_not_found と区別させない = 存在有無を漏らさない）。
    select exists (
      select 1 from public.vendor_sites vs
       where vs.vendor_id = v_vendor
         and vs.site_id   = p_site_id
    ) into v_allowed;
  end if;

  if not v_allowed then
    raise exception 'permission_denied: not allowed for this site'
      using errcode = '42501';
  end if;

  -- 現場の認可が通ってから商品の存在を確認する
  if not exists (select 1 from public.products pr where pr.id = p_product_id) then
    raise exception 'product_not_found';
  end if;

  return query
  with plan as (
    select p.planned_quantity
      from public.site_product_plans p
     where p.site_id = p_site_id
       and p.product_id = p_product_id
  ),
  shipped as (
    select coalesce(
             sum(case when m.movement_type = 'in' then m.quantity else 0 end),
             0
           ) as qty
      from public.material_movement_ledger m
     where m.site_id    = p_site_id
       and m.product_id = p_product_id
  ),
  pending as (
    select coalesce(sum(r.quantity), 0) as qty
      from public.stock_requests r
     where r.site_id    = p_site_id
       and r.product_id = p_product_id
       and r.status in ('requested', 'accepted')
  )
  select
    (select plan.planned_quantity from plan),
    (select shipped.qty from shipped),
    (select pending.qty from pending),
    exists (select 1 from plan);
end;
$$;

comment on function public.get_site_product_plan_context is
  '出庫依頼作成時の予定数量コンテキスト（予定 / 既出庫 / 未処理依頼）を返す。'
  ' 画面側で 既出庫 + 未処理 + 入力中の数量 = 依頼後見込数量 を計算する。'
  ' vendor は担当現場のみ取得可（担当外は商品存在確認より前に permission_denied）。'
  ' 参照専用で、超過しても例外にはしない。Phase 4（式統一・存在確認追加）';

revoke execute on function public.get_site_product_plan_context(uuid, uuid) from public;
revoke execute on function public.get_site_product_plan_context(uuid, uuid) from anon;
grant  execute on function public.get_site_product_plan_context(uuid, uuid) to authenticated;

-- ===========================================================================
-- 3) lease_stock_ledger: 現場×商品 集計用の複合インデックス（レビュー指摘 #6）
--    material_movement_ledger 経由で「site_id = X and product_id = Y」を集計する際、
--    stock_ledger 側は 037 の (product_id, site_id, created_at desc) が効くが、
--    lease_stock_ledger 側には対応する複合インデックスが無かった。
-- ===========================================================================
create index if not exists lease_stock_ledger_product_site_idx
  on public.lease_stock_ledger (product_id, site_id)
  where site_id is not null;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) 2つのビューの見込数量が一致すること（同一現場×商品において）
-- select s.site_id, s.product_id,
--        s.expected_quantity as view_site_expected,
--        max(r.expected_quantity) as view_request_expected
--   from public.site_product_plan_status s
--   join public.stock_request_plan_status r
--     on r.site_id = s.site_id and r.product_id = s.product_id
--  group by s.site_id, s.product_id, s.expected_quantity;
-- -- 期待: view_site_expected = view_request_expected（全行で一致）
--
-- -- (b) shipped / cancelled 行が自身の数量を二重加算していないこと
-- select status,
--        bool_and(expected_quantity = shipped_quantity + other_pending_quantity)
--          as no_self_double_count
--   from public.stock_request_plan_status
--  where status in ('shipped', 'cancelled')
--  group by status;
-- -- 期待: 両ステータスとも true
--
-- -- (c) 未処理の依頼は自身の数量が加算されていること
-- select bool_and(expected_quantity
--                 = shipped_quantity + other_pending_quantity + adjusted_quantity)
--   from public.stock_request_plan_status
--  where status in ('requested', 'accepted');
-- -- 期待: true
--
-- -- (d) cancelled は超過対象外
-- select count(*) from public.stock_request_plan_status
--  where status = 'cancelled' and is_over = true;
-- -- 期待: 0 行
--
-- -- (e) RPC の存在確認（実在しない UUID で固定エラーになること）
-- -- select * from public.get_site_product_plan_context(
-- --   '00000000-0000-0000-0000-000000000000', '<実在する product_id>');
-- -- 期待: admin/center は site_not_found、vendor は permission_denied
-- -- select * from public.get_site_product_plan_context(
-- --   '<実在する site_id>', '00000000-0000-0000-0000-000000000000');
-- -- 期待: product_not_found
--
-- -- (f) インデックスが作成されていること
-- select indexname from pg_indexes
--  where schemaname='public' and tablename='lease_stock_ledger'
--  order by indexname;
-- -- 期待: lease_stock_ledger_product_site_idx を含む
--
-- -- (g) 依頼を止める制約・トリガーが増えていないこと（超過は警告のみ）
-- select tgname from pg_trigger
--  where tgrelid='public.stock_requests'::regclass and not tgisinternal;
-- -- 期待: stock_requests_set_updated_at と stock_requests_set_original_quantity のみ

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop index if exists public.lease_stock_ledger_product_site_idx;
-- -- stock_request_plan_status / get_site_product_plan_context は
-- -- 034 / 038 の定義をそれぞれ再適用して戻す
-- commit;
-- notify pgrst, 'reload schema';
