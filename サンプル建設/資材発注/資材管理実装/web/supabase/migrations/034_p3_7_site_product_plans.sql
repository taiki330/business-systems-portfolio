-- 034_p3_7_site_product_plans.sql
-- 033 適用後に Supabase SQL Editor で実行
-- Phase 3-7: 現場×商品ごとの予定数量と、予定超過判定
--
-- 方針:
--   - 要件定義書 §6/§7 および確定事項に従い、現場×商品ごとの必要予定数量を登録できるようにする。
--   - 超過は「出庫禁止」ではなく「警告・確認対象」として扱う（確定事項）。
--     したがって DB 側に出庫を止める制約・トリガーは一切置かない。
--     center は従来どおり実在庫を見て出庫数量を調整できる。
--   - 既出庫数量・未処理依頼数量・超過数量は保存しない。履歴（033 の統合ビュー）と
--     stock_requests から都度計算するビューとして提供する。
--     → 二重管理を避け、在庫補正・返却が入っても常に整合する。
--   - 既出庫数量には自社所有・リースの両方を含める。
--     現場が必要とする資材量は所有形態によらないため（要件定義書 §6 の予定数量は資材量の計画）。
--   - 「今回依頼数量」と「center の調整後数量」を区別するため、stock_requests に
--     original_quantity（当初依頼数量）を後方互換で追加する。
--     既存 INSERT 文（quantity のみ指定）を壊さないよう、トリガーで自動補完する。
--   - RLS: 予定数量の書込=admin / 参照=admin+center、vendor は担当現場のみ参照可。
--
-- 冪等性: create table if not exists / add column if not exists /
--         drop policy if exists → create policy / create or replace view。再実行しても安全。

begin;

-- ===========================================================================
-- 1) stock_requests に original_quantity（当初依頼数量）を追加
--    quantity は「現在値（center 調整後）」、original_quantity は「vendor が最初に依頼した数量」
-- ===========================================================================
alter table public.stock_requests
  add column if not exists original_quantity numeric(12, 2) null;

comment on column public.stock_requests.original_quantity is
  '当初依頼数量（vendor が作成した時点の数量）。quantity は center 調整後の現在値。Phase 3-7 で追加';

-- 既存行のバックフィル（調整履歴が無いため当初＝現在とみなす）
update public.stock_requests
   set original_quantity = quantity
 where original_quantity is null;

-- 以後の INSERT で未指定なら quantity を複製する（既存の Server Action を変更せずに済ませる）
create or replace function public.set_stock_request_original_quantity()
returns trigger
language plpgsql
as $$
begin
  if new.original_quantity is null then
    new.original_quantity := new.quantity;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_requests_set_original_quantity on public.stock_requests;
create trigger stock_requests_set_original_quantity
  before insert on public.stock_requests
  for each row execute function public.set_stock_request_original_quantity();

-- ===========================================================================
-- 2) site_product_plans（現場×商品の予定数量）
-- ===========================================================================
create table if not exists public.site_product_plans (
  id uuid primary key default gen_random_uuid(),

  site_id    uuid not null references public.sites (id)    on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,

  planned_quantity numeric(12, 2) not null default 0
    check (planned_quantity >= 0),

  note text,

  created_by uuid references public.app_users (id) on delete set null,
  updated_by uuid references public.app_users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint site_product_plans_site_product_unique unique (site_id, product_id)
);

comment on table public.site_product_plans is
  '現場×商品ごとの予定数量。超過は警告のみで出庫を禁止しない。Phase 3-7';
comment on column public.site_product_plans.planned_quantity is
  '必要予定数量。実績（既出庫）との比較で超過判定に用いる';

create index if not exists site_product_plans_site_idx
  on public.site_product_plans (site_id);
create index if not exists site_product_plans_product_idx
  on public.site_product_plans (product_id);

-- レビュー指摘（Medium）: 予定超過ビューの join 性能のための複合 index
create index if not exists stock_requests_site_product_status_idx
  on public.stock_requests (site_id, product_id, status);

drop trigger if exists site_product_plans_set_updated_at on public.site_product_plans;
create trigger site_product_plans_set_updated_at
  before update on public.site_product_plans
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on table public.site_product_plans to authenticated;

