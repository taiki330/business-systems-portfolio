-- 076_gas_site_progress_sync.sql
-- GAS「現場確認」から現場進捗を受け取り、資材スナップショットを自動記録する。

begin;

create table if not exists public.integration_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.integration_settings enable row level security;
revoke all on public.integration_settings from public, anon, authenticated;

insert into public.integration_settings(key, value)
values ('gas_progress_sync_secret', 'CHANGE_ME_BEFORE_USE')
on conflict (key) do nothing;

create table if not exists public.gas_progress_sync_events (
  external_event_id text primary key,
  external_site_code text not null,
  site_name text,
  progress_kind text not null,
  occurred_on date not null,
  site_id uuid references public.sites(id) on delete set null,
  site_progress_event_id uuid references public.site_progress_events(id) on delete set null,
  status text not null check (status in ('received', 'processed', 'site_not_found')),
  payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.gas_progress_sync_events enable row level security;
revoke all on public.gas_progress_sync_events from public, anon, authenticated;
grant select on public.gas_progress_sync_events to authenticated;
drop policy if exists "gas_progress_sync_events_admin_read" on public.gas_progress_sync_events;
create policy "gas_progress_sync_events_admin_read" on public.gas_progress_sync_events
  for select to authenticated using (public.current_app_role() in ('admin', 'internal'));

create or replace function public.sync_site_progress_from_gas(
  p_sync_secret text,
  p_external_event_id text,
  p_external_site_code text,
  p_site_name text,
  p_kind text,
  p_occurred_on date,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected_secret text;
  v_site_id uuid;
  v_event_id uuid;
  v_date date;
begin
  select value into v_expected_secret
    from public.integration_settings
   where key = 'gas_progress_sync_secret';

  if v_expected_secret is null
     or v_expected_secret = 'CHANGE_ME_BEFORE_USE'
     or p_sync_secret is distinct from v_expected_secret then
    raise exception 'invalid_sync_secret' using errcode = '42501';
  end if;

  if nullif(trim(p_external_event_id), '') is null
     or nullif(trim(p_external_site_code), '') is null then
    raise exception 'invalid_external_event';
  end if;
  if p_kind not in ('assembly_completed', 'dismantle_started', 'dismantle_completed') then
    raise exception 'invalid_progress_kind';
  end if;

  if exists (
    select 1 from public.gas_progress_sync_events
     where external_event_id = p_external_event_id and status = 'processed'
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  -- 現場コード設定後の再送で復旧できるよう、前回 site_not_found は取り直す。
  delete from public.gas_progress_sync_events
   where external_event_id = p_external_event_id and status = 'site_not_found';

  v_date := coalesce(p_occurred_on, (timezone('Asia/Tokyo', now()))::date);
  if v_date > (timezone('Asia/Tokyo', now()))::date then
    raise exception 'future_date_not_allowed';
  end if;

  select s.id into v_site_id
    from public.sites s
   where upper(trim(coalesce(s.code, ''))) = upper(trim(p_external_site_code))
   limit 1;

  -- 移行中だけ現場名の完全一致でも救済する。複数一致時は誤紐付け防止のため使わない。
  if v_site_id is null and nullif(trim(p_site_name), '') is not null then
    select s.id into v_site_id
      from public.sites s
     where trim(s.name) = trim(p_site_name)
       and (select count(*) from public.sites x where trim(x.name) = trim(p_site_name)) = 1
     limit 1;
  end if;

  insert into public.gas_progress_sync_events(
    external_event_id, external_site_code, site_name, progress_kind,
    occurred_on, site_id, status, payload
  ) values (
    p_external_event_id, trim(p_external_site_code), nullif(trim(p_site_name), ''),
    p_kind, v_date, v_site_id,
    case when v_site_id is null then 'site_not_found' else 'received' end,
    coalesce(p_payload, '{}'::jsonb)
  );

  if v_site_id is null then
    return jsonb_build_object('ok', false, 'code', 'site_not_found');
  end if;

  -- GAS は auth.users に属さない外部連携のため recorded_by は NULL。
  -- 連携元は note と gas_progress_sync_events に保存する。
  insert into public.site_progress_events(site_id, kind, occurred_on, note, recorded_by)
  values (v_site_id, p_kind, v_date, 'GASから自動連携', null)
  returning id into v_event_id;

  insert into public.site_progress_snapshot_items(
    event_id, product_id, ownership, shipped_quantity, returned_quantity,
    outstanding_quantity, over_return_quantity, site_quantity
  )
  with moves as (
    select m.product_id, m.ownership,
      coalesce(sum(m.quantity) filter (where m.reason='ship' and m.movement_type='in'),0) shipped,
      coalesce(sum(m.quantity) filter (where m.reason='return_from_site' and m.movement_type='out'),0) returned
    from public.material_movement_ledger m where m.site_id=v_site_id group by 1,2
  ), over_r as (
    select product_id,sum(quantity) qty from public.over_returns where site_id=v_site_id group by 1
  ), owned_stock as (
    select product_id,sum(quantity) qty from public.stock_items
     where site_id=v_site_id and storage_kind='site' group by 1 having sum(quantity)>0
  ), leased_stock as (
    select product_id,sum(quantity) qty from public.lease_stock_items
     where site_id=v_site_id and storage_kind='site' group by 1 having sum(quantity)>0
  ), keys as (
    select product_id,ownership from moves
    union select product_id,'owned'::text from over_r
    union select product_id,'owned'::text from owned_stock
    union select product_id,'leased'::text from leased_stock
  )
  select v_event_id,k.product_id,k.ownership,
    coalesce(m.shipped,0),coalesce(m.returned,0),
    coalesce(m.shipped,0)-coalesce(m.returned,0),
    case when k.ownership='owned' then coalesce(o.qty,0) else 0 end,
    case when k.ownership='owned' then coalesce(os.qty,0) else coalesce(ls.qty,0) end
  from keys k
  left join moves m on m.product_id=k.product_id and m.ownership=k.ownership
  left join over_r o on o.product_id=k.product_id and k.ownership='owned'
  left join owned_stock os on os.product_id=k.product_id and k.ownership='owned'
  left join leased_stock ls on ls.product_id=k.product_id and k.ownership='leased';

  update public.gas_progress_sync_events
     set status='processed', site_progress_event_id=v_event_id, processed_at=now()
   where external_event_id=p_external_event_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'event_id', v_event_id);
end;
$$;

revoke execute on function public.sync_site_progress_from_gas(text,text,text,text,text,date,jsonb) from public, authenticated;
grant usage on schema public to anon;
grant execute on function public.sync_site_progress_from_gas(text,text,text,text,text,date,jsonb) to anon;

comment on function public.sync_site_progress_from_gas is
  '共有シークレットを検証し、GASの進捗を現場コードで冪等に取り込む。Vercel不要。';

commit;
notify pgrst, 'reload schema';

-- 初回設定（SQL Editorで十分に長いランダム文字列へ変更）:
-- update public.integration_settings
--    set value = '<32文字以上の連携キー>', updated_at = now()
--  where key = 'gas_progress_sync_secret';
