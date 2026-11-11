-- 050_p7_site_progress.sql
-- 049 適用後に Supabase SQL Editor で実行
-- Phase 7-2: 現場進捗（組立完了 / 解体開始 / 解体完了）とその時点のスナップショット、
--            および未返却資材のリアルタイム集計ビュー
--
-- 背景（ヒアリング）:
--   「組立が終わったタイミングと解体が始まったタイミングと解体が終わったタイミングの段階で、
--     その現場にどれぐらい出庫したかっていう総数…解体終わったら出庫してるものから
--     どれだけ返ってきたか…残ってるのをまとめて出さないといけない」
--   「出庫数も組み完了した時から変動したりするから…結局ここが組み立て完了時の出庫数と変わる」
--   → 各時点の数値を後から再現できる必要があるため、記録時に確定値を保存する。
--
-- 方針:
--   - 記録するのは事務（admin）のみ。RPC 内で is_admin() ガード。
--   - 追記のみ。訂正は同じ区分を再記録し、最新の記録を有効とする（監査証跡を壊さない）。
--     区分の順序（組立完了→解体開始→解体完了）は強制しない。現実には前後しうるため、
--     順序の妥当性は画面側の注意表示に留める。
--   - 3 区分とも保存する項目は同一にする。画面で強調する列だけを区分ごとに変える。
--     後から「解体開始時の残数も見たい」となっても作り直しにならないため。
--   - 未返却数は要件どおり「出庫累計 − 通常返却累計」。過入庫は返却累計に含めない
--     （Phase 6-2 で over_returns に分離済みで、在庫にも台帳にも入っていない）。
--   - 現場残（site_quantity）も併せて保存する。未返却数と現場残は理屈上一致するが、
--     在庫調整（Phase 6-3）が入ると乖離する。解体完了時に見たいのは「実際に何本あるか」＝
--     現場残であり、双方を残して突き合わせられるようにする。
--   - 自社所有とリースは ownership 列で分けて保存する。リースも完工時にいったんセンターへ
--     戻る運用のため未返却の集計対象に含める（クラスクリエート 5.txt のヒアリング）。
--   - 既知の制約: 過入庫は自社在庫の返却のみが対象（Phase 6-2）。リースの過入庫は
--     仕組みが無いため ownership='leased' の over_return_quantity は常に 0 になる。
--
-- 冪等性: create table if not exists / create or replace view / create or replace function /
--         drop policy if exists。再実行しても安全。

begin;

-- ===========================================================================
-- 1) 進捗イベントとスナップショット
-- ===========================================================================
create table if not exists public.site_progress_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete restrict,
  kind text not null
    check (kind in ('assembly_completed', 'dismantle_started', 'dismantle_completed')),
  -- 実際にその状態になった日。記録が後日になっても正しい日付で報告できるようにする。
  occurred_on date not null,
  note text,
  recorded_by uuid,
  recorded_at timestamptz not null default now()
);

comment on table public.site_progress_events is
  '現場の進捗記録（組立完了 / 解体開始 / 解体完了）。追記のみ。訂正は再記録し最新を有効とする。Phase 7-2';
comment on column public.site_progress_events.occurred_on is
  '実際にその状態になった日。数量スナップショットは記録実行時点の値である点に注意';
comment on column public.site_progress_events.kind is
  'dismantle_completed が完工（現場が終わること）にあたる';

create index if not exists site_progress_events_site_kind_idx
  on public.site_progress_events (site_id, kind, recorded_at desc);
create index if not exists site_progress_events_occurred_idx
  on public.site_progress_events (occurred_on desc);

create table if not exists public.site_progress_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.site_progress_events (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  ownership text not null check (ownership in ('owned', 'leased')),

  shipped_quantity     numeric(12, 2) not null default 0,
  returned_quantity    numeric(12, 2) not null default 0,
  outstanding_quantity numeric(12, 2) not null default 0,
  over_return_quantity numeric(12, 2) not null default 0,
  site_quantity        numeric(12, 2) not null default 0,

  constraint site_progress_snapshot_items_unique unique (event_id, product_id, ownership)
);

comment on table public.site_progress_snapshot_items is
  '進捗記録時点の資材別確定値。後から返却が動いても当時の報告内容を再現できる。Phase 7-2';
comment on column public.site_progress_snapshot_items.outstanding_quantity is
  '未返却数 = 出庫累計 − 通常返却累計（過入庫は含めない）';
comment on column public.site_progress_snapshot_items.site_quantity is
  '記録時点で実際にその現場にあった数量。在庫調整が入ると未返却数と乖離しうる';

create index if not exists site_progress_snapshot_items_event_idx
  on public.site_progress_snapshot_items (event_id);

-- ===========================================================================
-- 2) RLS / GRANT（参照は admin / center、書込は RPC 経由のみ）
-- ===========================================================================
alter table public.site_progress_events enable row level security;
alter table public.site_progress_snapshot_items enable row level security;

