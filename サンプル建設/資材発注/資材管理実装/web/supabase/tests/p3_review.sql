-- supabase/tests/p3_review.sql
-- migration ではない。テスト専用 SQL（supabase/migrations 配下には置かない）。
-- 037 適用後、Supabase SQL Editor で「そのまま」実行してテストする。
-- 全体を 1 トランザクションにし、最後に必ず ROLLBACK するため、本番データには一切影響しない。
-- 何度でも再実行できる。
--
-- 実行手順:
--   1. supabase/migrations の 001〜037 を番号順にすべて適用済みであること
--   2. 本ファイルの内容を Supabase SQL Editor に貼り付けてそのまま実行する
--   3. NOTICE ログに "=== Phase 3 review test suite: ALL PASSED ===" が出れば成功
--      （途中で例外が発生した場合は "TEST FAILED: ..." のメッセージで失敗箇所が特定できる）
--   4. 最後の rollback; により、フィクスチャ含め一切のデータが残らない
--
-- 対象（コードレビュー指摘の検証）:
--   1. 二重送信（同一 operation_id・同一操作者・同一対象の再送で二重処理されないこと）
--   1b. operation_id 必須化（NULL なら operation_id_required で拒否）
--   1c. operation_id の使い回し（別操作・別対象での再利用が operation_id_conflict で拒否）
--   2. 部分受入・未受入終了(receiving_closed)・部分返却・全量返却の一連の状態遷移
--   3. returned_quantity <= received_quantity（DB 制約）
--   4. 承認後の lease_batches / lease_batch_items への直接 DML が RLS で拒否されること
--   5. 状態遷移の許容リスト（invalid な遷移が拒否されること: draft でない受入、受入前の出庫等）
--   6. 計画超過ビューの二重計上修正（shipped / cancelled 行が自身の数量を加算しないこと）
--   7. stock_items の直接書込が拒否され、adjust_stock_item がledger に記録すること
--   7b. stock_ledger への直接 INSERT が拒否されること
--   8. 在庫合計（stock_items.quantity）と ledger（in-out 累計）の整合性
--   9. RLS 境界（vendor が lease_batches / 他現場の lease_stock_items を見えないこと）
--   10. 旧 RPC シグネチャ（p_operation_id 無し）が残っていないこと
--
-- 制約: 単一セッション内のテストのため、真の同時実行（受入とキャンセルの競合、
-- 同時出庫等）は検証できない。該当箇所には別セッションでの手動確認手順をコメントで示す。

begin;

-- ===========================================================================
-- 0) テスト用フィクスチャ
-- ===========================================================================
do $test$
declare
  v_admin_id   uuid := gen_random_uuid();
  v_center_id  uuid := gen_random_uuid();
  v_vendor_id  uuid := gen_random_uuid();
  v_vendor_company_id uuid;
  v_product_id uuid;
  v_site_id    uuid;
  v_other_site_id uuid;
  v_company_id uuid;
  v_inactive_company_id uuid;
  v_batch_id   uuid;
  v_item_id    uuid;
  v_op1        uuid := gen_random_uuid();
  v_status     text;
  v_received   numeric;
  v_returned   numeric;
  v_obligation numeric;
  v_count      integer;
  v_ledger_sum numeric;
  v_stock_qty  numeric;
  v_rowcount   integer;
  v_caught     boolean;
