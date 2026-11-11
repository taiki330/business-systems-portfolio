-- 080_stock_return_corrections.sql
-- 誤った返却登録を在庫・台帳・過入庫とまとめて安全に修正する。
begin;

alter table public.stock_returns
  add column if not exists corrected_at timestamptz,
  add column if not exists corrected_by uuid references public.app_users(id) on delete set null;

create table if not exists public.stock_return_corrections (
  id uuid primary key default gen_random_uuid(),
  stock_return_id uuid not null references public.stock_returns(id) on delete restrict,
  old_input_quantity numeric(12,2) not null,
  new_input_quantity numeric(12,2) not null,
  old_normal_quantity numeric(12,2) not null,
  new_normal_quantity numeric(12,2) not null,
  old_over_quantity numeric(12,2) not null,
  new_over_quantity numeric(12,2) not null,
  old_memo text,
  new_memo text,
  corrected_by uuid references public.app_users(id) on delete set null,
  corrected_at timestamptz not null default now()
);
alter table public.stock_return_corrections enable row level security;
revoke all on public.stock_return_corrections from public, anon, authenticated;
grant select on public.stock_return_corrections to authenticated;
drop policy if exists "stock_return_corrections_read" on public.stock_return_corrections;
create policy "stock_return_corrections_read" on public.stock_return_corrections
  for select to authenticated using (public.is_admin_or_center());

create or replace function public.correct_stock_return(
  p_return_id uuid,
  p_input_quantity numeric,
  p_memo text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_return public.stock_returns%rowtype;
  v_over public.over_returns%rowtype;
  v_site_location text;
  v_site_quantity numeric(12,2);
  v_center_quantity numeric(12,2);
  v_old_normal numeric(12,2);
  v_old_over numeric(12,2);
  v_new_normal numeric(12,2);
  v_new_over numeric(12,2);
  v_delta numeric(12,2);
  v_site_ledger_id uuid;
  v_center_ledger_id uuid;
begin
  if not public.is_admin() then
    raise exception 'permission_denied: admin role required' using errcode='42501';
  end if;
  if p_input_quantity is null or p_input_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  select * into v_return from public.stock_returns
   where id=p_return_id for update;
  if not found then raise exception 'stock_return_not_found'; end if;

  select * into v_over from public.over_returns
   where stock_return_id=p_return_id
   order by created_at desc limit 1 for update;

  v_old_normal := v_return.quantity;
  v_old_over := coalesce(v_over.quantity,0);
  v_site_location := public.site_stock_location(v_return.site_id);

  select quantity into v_site_quantity from public.stock_items
   where product_id=v_return.product_id and location=v_site_location for update;
  select quantity into v_center_quantity from public.stock_items
   where product_id=v_return.product_id and location='center' for update;

  if v_site_quantity is null or v_center_quantity is null then
    raise exception 'stock_item_not_found';
  end if;

  -- 元の通常返却を一度戻したと仮定した現場在庫を上限として再分割する。
  v_new_normal := least(p_input_quantity, v_site_quantity + v_old_normal);
  v_new_over := p_input_quantity - v_new_normal;
  v_delta := v_new_normal - v_old_normal;

  if v_site_quantity - v_delta < 0 then raise exception 'insufficient_site_stock'; end if;
  if v_center_quantity + v_delta < 0 then raise exception 'insufficient_center_stock'; end if;

  update public.stock_items set quantity=quantity-v_delta
   where product_id=v_return.product_id and location=v_site_location;
  update public.stock_items set quantity=quantity+v_delta
   where product_id=v_return.product_id and location='center';

  -- 元登録と同一トランザクション時刻の台帳行を修正し、集計を二重計上させない。
  select id into v_site_ledger_id from public.stock_ledger
   where product_id=v_return.product_id and site_id=v_return.site_id
     and location=v_site_location and movement_type='out'
     and created_at=v_return.created_at
   order by id limit 1 for update;
  select id into v_center_ledger_id from public.stock_ledger
   where product_id=v_return.product_id and location='center'
     and movement_type='in' and created_at=v_return.created_at
   order by id limit 1 for update;

  if v_site_ledger_id is null or v_center_ledger_id is null then
    raise exception 'return_ledger_not_found';
  end if;

  if v_new_normal=0 then
    delete from public.stock_ledger where id in (v_site_ledger_id,v_center_ledger_id);
  else
    update public.stock_ledger set quantity=v_new_normal
     where id in (v_site_ledger_id,v_center_ledger_id);
  end if;

  update public.stock_returns
     set quantity=v_new_normal, memo=nullif(btrim(p_memo),''),
         corrected_at=now(), corrected_by=public.current_actor_id()
   where id=p_return_id;

  if v_new_over>0 then
    if v_over.id is null then
      insert into public.over_returns(
        product_id,site_id,quantity,input_quantity,normal_quantity,
        stock_return_id,reported_by,created_by
      ) values (
        v_return.product_id,v_return.site_id,v_new_over,p_input_quantity,v_new_normal,
        p_return_id,v_return.returned_by,public.current_actor_id()
      );
    else
      update public.over_returns
         set quantity=v_new_over,input_quantity=p_input_quantity,normal_quantity=v_new_normal,
             status='unconfirmed',memo=null,confirmed_by=null,confirmed_at=null
       where id=v_over.id;
    end if;
  elsif v_over.id is not null then
    delete from public.over_returns where id=v_over.id;
  end if;

  insert into public.stock_return_corrections(
    stock_return_id,old_input_quantity,new_input_quantity,
    old_normal_quantity,new_normal_quantity,old_over_quantity,new_over_quantity,
    old_memo,new_memo,corrected_by
  ) values (
    p_return_id,v_old_normal+v_old_over,p_input_quantity,
    v_old_normal,v_new_normal,v_old_over,v_new_over,
    v_return.memo,nullif(btrim(p_memo),''),public.current_actor_id()
  );

  return jsonb_build_object(
    'ok',true,'normal_quantity',v_new_normal,'over_quantity',v_new_over
  );
end;
$$;
revoke execute on function public.correct_stock_return(uuid,numeric,text) from public,anon;
grant execute on function public.correct_stock_return(uuid,numeric,text) to authenticated;

commit;
notify pgrst, 'reload schema';