revoke all on table public.site_progress_events from public, anon, authenticated;
revoke all on table public.site_progress_snapshot_items from public, anon, authenticated;
grant select on table public.site_progress_events to authenticated;
grant select on table public.site_progress_snapshot_items to authenticated;

drop policy if exists "site_progress_events_read" on public.site_progress_events;
drop policy if exists "site_progress_snapshot_items_read" on public.site_progress_snapshot_items;

create policy "site_progress_events_read"
  on public.site_progress_events for select to authenticated
  using (public.is_admin_or_center());

create policy "site_progress_snapshot_items_read"
  on public.site_progress_snapshot_items for select to authenticated
  using (public.is_admin_or_center());

-- ===========================================================================
-- 3) record_site_progress: 進捗を記録し、その瞬間の確定値を保存する（admin のみ）
-- ===========================================================================
create or replace function public.record_site_progress(
  p_site_id     uuid,
  p_kind        text,
  p_occurred_on date default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_date     date;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required'
      using errcode = '42501';
  end if;

  if p_kind not in ('assembly_completed', 'dismantle_started', 'dismantle_completed') then
    raise exception 'invalid_progress_kind';
  end if;

  if not exists (select 1 from public.sites s where s.id = p_site_id) then
    raise exception 'site_not_found';
  end if;

  v_date := coalesce(p_occurred_on, (timezone('Asia/Tokyo', now()))::date);

  if v_date > (timezone('Asia/Tokyo', now()))::date then
    raise exception 'future_date_not_allowed';
  end if;

  insert into public.site_progress_events (site_id, kind, occurred_on, note, recorded_by)
  values (p_site_id, p_kind, v_date, nullif(trim(p_note), ''), public.current_actor_id())
  returning id into v_event_id;

  -- ---- その瞬間の確定値を資材別・自社/リース別に保存する ----
  insert into public.site_progress_snapshot_items (
    event_id, product_id, ownership,
    shipped_quantity, returned_quantity, outstanding_quantity,
    over_return_quantity, site_quantity
  )
  with moves as (
    select m.product_id, m.ownership,
           coalesce(sum(m.quantity) filter (where m.reason = 'ship' and m.movement_type = 'in'), 0) as shipped,
           coalesce(sum(m.quantity) filter (where m.reason = 'return_from_site' and m.movement_type = 'out'), 0) as returned
      from public.material_movement_ledger m
     where m.site_id = p_site_id
     group by 1, 2
  ),
  over_r as (
    select o.product_id, sum(o.quantity) as qty
      from public.over_returns o
     where o.site_id = p_site_id
     group by 1
  ),
  owned_stock as (
    select si.product_id, sum(si.quantity) as qty
      from public.stock_items si
     where si.site_id = p_site_id and si.storage_kind = 'site'
     group by 1
    having sum(si.quantity) > 0
  ),
  leased_stock as (
    select lsi.product_id, sum(lsi.quantity) as qty
      from public.lease_stock_items lsi
     where lsi.site_id = p_site_id and lsi.storage_kind = 'site'
     group by 1
    having sum(lsi.quantity) > 0
  ),
  keys as (
    select mv.product_id, mv.ownership from moves mv
    union
    select orr.product_id, 'owned'::text from over_r orr
    union
    select os.product_id, 'owned'::text from owned_stock os
    union
    select ls.product_id, 'leased'::text from leased_stock ls
  )
  select
    v_event_id, k.product_id, k.ownership,
    coalesce(mv.shipped, 0),
    coalesce(mv.returned, 0),
    coalesce(mv.shipped, 0) - coalesce(mv.returned, 0),
    case when k.ownership = 'owned' then coalesce(orr.qty, 0) else 0 end,
    case when k.ownership = 'owned' then coalesce(os.qty, 0) else coalesce(ls.qty, 0) end
  from keys k
  left join moves        mv  on mv.product_id  = k.product_id and mv.ownership = k.ownership
  left join over_r       orr on orr.product_id = k.product_id and k.ownership = 'owned'
  left join owned_stock  os  on os.product_id  = k.product_id and k.ownership = 'owned'
  left join leased_stock ls  on ls.product_id  = k.product_id and k.ownership = 'leased';

  perform public.log_operation(
    case p_kind
      when 'assembly_completed'   then 'site_progress.assembly_completed'
      when 'dismantle_started'    then 'site_progress.dismantle_started'
      else                             'site_progress.dismantle_completed'
    end,
    'site_progress', v_event_id,
    p_site_id, null, null,
    jsonb_build_object('kind', p_kind, 'occurred_on', v_date)
  );

  return v_event_id;
end;
$$;

comment on function public.record_site_progress is
  '現場進捗を記録し、その時点の資材別確定値をスナップショットとして保存する（admin のみ）。Phase 7-2';

revoke execute on function public.record_site_progress(uuid, text, date, text) from public;
revoke execute on function public.record_site_progress(uuid, text, date, text) from anon;
grant  execute on function public.record_site_progress(uuid, text, date, text) to authenticated;

-- ===========================================================================
-- 4) 未返却資材のリアルタイム集計ビュー
--    「完工したこの日なのに現時点で戻ってきてません」を出すための現在値。
--    スナップショット（過去の確定値）とは別物である点に注意。
-- ===========================================================================
create or replace view public.site_material_outstanding
with (security_invoker = on)
as
with moves as (
  select m.site_id, m.product_id, m.ownership,
         coalesce(sum(m.quantity) filter (where m.reason = 'ship' and m.movement_type = 'in'), 0) as shipped,
         coalesce(sum(m.quantity) filter (where m.reason = 'return_from_site' and m.movement_type = 'out'), 0) as returned
    from public.material_movement_ledger m
   where m.site_id is not null
   group by 1, 2, 3
),
owned_stock as (
  select si.site_id, si.product_id, sum(si.quantity) as qty
    from public.stock_items si
   where si.storage_kind = 'site' and si.site_id is not null
   group by 1, 2
),
leased_stock as (
  select lsi.site_id, lsi.product_id, sum(lsi.quantity) as qty
    from public.lease_stock_items lsi
   where lsi.storage_kind = 'site' and lsi.site_id is not null
   group by 1, 2
),
over_r as (
  select o.site_id, o.product_id, sum(o.quantity) as qty
    from public.over_returns o
   group by 1, 2
)
select
  mv.site_id,
  mv.product_id,
  mv.ownership,
  mv.shipped                as shipped_quantity,
  mv.returned               as returned_quantity,
  mv.shipped - mv.returned  as outstanding_quantity,
  case when mv.ownership = 'owned' then coalesce(orr.qty, 0) else 0 end as over_return_quantity,
  case when mv.ownership = 'owned' then coalesce(os.qty, 0) else coalesce(ls.qty, 0) end as site_quantity