begin
  raise notice '=== Phase 3 review test suite: start ===';

  -- ---- auth.users / app_users フィクスチャ ----
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin_id, 'authenticated', 'authenticated',
     'phase3-test-admin@example.invalid', crypt('not-used', gen_salt('bf')),
     now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', v_center_id, 'authenticated', 'authenticated',
     'phase3-test-center@example.invalid', crypt('not-used', gen_salt('bf')),
     now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', v_vendor_id, 'authenticated', 'authenticated',
     'phase3-test-vendor@example.invalid', crypt('not-used', gen_salt('bf')),
     now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

  insert into public.vendors (name) values ('__phase3_test_vendor__')
    returning id into v_vendor_company_id;

  insert into public.app_users (id, role, display_name)
  values (v_admin_id, 'admin', '__test_admin__'),
         (v_center_id, 'center', '__test_center__');
  insert into public.app_users (id, role, display_name, vendor_id)
  values (v_vendor_id, 'vendor', '__test_vendor__', v_vendor_company_id);

  insert into public.products (name, unit) values ('__phase3_test_product__', '本')
    returning id into v_product_id;
  insert into public.sites (name) values ('__phase3_test_site__')
    returning id into v_site_id;
  insert into public.sites (name) values ('__phase3_test_site_other__')
    returning id into v_other_site_id;
  insert into public.vendor_sites (vendor_id, site_id) values (v_vendor_company_id, v_site_id);

  insert into public.lease_companies (name, is_active) values ('__phase3_test_lease_co__', true)
    returning id into v_company_id;
  insert into public.lease_companies (name, is_active) values ('__phase3_test_lease_co_inactive__', false)
    returning id into v_inactive_company_id;

  -- ---------------------------------------------------------------------
  -- 1) create_lease_batch: 正常系・重複明細拒否・非アクティブ会社拒否
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);
  set local role authenticated;

  select public.create_lease_batch(
    v_company_id, 'SLIP-001', current_date, 'center', null, 'test batch',
    jsonb_build_array(
      jsonb_build_object('product_id', v_product_id, 'quantity', 10, 'return_due_date', null)
    ),
    gen_random_uuid()
  ) into v_batch_id;

  if v_batch_id is null then
    raise exception 'TEST FAILED: create_lease_batch did not return a batch id';
  end if;

  select status into v_status from public.lease_batches where id = v_batch_id;
  if v_status <> 'draft' then
    raise exception 'TEST FAILED: new batch status should be draft, got %', v_status;
  end if;

  -- 重複明細（同一商品・同一返却期限）は拒否される
  v_caught := false;
  begin
    perform public.create_lease_batch(
      v_company_id, 'SLIP-DUP', current_date, 'center', null, null,
      jsonb_build_array(
        jsonb_build_object('product_id', v_product_id, 'quantity', 5, 'return_due_date', '2030-01-01'),
        jsonb_build_object('product_id', v_product_id, 'quantity', 3, 'return_due_date', '2030-01-01')
      ),
      gen_random_uuid()
    );
  exception when others then
    if sqlerrm like '%duplicate_item%' then
      v_caught := true;
    else
      raise;
    end if;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: duplicate item in same batch was not rejected';
  end if;

  -- 非アクティブなリース会社は使用不可
  v_caught := false;
  begin
    perform public.create_lease_batch(
      v_inactive_company_id, null, current_date, 'center', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 1, 'return_due_date', null)),
      gen_random_uuid()
    );
  exception when others then
    if sqlerrm like '%lease_company_inactive%' then
      v_caught := true;
    else
      raise;
    end if;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: inactive lease company was not rejected by create_lease_batch';
  end if;

  raise notice 'OK: create_lease_batch (正常系・重複拒否・非アクティブ会社拒否)';

  -- ---------------------------------------------------------------------
  -- 1b) operation_id 必須化: NULL を渡すと operation_id_required で拒否される
  -- ---------------------------------------------------------------------
  v_caught := false;
  begin
    perform public.approve_lease_batch(v_batch_id, null);
  exception when others then
    if sqlerrm like '%operation_id_required%' then
      v_caught := true;
    else
      raise;
    end if;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: NULL operation_id was not rejected (operation_id_required)';
  end if;

  raise notice 'OK: operation_id 必須化（NULL 拒否）';

  -- ---------------------------------------------------------------------
  -- 2) 状態遷移の許容リスト: draft のまま受入を試みると拒否される
  -- ---------------------------------------------------------------------
  select id into v_item_id from public.lease_batch_items where lease_batch_id = v_batch_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_center_id)::text, true);

  v_caught := false;
  begin
    perform public.receive_lease_batch_item(v_item_id, 5, gen_random_uuid());
  exception when others then
    if sqlerrm like '%lease_batch_not_approved%' then
      v_caught := true;
    else
      raise;
    end if;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: receive on draft batch was not rejected';
  end if;

  v_caught := false;
  begin
    perform public.ship_lease_stock_to_site(v_item_id, v_site_id, 1, gen_random_uuid());
  exception when others then
    if sqlerrm like '%invalid_status_transition%' then
      v_caught := true;
    else
      raise;
    end if;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: ship before any receipt was not rejected';
  end if;

  raise notice 'OK: 状態遷移の許容リスト（draft での受入・出庫が拒否される）';

  -- ---------------------------------------------------------------------
  -- 3) 承認後の直接 DML 拒否（RLS 境界）
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);
  perform public.approve_lease_batch(v_batch_id, gen_random_uuid());

  select status into v_status from public.lease_batches where id = v_batch_id;
  if v_status <> 'approved' then
    raise exception 'TEST FAILED: batch status should be approved, got %', v_status;
  end if;

  update public.lease_batches set note = 'tampered' where id = v_batch_id;
  get diagnostics v_rowcount = row_count;
  if v_rowcount <> 0 then
    raise exception 'TEST FAILED: direct UPDATE on approved lease_batches should affect 0 rows, affected %', v_rowcount;
  end if;

  update public.lease_batch_items set quantity = 999 where id = v_item_id;
  get diagnostics v_rowcount = row_count;
  if v_rowcount <> 0 then
    raise exception 'TEST FAILED: direct UPDATE on lease_batch_items of an approved batch should affect 0 rows, affected %', v_rowcount;
  end if;

  raise notice 'OK: 承認後の直接 DML 拒否（RLS）';

  -- ---------------------------------------------------------------------
  -- 4) 部分受入 → 二重送信（idempotency） → receiving_closed → 部分返却 → 全量返却
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_center_id)::text, true);

  -- 部分受入（10本中 6本）
  perform public.receive_lease_batch_item(v_item_id, 6, v_op1);

  select received_quantity into v_received from public.lease_batch_items where id = v_item_id;
  if v_received <> 6 then
    raise exception 'TEST FAILED: received_quantity should be 6, got %', v_received;
  end if;

  select status into v_status from public.lease_batches where id = v_batch_id;
  if v_status <> 'receiving' then
    raise exception 'TEST FAILED: batch status should be receiving, got %', v_status;
  end if;

  -- 二重送信: 同一 operation_id で再送しても received_quantity は変わらない
  perform public.receive_lease_batch_item(v_item_id, 6, v_op1);
  select received_quantity into v_received from public.lease_batch_items where id = v_item_id;
  if v_received <> 6 then
    raise exception 'TEST FAILED: duplicate operation_id caused double processing, received_quantity=%', v_received;
  end if;

  raise notice 'OK: 部分受入・二重送信（idempotency）';

  -- ---------------------------------------------------------------------
  -- 1c) operation_id の使い回し: 同じ operation_id (v_op1) を別操作(close_lease_batch_item_receiving)
  --     に使い回すと operation_id_conflict で拒否される（target は同じ item_id だが operation_type が異なる）
  -- ---------------------------------------------------------------------
  v_caught := false;
  begin
    perform public.close_lease_batch_item_receiving(v_item_id, 'conflict test', v_op1);
  exception when others then
    if sqlerrm like '%operation_id_conflict%' then
      v_caught := true;
    else
      raise;
    end if;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: reusing operation_id for a different operation_type was not rejected';
  end if;

  raise notice 'OK: operation_id 使い回し拒否（operation_id_conflict）';

  -- 未受入のまま受入終了（10本中 4本は届かない前提で終了）
  perform public.close_lease_batch_item_receiving(v_item_id, 'テスト: 欠品のため打ち切り', gen_random_uuid());

  select status into v_status from public.lease_batches where id = v_batch_id;
  if v_status <> 'received' then
    raise exception 'TEST FAILED: batch status should be received after closing short receipt, got %', v_status;
  end if;

  -- 既に closed 済みへの再クローズは拒否される。
  -- ここは1明細のみの伝票のため、直前の close で明細が「受入完了」となり
  -- refresh_lease_batch_status が伝票を 'received' へ進めている（上のアサーションで確認済み）。
  -- close_lease_batch_item_receiving は明細レベルの receiving_closed チェックより先に
  -- 伝票レベルの状態許容リスト（'approved','receiving' のみ）を見るため、
  -- 'received' になった時点でこの伝票配下の明細に対する呼び出しは
  -- 常に lease_batch_not_approved で弾かれる（意図した多層防御であり、RPC 側の不具合ではない）。
  -- 明細レベルの receiving_already_closed 自体は、下の 1d) で
  -- 「他の明細が未完了のため伝票が receiving のまま」の状況を作って別途検証する。
  v_caught := false;
  begin
    perform public.close_lease_batch_item_receiving(v_item_id, 'again', gen_random_uuid());
  exception when others then
    if sqlerrm like '%lease_batch_not_approved%' then
      v_caught := true;
    else
      raise;
    end if;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: closing an already-closed item (batch already received) was not rejected';
  end if;

  raise notice 'OK: 未受入終了（receiving_closed）・伝票 received 後の再クローズ拒否';

  -- ---------------------------------------------------------------------
  -- 1d) receiving_already_closed（明細レベル）を、伝票が 'receiving' のまま保てる
  --     2明細の伝票で単独検証する。1明細だけを close し、もう1明細は未受入のまま残すことで
  --     refresh_lease_batch_status が伝票を 'received' へ進めないようにする。
  -- ---------------------------------------------------------------------
  declare
    v_batch2_id uuid;
    v_item2a_id uuid;
    v_item2b_id uuid;
    v_product2_id uuid;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);

    insert into public.products (name, unit) values ('__phase3_test_product2__', '本')
      returning id into v_product2_id;

    select public.create_lease_batch(
      v_company_id, 'SLIP-002', current_date, 'center', null, 'two-item batch',
      jsonb_build_array(
        jsonb_build_object('product_id', v_product_id, 'quantity', 5, 'return_due_date', null),
        jsonb_build_object('product_id', v_product2_id, 'quantity', 5, 'return_due_date', null)
      ),
      gen_random_uuid()
    ) into v_batch2_id;

    perform public.approve_lease_batch(v_batch2_id, gen_random_uuid());

    select id into v_item2a_id from public.lease_batch_items
     where lease_batch_id = v_batch2_id and product_id = v_product_id;
    select id into v_item2b_id from public.lease_batch_items
     where lease_batch_id = v_batch2_id and product_id = v_product2_id;

    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v_center_id)::text, true);

    -- item2a のみ受入終了。item2b は未着手のまま残すため、伝票は 'receiving' に留まる。
    perform public.receive_lease_batch_item(v_item2a_id, 1, gen_random_uuid());
    perform public.close_lease_batch_item_receiving(v_item2a_id, 'テスト: item2a 打ち切り', gen_random_uuid());

    select status into v_status from public.lease_batches where id = v_batch2_id;
    if v_status <> 'receiving' then
      raise exception 'TEST FAILED: batch2 status should stay receiving (item2b untouched), got %', v_status;
    end if;

    -- 伝票が 'receiving' のまま item2a を再クローズ → 今度こそ item レベルの
    -- receiving_already_closed が（伝票レベルの許容リストを通過した上で）検出される。
    v_caught := false;
    begin
      perform public.close_lease_batch_item_receiving(v_item2a_id, 'again', gen_random_uuid());
    exception when others then
      if sqlerrm like '%receiving_already_closed%' then
        v_caught := true;
      else
        raise;
      end if;
    end;
    if not v_caught then
      raise exception 'TEST FAILED: item-level receiving_already_closed guard was not triggered';
    end if;
  end;

  raise notice 'OK: receiving_already_closed（明細レベル・伝票が receiving のまま）';

  -- センターから現場へ一部出庫 → 現場から返却 → センターからリース会社へ一部返却
  perform public.ship_lease_stock_to_site(v_item_id, v_site_id, 4, gen_random_uuid());
  perform public.return_lease_stock_from_site(v_item_id, v_site_id, 4, gen_random_uuid());

  -- 返却義務残 = received(6) - returned(0) = 6。3本だけ返却
  perform public.return_lease_to_company(v_item_id, 3, gen_random_uuid());

  select received_quantity, returned_quantity, return_obligation_quantity
    into v_received, v_returned, v_obligation
    from public.lease_batch_items where id = v_item_id;

  if v_received <> 6 or v_returned <> 3 or v_obligation <> 3 then
    raise exception 'TEST FAILED: partial return mismatch (received=%, returned=%, obligation=%)',
      v_received, v_returned, v_obligation;
  end if;

  -- 受入済み(6)を超える返却は拒否される（未受入の4本は返却対象にならない）
  v_caught := false;
  begin
    perform public.return_lease_to_company(v_item_id, 4, gen_random_uuid());
  exception when others then
    if sqlerrm like '%returned_exceeds_received%' then
      v_caught := true;
    else
      raise;
    end if;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: over-return beyond received_quantity was not rejected';
  end if;

  -- 残り3本を返却して全量返却済みへ
  perform public.return_lease_to_company(v_item_id, 3, gen_random_uuid());

  select status into v_status from public.lease_batches where id = v_batch_id;
  if v_status <> 'closed' then
    raise exception 'TEST FAILED: batch status should be closed after full return, got %', v_status;
  end if;

  select return_obligation_quantity into v_obligation
    from public.lease_batch_items where id = v_item_id;
  if v_obligation <> 0 then
    raise exception 'TEST FAILED: return_obligation_quantity should be 0, got %', v_obligation;
  end if;

  raise notice 'OK: 部分返却・全量返却・完了判定（実受入数基準）';

  -- ---------------------------------------------------------------------
  -- 5) DB 制約: returned_quantity <= received_quantity
  --    ここでは制約そのものを確認したいため、RLS の影響を受けない特権ロールで検証する
  --    （authenticated のままだと、closed 済みバッチへの直接 UPDATE は RLS が先に 0 行で
  --      弾くため、CHECK 制約の検証にならない）。
  -- ---------------------------------------------------------------------
  reset role;

  v_caught := false;
  begin
    update public.lease_batch_items
       set returned_quantity = received_quantity + 1
     where id = v_item_id;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: check constraint did not prevent returned_quantity > received_quantity';
  end if;

  raise notice 'OK: DB 制約 returned_quantity <= received_quantity';

  -- ---------------------------------------------------------------------
  -- 6) 在庫合計とリース ledger の整合性（受入 - リース会社返却 = 現在庫合計）
  -- ---------------------------------------------------------------------
  select coalesce(sum(quantity), 0) into v_stock_qty
    from public.lease_stock_items where lease_batch_item_id = v_item_id;

  select
    coalesce(sum(quantity) filter (where reason = 'receive'), 0)
      - coalesce(sum(quantity) filter (where reason = 'return_to_company'), 0)
    into v_ledger_sum
    from public.lease_stock_ledger
   where lease_batch_item_id = v_item_id;

  if v_stock_qty <> v_ledger_sum then
    raise exception 'TEST FAILED: lease stock total (%) does not match receive-minus-return ledger total (%)',
      v_stock_qty, v_ledger_sum;
  end if;

  raise notice 'OK: リース在庫合計と ledger の整合性';

  -- ---------------------------------------------------------------------
  -- 7) キャンセル: 受入済みのバッチはキャンセル不可
  --    5) で reset role したため、RLS を有効化する authenticated ロールへ戻す
  -- ---------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);
  v_caught := false;
  begin
    perform public.cancel_lease_batch(v_batch_id, gen_random_uuid());
  exception when others then
    if sqlerrm like '%invalid_status_transition%' or sqlerrm like '%lease_batch_already_received%' then
      v_caught := true;
    else
      raise;
    end if;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: cancel on a batch with receipts was not rejected';
  end if;

  raise notice 'OK: 受入済みバッチのキャンセル拒否';

  -- ---------------------------------------------------------------------
  -- 8) stock_items 直接書込の拒否 と adjust_stock_item の整合性
  --    フィクスチャ行の作成は特権ロールで行い（GRANT の影響を受けない）、
  --    「authenticated が直接 UPDATE できないこと」のみを RLS 有効ロールで検証する。
  -- ---------------------------------------------------------------------
  reset role;
  insert into public.stock_items (product_id, location, quantity)
    values (v_product_id, 'center', 0)
    on conflict (product_id, location) do nothing;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);

  v_caught := false;
  begin
    update public.stock_items set quantity = 999 where product_id = v_product_id and location = 'center';
  exception when others then
    v_caught := true; -- permission denied for table stock_items（GRANT 剥奪）
  end;
  if not v_caught then
    raise exception 'TEST FAILED: direct UPDATE on stock_items should be rejected (grant revoked)';
  end if;

  -- 7b) stock_ledger への直接 INSERT も拒否される（GRANT 剥奪 + policy 削除）
  v_caught := false;
  begin
    insert into public.stock_ledger (product_id, location, movement_type, quantity)
    values (v_product_id, 'center', 'in', 1);
  exception when others then
    v_caught := true; -- permission denied for table stock_ledger（GRANT 剥奪）
  end;
  if not v_caught then
    raise exception 'TEST FAILED: direct INSERT on stock_ledger should be rejected (grant revoked)';
  end if;

  perform public.adjust_stock_item(v_product_id, 'center', 50, 'opening_balance');
  select quantity into v_stock_qty from public.stock_items
   where product_id = v_product_id and location = 'center';
  if v_stock_qty <> 50 then
    raise exception 'TEST FAILED: adjust_stock_item did not set quantity to 50, got %', v_stock_qty;
  end if;

  perform public.adjust_stock_item(v_product_id, 'center', 30, 'inventory_adjustment');

  select
    coalesce(sum(quantity) filter (where movement_type = 'in'), 0)
      - coalesce(sum(quantity) filter (where movement_type = 'out'), 0)
    into v_ledger_sum
    from public.stock_ledger
   where product_id = v_product_id and location = 'center';

  select quantity into v_stock_qty from public.stock_items
   where product_id = v_product_id and location = 'center';

  if v_stock_qty <> v_ledger_sum then
    raise exception 'TEST FAILED: stock_items.quantity (%) does not reconcile with stock_ledger total (%)',
      v_stock_qty, v_ledger_sum;
  end if;

  select count(*) into v_count from public.stock_ledger
   where product_id = v_product_id and location = 'center' and reason is not null;
  if v_count < 2 then
    raise exception 'TEST FAILED: adjust_stock_item should have written reason-tagged ledger rows, found %', v_count;
  end if;

  raise notice 'OK: stock_items 直接書込拒否・adjust_stock_item の ledger 整合性';

  -- ---------------------------------------------------------------------
  -- 9) 計画超過ビューの二重計上修正
  --    stock_requests への admin 直接 INSERT policy は存在しない仕様のため
  --    （作成は vendor のみ）、フィクスチャ投入は特権ロールで行う。
  -- ---------------------------------------------------------------------
  reset role;

  insert into public.site_product_plans (site_id, product_id, planned_quantity)
  values (v_site_id, v_product_id, 3);

  -- shipped な依頼（既出庫扱い）
  insert into public.stock_requests (site_id, product_id, quantity, status, original_quantity)
  values (v_site_id, v_product_id, 4, 'shipped', 4);

  -- cancelled な依頼（数量を加算してはならない）
  insert into public.stock_requests (site_id, product_id, quantity, status, original_quantity)
  values (v_site_id, v_product_id, 100, 'cancelled', 100);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);

  select expected_quantity into v_stock_qty
    from public.stock_request_plan_status
   where site_id = v_site_id and product_id = v_product_id and status = 'shipped'
   limit 1;

  select shipped_quantity into v_ledger_sum
    from public.site_product_plan_status
   where site_id = v_site_id and product_id = v_product_id;

  if v_stock_qty is distinct from v_ledger_sum then
    raise exception 'TEST FAILED: shipped request expected_quantity (%) should equal shipped_quantity (%), double counted?',
      v_stock_qty, v_ledger_sum;
  end if;

  select count(*) into v_count
    from public.stock_request_plan_status
   where site_id = v_site_id and product_id = v_product_id
     and status = 'cancelled' and is_over = true;
  if v_count <> 0 then
    raise exception 'TEST FAILED: cancelled request must never be is_over=true, found % rows', v_count;
  end if;

  raise notice 'OK: 計画超過ビューの二重計上修正';

  -- ---------------------------------------------------------------------
  -- 10) RLS 境界: vendor は lease_batches / 他現場のリース在庫を見えない
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_vendor_id)::text, true);

  select count(*) into v_count from public.lease_batches where id = v_batch_id;
  if v_count <> 0 then
    raise exception 'TEST FAILED: vendor should not see lease_batches, got % rows', v_count;
  end if;

  select count(*) into v_count from public.lease_stock_items
   where lease_batch_item_id = v_item_id and site_id = v_other_site_id;
  if v_count <> 0 then
    raise exception 'TEST FAILED: vendor should not see other site''s lease_stock_items, got % rows', v_count;
  end if;

  raise notice 'OK: RLS 境界（vendor）';

  -- ---------------------------------------------------------------------
  -- 11) 旧 RPC シグネチャ（p_operation_id 無し）が残っていないこと
  --     pg_get_function_identity_arguments は型リストのみを返し引数名を含まないため、
  --     'operation_id' 文字列検索ではなく、引数の個数（新シグネチャの個数）で判定する。
  -- ---------------------------------------------------------------------
  reset role;

  -- 期待される引数の個数（新シグネチャ = 旧シグネチャ + p_operation_id の1個）
  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (
       (p.proname in ('approve_lease_batch', 'cancel_lease_batch') and p.pronargs <> 2)
       or (p.proname in ('receive_lease_batch_item', 'return_lease_to_company') and p.pronargs <> 3)
       or (p.proname in ('ship_lease_stock_to_site', 'return_lease_stock_from_site') and p.pronargs <> 4)
     )
     and p.proname in ('approve_lease_batch', 'cancel_lease_batch',
                        'receive_lease_batch_item', 'ship_lease_stock_to_site',
                        'return_lease_stock_from_site', 'return_lease_to_company');
  if v_count <> 0 then
    raise exception 'TEST FAILED: % lease RPC(s) with an unexpected argument count (old signature?) still exist', v_count;
  end if;

  -- 関数名ごとに1シグネチャのみ存在すること（旧シグネチャが並存していないこと）
  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('approve_lease_batch', 'cancel_lease_batch',
                        'receive_lease_batch_item', 'ship_lease_stock_to_site',
                        'return_lease_stock_from_site', 'return_lease_to_company');
  if v_count <> 6 then
    raise exception 'TEST FAILED: expected exactly 6 lease RPC signatures (1 each), found %', v_count;
  end if;

  raise notice 'OK: 旧 RPC シグネチャが残っていないこと';

  raise notice '=== Phase 3 review test suite: ALL PASSED ===';
end;
$test$;

rollback;

-- ---------------------------------------------------------------------------
-- 単一セッションでは検証できない項目（別セッションでの手動確認手順）
-- ---------------------------------------------------------------------------
-- 【受入とキャンセルの競合】
--   セッションA (center): begin; select public.receive_lease_batch_item('<item_id>', 1, gen_random_uuid());
--     （まだ commit しない）
--   セッションB (admin) : begin; select public.cancel_lease_batch('<batch_id>', gen_random_uuid());
--     → セッションAの lease_batches ロック解放（commit/rollback）までブロックされることを確認
--   セッションA: commit;
--   セッションB: ブロック解除後、received_quantity>0 のため lease_batch_already_received で
--     例外になることを確認（先着の受入が正しく反映された状態でキャンセルが安全に拒否される）
--
-- 【同時出庫・同時返却】
--   2つのセッションから同一 item_id に対しほぼ同時に
--   ship_lease_stock_to_site / return_lease_to_company を実行し、
--   在庫不足時に insufficient_lease_stock / returned_exceeds_received で
--   片方が必ず拒否され、在庫がマイナスにならないことを確認する
--   （apply_lease_stock_movement の for update により直列化される）。