alter table public.site_product_plans enable row level security;

drop policy if exists "site_product_plans_read"          on public.site_product_plans;
drop policy if exists "site_product_plans_vendor_select" on public.site_product_plans;
drop policy if exists "site_product_plans_admin_insert"  on public.site_product_plans;
drop policy if exists "site_product_plans_admin_update"  on public.site_product_plans;
drop policy if exists "site_product_plans_admin_delete"  on public.site_product_plans;

create policy "site_product_plans_read" on public.site_product_plans
  for select to authenticated using (public.is_admin_or_center());

-- vendor: 担当現場の予定数量のみ参照可（書込は不可）
create policy "site_product_plans_vendor_select" on public.site_product_plans
  for select to authenticated
  using (
    public.current_app_role() = 'vendor'
    and site_id in (
      select vs.site_id
        from public.vendor_sites vs
       where vs.vendor_id = public.current_vendor_id()
    )
  );

create policy "site_product_plans_admin_insert" on public.site_product_plans
  for insert to authenticated with check (public.is_admin());
create policy "site_product_plans_admin_update" on public.site_product_plans
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "site_product_plans_admin_delete" on public.site_product_plans
  for delete to authenticated using (public.is_admin());

-- ===========================================================================
-- 3) 予定数量ステータスビュー（現場×商品の粒度）
--    既出庫数量 = 現場へ入った実績（自社 + リース）
--    未処理依頼数量 = requested / accepted の依頼合計（未出庫）
--    依頼後見込数量 = 既出庫 + 未処理依頼
-- ===========================================================================
drop view if exists public.stock_request_plan_status;
drop view if exists public.site_product_plan_status;

create view public.site_product_plan_status
with (security_invoker = on)
as
  with shipped as (
    select m.site_id, m.product_id,
           sum(case when m.movement_type = 'in'  then m.quantity else 0 end)
         - sum(case when m.movement_type = 'out' then m.quantity else 0 end)
             as net_quantity,
           sum(case when m.movement_type = 'in'  then m.quantity else 0 end)
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
  )
  select
    p.id                                   as plan_id,
    p.site_id,
    p.product_id,
    p.planned_quantity,
    coalesce(s.shipped_quantity, 0)        as shipped_quantity,
    coalesce(s.net_quantity, 0)            as current_site_quantity,
    coalesce(pd.pending_quantity, 0)       as pending_quantity,
    coalesce(s.shipped_quantity, 0)
      + coalesce(pd.pending_quantity, 0)   as expected_quantity,
    greatest(
      0,
      coalesce(s.shipped_quantity, 0)
        + coalesce(pd.pending_quantity, 0)
        - p.planned_quantity
    )                                      as over_quantity,
    (
      coalesce(s.shipped_quantity, 0)
        + coalesce(pd.pending_quantity, 0)
    ) > p.planned_quantity                 as is_over,
    p.note,
    p.updated_at
  from public.site_product_plans p
  left join shipped s
    on s.site_id = p.site_id and s.product_id = p.product_id
  left join pending pd
    on pd.site_id = p.site_id and pd.product_id = p.product_id;

comment on view public.site_product_plan_status is
  '現場×商品の予定数量と実績（既出庫・未処理依頼・見込・超過）。超過は警告用で出庫は禁止しない。Phase 3-7';