from moves mv
left join owned_stock  os  on mv.ownership = 'owned'  and os.site_id  = mv.site_id and os.product_id  = mv.product_id
left join leased_stock ls  on mv.ownership = 'leased' and ls.site_id  = mv.site_id and ls.product_id  = mv.product_id
left join over_r       orr on mv.ownership = 'owned'  and orr.site_id = mv.site_id and orr.product_id = mv.product_id;

comment on view public.site_material_outstanding is
  '現場ごと・資材ごと・自社/リース別の現時点の出庫累計・返却累計・未返却数。Phase 7-2';

grant select on public.site_material_outstanding to authenticated;

-- 現場ごとの最新の進捗（区分別）。完工日の判定に使う。
create or replace view public.site_progress_latest
with (security_invoker = on)
as
select distinct on (e.site_id, e.kind)
       e.site_id, e.kind, e.id as event_id, e.occurred_on, e.recorded_at
  from public.site_progress_events e
 order by e.site_id, e.kind, e.recorded_at desc;

comment on view public.site_progress_latest is
  '現場ごと・区分ごとの最新の進捗記録（訂正時は再記録された最新を有効とする）。Phase 7-2';

grant select on public.site_progress_latest to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認（SQL Editor で実行）
-- ---------------------------------------------------------------------------
-- -- (a) policy / 権限
-- select tablename, policyname, cmd from pg_policies
--  where schemaname='public' and tablename like 'site_progress%' order by tablename;
-- -- 期待: 各テーブル SELECT の 1 件のみ（書込 policy なし）
--
-- -- (b) 未返却の現在値（現場ごと）
-- select s.name as site, p.name as product, o.ownership,
--        o.shipped_quantity, o.returned_quantity, o.outstanding_quantity,
--        o.over_return_quantity, o.site_quantity
--   from public.site_material_outstanding o
--   join public.sites s    on s.id = o.site_id
--   join public.products p on p.id = o.product_id
--  order by s.name, p.name;
--
-- -- (c) 進捗を記録してスナップショットが保存されること（admin で実行）
-- -- select public.record_site_progress('<site_id>', 'assembly_completed', null, 'テスト');
-- -- select i.* from public.site_progress_snapshot_items i
-- --   join public.site_progress_events e on e.id = i.event_id
-- --  order by e.recorded_at desc limit 20;
--
-- -- (d) 記録後に返却が動いてもスナップショットが変わらないこと
-- --     （返却を1件行ってから上記 (c) の select を再実行し、値が同じであることを確認）

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop view if exists public.site_progress_latest;
-- drop view if exists public.site_material_outstanding;
-- drop function if exists public.record_site_progress(uuid, text, date, text);
-- drop policy if exists "site_progress_snapshot_items_read" on public.site_progress_snapshot_items;
-- drop policy if exists "site_progress_events_read" on public.site_progress_events;
-- drop table if exists public.site_progress_snapshot_items;
-- drop table if exists public.site_progress_events;
-- commit;
-- notify pgrst, 'reload schema';
