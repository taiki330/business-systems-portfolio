-- 100_transactional_stock_request_operation_logs.sql
--
-- 出庫依頼の操作履歴は、業務データと別通信で保存する audit_logs ではなく、
-- stock_requests の同一トランザクション内 AFTER trigger で operation_logs に記録する。

begin;

create or replace function public.tg_operation_log_stock_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation text;
begin
  if tg_op = 'INSERT' then
    v_operation := 'stock_request.created';
  else
    if new.status is not distinct from old.status then
      return null;
    end if;

    v_operation := case new.status
      when 'accepted' then 'stock_request.accepted'
      when 'shipped' then 'stock_request.shipped'
      when 'cancelled' then 'stock_request.cancelled'
      else null
    end;

    if v_operation is null then
      return null;
    end if;
  end if;

  perform public.log_operation(
    v_operation,
    'stock_request',
    new.id,
    new.site_id,
    new.product_id,
    new.quantity,
    jsonb_build_object(
      'status', new.status,
      'prev_status', case when tg_op = 'UPDATE' then old.status else null end,
      'order_id', new.order_id,
      'create_operation_id', new.create_operation_id,
      'recorded_in_transaction', true
    )
  );

  return null;
end;
$$;

-- audit_logs は旧方式の履歴として残すが、新規書込を停止する。
-- 正式な操作履歴は operation_logs のみを参照する。
revoke insert on table public.audit_logs from public, anon, authenticated;
drop policy if exists "audit_logs_authenticated_insert" on public.audit_logs;
drop policy if exists "audit_logs_anon_insert" on public.audit_logs;

comment on table public.audit_logs is
  '旧監査ログ（既存記録の参照用）。新規操作は operation_logs に同一トランザクションで記録する。';

commit;

notify pgrst, 'reload schema';