-- ===========================================================================
-- 4) 依頼別 予定超過ビュー（admin の超過確認ページ用）
--    要件定義書 §7 の表示項目に対応する。
--
--    コードレビュー指摘（Critical #5）への対応:
--      旧実装は「shipped_quantity（現場×商品の累計出庫）」に、行ごとに常に
--      「r.quantity（この依頼の数量）」を足していた。出庫済み(shipped)の依頼は
--      その出庫自体が既に shipped_quantity に含まれているため、加算すると二重計上になる。
--      さらに cancelled（実行されなかった依頼）の数量まで加算されており、
--      「未処理対象のみ加算する」という要件に反していた。
--    修正方針:
--      expected_quantity は依頼のステータスに応じて算出する。
--        requested / accepted（未処理）: shipped_quantity + この依頼の現在数量
--        shipped（処理済み）           : shipped_quantity のみ（自身の出庫は既に含まれる）
--        cancelled（不実行）           : shipped_quantity のみ、かつ is_over は必ず false
--      「予定数量を超えても依頼は可能」という既存仕様は変更しない
--      （本ビューは表示・警告用であり、出庫や依頼作成を禁止する制約ではない）。
-- ===========================================================================
create view public.stock_request_plan_status
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
      case
        when r.status in ('requested', 'accepted')
          then coalesce(s.shipped_quantity, 0) + r.quantity
        else coalesce(s.shipped_quantity, 0)
      end                                      as expected_quantity,
      (pl.planned_quantity is null)            as plan_missing
    from public.stock_requests r
    left join public.site_product_plans pl
      on pl.site_id = r.site_id and pl.product_id = r.product_id
    left join shipped s
      on s.site_id = r.site_id and s.product_id = r.product_id
  )
  select
    request_id, site_id, product_id, status, requested_by, requested_at,
    requested_quantity, adjusted_quantity, is_adjusted, planned_quantity,
    shipped_quantity, expected_quantity,
    case
      when status = 'cancelled' then null
      when planned_quantity is null then null
      else greatest(0, expected_quantity - planned_quantity)
    end as over_quantity,
    case
      when status = 'cancelled' then false
      when planned_quantity is null then false
      else expected_quantity > planned_quantity
    end as is_over,
    plan_missing
  from base;

comment on view public.stock_request_plan_status is
  '出庫依頼ごとの予定数量比較（当初依頼数量 / center 調整後数量 / 既出庫 / 見込 / 超過）。'
  ' shipped/cancelled 行は自身の数量を二重加算しない。cancelled は超過対象外。admin の超過確認用。Phase 3-7（レビュー対応）';

grant select on public.site_product_plan_status  to authenticated;
grant select on public.stock_request_plan_status to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- -- (a) original_quantity のバックフィルと自動補完
-- select count(*) filter (where original_quantity is null) as null_cnt, count(*) as total
--   from public.stock_requests;
-- -- 期待: null_cnt = 0
--
-- select tgname from pg_trigger
--  where tgrelid='public.stock_requests'::regclass and not tgisinternal;
-- -- 期待: stock_requests_set_updated_at と stock_requests_set_original_quantity
--
-- -- (b) 予定数量テーブルの policy（read / vendor_select / admin×3 の計5件）
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='site_product_plans'
--  order by cmd, policyname;
--
-- -- (c) ビューの動作確認
-- select * from public.site_product_plan_status  order by is_over desc limit 20;
-- select * from public.stock_request_plan_status order by is_over desc, requested_at desc limit 20;
--
-- -- (c-2) レビュー対応確認: shipped / cancelled 行で二重計上が無いこと
-- select status, count(*),
--        bool_and(expected_quantity = shipped_quantity) as expected_equals_shipped
--   from public.stock_request_plan_status
--  where status in ('shipped', 'cancelled')
--  group by status;
-- -- 期待: 両ステータスとも expected_equals_shipped = true（自身の数量を加算していない）
--
-- select count(*) from public.stock_request_plan_status
--  where status = 'cancelled' and is_over = true;
-- -- 期待: 0 行（cancelled は超過対象外）
--
-- -- (d) ビューが security_invoker であること
-- select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public'
--    and c.relname in ('site_product_plan_status','stock_request_plan_status');
--
-- -- (e) 出庫を禁止する制約・トリガーが増えていないこと（超過は警告のみ）
-- select tgname from pg_trigger
--  where tgrelid='public.stock_items'::regclass and not tgisinternal;
-- -- 期待: stock_items_set_updated_at のみ

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop view if exists public.stock_request_plan_status;
-- drop view if exists public.site_product_plan_status;
-- drop index if exists public.stock_requests_site_product_status_idx;
-- drop table if exists public.site_product_plans;
-- drop trigger if exists stock_requests_set_original_quantity on public.stock_requests;
-- drop function if exists public.set_stock_request_original_quantity();
-- alter table public.stock_requests drop column if exists original_quantity;
-- commit;
-- notify pgrst, 'reload schema';
