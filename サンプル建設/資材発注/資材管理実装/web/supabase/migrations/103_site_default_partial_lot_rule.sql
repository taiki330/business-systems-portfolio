-- 現場ごとの半端な数量の基本ルールと、現場×商品ごとの例外設定
-- sites.allow_partial_lot_default: 現場全体の基本値
-- site_products.allow_partial_lot_override: NULL=現場の基本値を使う、true/false=商品ごとの上書き

begin;

alter table public.sites
  add column if not exists allow_partial_lot_default boolean not null default true;

comment on column public.sites.allow_partial_lot_default is
  '現場の基本ルール。true=半端な数量の注文を許可、false=半束単位に合わない注文を半端もん確認対象にする。';

alter table public.site_products
  add column if not exists allow_partial_lot_override boolean null;

comment on column public.site_products.allow_partial_lot_override is
  '現場×商品の例外。NULL=現場の基本設定を使う、true=常に許可、false=確認対象にする。';

-- 既存の「許可しない」設定だけは個別例外として保持する。
-- 既存の true は従来の既定値だったため NULL（現場の基本設定を継承）へ移す。
update public.site_products
set allow_partial_lot_override = case
  when allow_partial_lot = false then false
  else null
end
where allow_partial_lot_override is null;

drop view if exists public.stock_request_lot_size_status;

create view public.stock_request_lot_size_status
with (security_invoker = on)
as
  select
    r.id as request_id,
    r.site_id,
    r.product_id,
    r.quantity,
    r.status,
    r.requested_by,
    r.requested_at,
    p.lot_size,
    (p.lot_size / 2) as order_unit,
    coalesce(sp.allow_partial_lot_override, s.allow_partial_lot_default, true) as allow_partial_lot,
    (
      p.lot_size is not null
      and coalesce(sp.allow_partial_lot_override, s.allow_partial_lot_default, true) = false
      and mod(r.quantity, p.lot_size / 2) <> 0
    ) as is_lot_size_violation
  from public.stock_requests r
  join public.products p on p.id = r.product_id
  join public.sites s on s.id = r.site_id
  left join public.site_products sp
    on sp.site_id = r.site_id
   and sp.product_id = r.product_id;

grant select on public.stock_request_lot_size_status to authenticated;

commit;

notify pgrst, 'reload schema';
