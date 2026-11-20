-- Shiflun: ログイン（Supabase Auth）とアクセス制限（RLS）
--
-- これまでは端末に保存したIDで本人を区別しており、公開用の anon キーでどのテーブルも読み書きできた。
-- このマイグレーションで、次のようにする。
--   * anon（ログインしていない状態）は、どのテーブルも読み書きできない
--   * ワーカーは workers.user_id、店長は stores.owner_user_id でログインユーザーと結びつける
--   * 各テーブルは「本人」「関係する店舗」の範囲だけを読み書きできる
--   * 重要な値（認証状態・提示額・支払い状態など）は、決められた操作でしか変えられない
--   * 身分証は、審査担当（app_metadata.role = 'identity_reviewer'）が2段階認証（aal2）でログインしたときだけ見られる
--
-- 【実行前に必要なこと】既存のテストデータを消すこと（supabase/setup/reset_test_data.sql）。
-- workers.user_id / stores.owner_user_id を必須にするため、ログインと結びついていない行が残っていると失敗する。
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ログインユーザーとの結びつき
-- ---------------------------------------------------------------------------
ALTER TABLE public.workers ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.stores ALTER COLUMN owner_user_id SET NOT NULL;
-- 1つのログインで持てる店舗は1つ（アプリは「自分の店舗」を1つとして扱う）。
CREATE UNIQUE INDEX uq_stores_owner_user_id ON public.stores (owner_user_id);

-- 所属登録の記録・通報を、店舗名ではなく店舗IDで絞り込めるようにする。
ALTER TABLE public.store_join_requests ADD COLUMN store_id UUID REFERENCES public.stores (id) ON DELETE CASCADE;
ALTER TABLE public.store_join_requests ADD COLUMN worker_id UUID REFERENCES public.workers (id) ON DELETE CASCADE;
CREATE INDEX idx_store_join_requests_store_id ON public.store_join_requests (store_id, created_at DESC);
ALTER TABLE public.worker_flags ADD COLUMN store_id UUID REFERENCES public.stores (id) ON DELETE CASCADE;
CREATE INDEX idx_worker_flags_store_id ON public.worker_flags (store_id, status);

-- ---------------------------------------------------------------------------
-- 2. 判定用の関数（RLS の中で使う。SECURITY DEFINER なので RLS を再帰的に評価しない）
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.current_worker_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM workers WHERE user_id = auth.uid()
$$;

CREATE FUNCTION public.current_store_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM stores WHERE owner_user_id = auth.uid()
$$;

CREATE FUNCTION public.owns_store(p_store_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_store_id IS NOT NULL AND EXISTS (SELECT 1 FROM stores WHERE id = p_store_id AND owner_user_id = auth.uid())
$$;

CREATE FUNCTION public.is_store_owner() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM stores WHERE owner_user_id = auth.uid())
$$;

-- 店舗が自店のスタッフ（現在の所属店舗が自店のワーカー）かどうか。
CREATE FUNCTION public.is_my_staff(p_worker_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM workers w JOIN stores s ON s.id = w.current_store_id WHERE w.id = p_worker_id AND s.owner_user_id = auth.uid())
$$;

-- 審査担当。app_metadata は利用者が自分で書き換えられない（運営が SQL か Dashboard で付与する）。
-- 2段階認証を済ませたログイン（aal2）のときだけ true。
CREATE FUNCTION public.is_identity_reviewer() RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'identity_reviewer'
    AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- ---------------------------------------------------------------------------
-- 3. 権限の初期化：anon は何もできない。authenticated は下のポリシーの範囲だけ
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS shiflun_companies_select ON public.companies;
DROP POLICY IF EXISTS shiflun_companies_insert ON public.companies;
DROP POLICY IF EXISTS shiflun_stores_select ON public.stores;
DROP POLICY IF EXISTS shiflun_stores_insert ON public.stores;
DROP POLICY IF EXISTS shiflun_stores_update ON public.stores;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

-- authenticated は、テーブルごとに必要な操作だけ許可し直す。
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
GRANT EXECUTE ON FUNCTION public.current_worker_id(), public.current_store_id(), public.owns_store(UUID),
  public.is_store_owner(), public.is_my_staff(UUID), public.is_identity_reviewer() TO authenticated;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. テーブルごとのポリシー
-- ---------------------------------------------------------------------------
-- companies / stores: 店舗名は全員に見せる（所属店舗の選択・スカウト元の表示）。登録は create_scouting_store だけ。
GRANT SELECT ON public.companies, public.stores TO authenticated;
CREATE POLICY companies_select ON public.companies FOR SELECT TO authenticated USING (true);
CREATE POLICY stores_select ON public.stores FOR SELECT TO authenticated USING (true);
GRANT UPDATE (area, hourly_wage, terms_version, terms_agreed_at) ON public.stores TO authenticated;
CREATE POLICY stores_update_own ON public.stores FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

-- workers: 本人と、店舗（スカウト・スタッフ管理のため）と、審査担当が読める。
-- 認証状態（verification_status）とログインとの結びつき（user_id）は本人も変えられない。
GRANT SELECT, INSERT ON public.workers TO authenticated;
GRANT UPDATE (name, current_store, current_store_id, business_type, job_type, experience_years, skills, bio,
  skill_tags, preferred_areas, terms_version, terms_agreed_at) ON public.workers TO authenticated;
CREATE POLICY workers_select ON public.workers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_store_owner() OR public.is_identity_reviewer());
CREATE POLICY workers_insert_self ON public.workers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND verification_status = 'unverified');
CREATE POLICY workers_update_self ON public.workers FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- worker_availability_slots: 本人と、自店に関係するシフト（スタッフの希望・自店のスカウト）と、
-- 他店へ公開されたシフト（status = 'released'、人材検索用）を店舗が読める。
GRANT SELECT, INSERT, DELETE ON public.worker_availability_slots TO authenticated;
GRANT UPDATE (status, reviewed_at, clock_in_at, clock_in_lat, clock_in_lng, clock_out_at, clock_out_lat, clock_out_lng, checkin_method)
  ON public.worker_availability_slots TO authenticated;
CREATE POLICY slots_select ON public.worker_availability_slots FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id()
    OR (public.is_store_owner() AND (status = 'released' OR public.owns_store(store_id) OR public.is_my_staff(worker_id))));
CREATE POLICY slots_insert_self ON public.worker_availability_slots FOR INSERT TO authenticated
  WITH CHECK (worker_id = public.current_worker_id() AND status = 'pending' AND scout_request_id IS NULL
    AND clock_in_at IS NULL AND clock_out_at IS NULL);
CREATE POLICY slots_update ON public.worker_availability_slots FOR UPDATE TO authenticated
  USING (worker_id = public.current_worker_id() OR public.is_my_staff(worker_id))
  WITH CHECK (worker_id = public.current_worker_id() OR public.is_my_staff(worker_id));
CREATE POLICY slots_delete_own_pending ON public.worker_availability_slots FOR DELETE TO authenticated
  USING (worker_id = public.current_worker_id() AND status = 'pending');

-- 誰がどの状態遷移をしてよいかを、変更できる列も含めて確認する。
-- ワーカー: 当日の確定シフトの出勤打刻（assigned → attended）、出勤後の退勤打刻。
-- 店長: 自店スタッフの勤務希望の確定・他店への公開（pending → assigned / released）。
CREATE FUNCTION public.guard_slot_update() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_same_except JSONB;
  v_today DATE := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  -- ログインしていない文脈（運営の SQL Editor、SECURITY DEFINER の関数内など）は対象外。
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.worker_id = current_worker_id() THEN
    IF OLD.status = 'assigned' AND NEW.status = 'attended' AND OLD.work_date = v_today
      AND (to_jsonb(NEW) - ARRAY['status', 'reviewed_at', 'clock_in_at', 'clock_in_lat', 'clock_in_lng', 'checkin_method'])
        = (to_jsonb(OLD) - ARRAY['status', 'reviewed_at', 'clock_in_at', 'clock_in_lat', 'clock_in_lng', 'checkin_method']) THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'attended' AND NEW.status = 'attended' AND OLD.clock_out_at IS NULL AND NEW.clock_out_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['clock_out_at', 'clock_out_lat', 'clock_out_lng'])
        = (to_jsonb(OLD) - ARRAY['clock_out_at', 'clock_out_lat', 'clock_out_lng']) THEN
      RETURN NEW;
    END IF;
  ELSIF is_my_staff(NEW.worker_id) THEN
    IF OLD.status = 'pending' AND NEW.status IN ('assigned', 'released')
      AND (to_jsonb(NEW) - ARRAY['status', 'reviewed_at']) = (to_jsonb(OLD) - ARRAY['status', 'reviewed_at']) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'このシフトは変更できません。画面を更新してください。' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER guard_slot_update BEFORE UPDATE ON public.worker_availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.guard_slot_update();

-- scout_requests: 当事者（ワーカー本人・送った店舗）だけが読める。送れるのは自店から。
-- 返信は respond_to_scout だけ（直接の UPDATE は許可しない）。
GRANT SELECT, INSERT ON public.scout_requests TO authenticated;
CREATE POLICY scouts_select ON public.scout_requests FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id() OR public.owns_store(store_id));
CREATE POLICY scouts_insert_from_own_store ON public.scout_requests FOR INSERT TO authenticated
  WITH CHECK (public.owns_store(store_id));

-- scout_messages: スカウトの当事者だけ。送信者は自分自身に限る。
GRANT SELECT, INSERT ON public.scout_messages TO authenticated;
CREATE POLICY scout_messages_select ON public.scout_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM scout_requests r WHERE r.id = scout_id
    AND (r.worker_id = public.current_worker_id() OR public.owns_store(r.store_id))));
CREATE POLICY scout_messages_insert ON public.scout_messages FOR INSERT TO authenticated
  WITH CHECK ((sender_role = 'worker' AND sender_id = public.current_worker_id())
    OR (sender_role = 'store' AND public.owns_store(sender_id)));

-- staff_messages: 所属スタッフ本人と、所属先の店舗だけ。
GRANT SELECT, INSERT ON public.staff_messages TO authenticated;
CREATE POLICY staff_messages_select ON public.staff_messages FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id() OR public.owns_store(store_id));
CREATE POLICY staff_messages_insert ON public.staff_messages FOR INSERT TO authenticated
  WITH CHECK ((sender_role = 'worker' AND worker_id = public.current_worker_id())
    OR (sender_role = 'store' AND public.owns_store(store_id)));

-- app_notifications: 宛先本人だけ。作成はトリガーだけ、更新は既読（read_at）だけ。
GRANT SELECT ON public.app_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.app_notifications TO authenticated;
CREATE POLICY notifications_select ON public.app_notifications FOR SELECT TO authenticated
  USING (recipient_worker_id = public.current_worker_id() OR public.owns_store(recipient_store_id));
CREATE POLICY notifications_mark_read ON public.app_notifications FOR UPDATE TO authenticated
  USING (recipient_worker_id = public.current_worker_id() OR public.owns_store(recipient_store_id))
  WITH CHECK (recipient_worker_id = public.current_worker_id() OR public.owns_store(recipient_store_id));

-- manager_verifications: 店長認証。登録できるのは、そのワーカーの所属店舗の店長だけ。
-- 登録すると、トリガーがワーカーの認証状態を verified にする（ワーカー本人は変えられない）。
GRANT SELECT, INSERT ON public.manager_verifications TO authenticated;
CREATE POLICY manager_verifications_select ON public.manager_verifications FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id() OR public.is_store_owner());
CREATE POLICY manager_verifications_insert ON public.manager_verifications FOR INSERT TO authenticated
  WITH CHECK (public.owns_store(store_id) AND public.is_my_staff(worker_id) AND verified = true);

CREATE FUNCTION public.mark_worker_verified() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE workers SET verification_status = 'verified' WHERE id = NEW.worker_id;
  RETURN NEW;
END $$;
CREATE TRIGGER mark_worker_verified AFTER INSERT ON public.manager_verifications
  FOR EACH ROW EXECUTE FUNCTION public.mark_worker_verified();

-- shift_periods: 自店のシフト期間。自店のスタッフも読める。
GRANT SELECT, INSERT ON public.shift_periods TO authenticated;
GRANT UPDATE (status) ON public.shift_periods TO authenticated;
CREATE POLICY shift_periods_select ON public.shift_periods FOR SELECT TO authenticated
  USING (public.owns_store(store_id)
    OR EXISTS (SELECT 1 FROM workers w WHERE w.user_id = auth.uid() AND w.current_store_id = store_id));
CREATE POLICY shift_periods_insert ON public.shift_periods FOR INSERT TO authenticated
  WITH CHECK (public.owns_store(store_id));
CREATE POLICY shift_periods_update ON public.shift_periods FOR UPDATE TO authenticated
  USING (public.owns_store(store_id)) WITH CHECK (public.owns_store(store_id));

-- store_join_requests: 所属登録の記録。登録したワーカー本人が作り、所属先の店舗が読む。
GRANT SELECT, INSERT ON public.store_join_requests TO authenticated;
CREATE POLICY join_requests_select ON public.store_join_requests FOR SELECT TO authenticated
  USING (public.owns_store(store_id));
CREATE POLICY join_requests_insert_self ON public.store_join_requests FOR INSERT TO authenticated
  WITH CHECK (worker_id = public.current_worker_id());

-- worker_flags: 店長からの通報。自店のスタッフについてだけ通報でき、自店の通報だけ読める・対応できる。
GRANT SELECT, INSERT ON public.worker_flags TO authenticated;
GRANT UPDATE (status, resolved_at, resolution_note) ON public.worker_flags TO authenticated;
CREATE POLICY worker_flags_select ON public.worker_flags FOR SELECT TO authenticated
  USING (public.owns_store(store_id));
CREATE POLICY worker_flags_insert ON public.worker_flags FOR INSERT TO authenticated
  WITH CHECK (public.owns_store(store_id) AND public.is_my_staff(worker_id) AND status = 'open');
CREATE POLICY worker_flags_update ON public.worker_flags FOR UPDATE TO authenticated
  USING (public.owns_store(store_id)) WITH CHECK (public.owns_store(store_id));

-- payouts: ワーカー本人と支払う店舗だけ。店舗が「支払い済み」を記録できる（作成はトリガーだけ）。
GRANT SELECT ON public.payouts TO authenticated;
GRANT UPDATE (status, marked_paid_by, paid_at) ON public.payouts TO authenticated;
CREATE POLICY payouts_select ON public.payouts FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id() OR public.owns_store(store_id));
CREATE POLICY payouts_mark_paid ON public.payouts FOR UPDATE TO authenticated
  USING (public.owns_store(store_id) AND status = 'pending')
  WITH CHECK (public.owns_store(store_id) AND status = 'paid');

-- identity_verifications: 本人は提出（審査待ちにする）だけ。審査結果を書けるのは審査担当だけ。
GRANT SELECT, INSERT ON public.identity_verifications TO authenticated;
-- worker_id は upsert（ON CONFLICT DO UPDATE）が SET 句に含めるため許可する。行の持ち主はポリシーで固定している。
GRANT UPDATE (worker_id, status, full_name_kana, birth_date, document_type, document_storage_path, provider, submitted_at,
  reviewed_at, reviewer_name, reject_reason) ON public.identity_verifications TO authenticated;
CREATE POLICY identity_select ON public.identity_verifications FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id() OR public.is_identity_reviewer());
CREATE POLICY identity_submit_insert ON public.identity_verifications FOR INSERT TO authenticated
  WITH CHECK (worker_id = public.current_worker_id() AND status = 'pending' AND provider = 'manual'
    AND reviewed_at IS NULL AND reviewer_name IS NULL AND reject_reason IS NULL
    AND split_part(document_storage_path, '/', 1) = worker_id::text);
CREATE POLICY identity_submit_update ON public.identity_verifications FOR UPDATE TO authenticated
  USING (worker_id = public.current_worker_id() AND status <> 'verified')
  WITH CHECK (worker_id = public.current_worker_id() AND status = 'pending' AND provider = 'manual'
    AND reviewed_at IS NULL AND reviewer_name IS NULL AND reject_reason IS NULL
    AND split_part(document_storage_path, '/', 1) = worker_id::text);
CREATE POLICY identity_review ON public.identity_verifications FOR UPDATE TO authenticated
  USING (public.is_identity_reviewer()) WITH CHECK (public.is_identity_reviewer());

-- worker_scout_stats: 完了したスカウト件数だけを返すビュー。店舗が他店の実績件数も見られるよう、
-- ビュー所有者の権限で集計する（件数以外の列は出さない）。
ALTER VIEW public.worker_scout_stats SET (security_invoker = false);
GRANT SELECT ON public.worker_scout_stats TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. トリガー・関数：他人の行を読む・通知を作るものは SECURITY DEFINER にする
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.prepare_scout_offer() SECURITY DEFINER;
ALTER FUNCTION public.notify_scout_event() SECURITY DEFINER;
ALTER FUNCTION public.check_scout_message() SECURITY DEFINER;
ALTER FUNCTION public.notify_chat_message() SECURITY DEFINER;
ALTER FUNCTION public.create_payout_on_attendance() SECURITY DEFINER;
ALTER FUNCTION public.check_staff_message() SECURITY DEFINER;
ALTER FUNCTION public.notify_staff_message() SECURITY DEFINER;

-- スカウトへの返信：ログイン中のワーカー本人だけが返信できる。
CREATE OR REPLACE FUNCTION public.respond_to_scout(p_scout_id UUID, p_worker_id UUID, p_status TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_scout scout_requests%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('accepted', 'rejected') THEN RAISE EXCEPTION '返信内容が不正です。'; END IF;
  IF p_worker_id IS DISTINCT FROM current_worker_id() THEN RAISE EXCEPTION 'スカウトが見つかりません。'; END IF;
  PERFORM 1 FROM workers WHERE id = p_worker_id FOR UPDATE;
  SELECT * INTO v_scout FROM scout_requests WHERE id = p_scout_id AND worker_id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'スカウトが見つかりません。'; END IF;
  IF v_scout.status = p_status THEN RETURN p_status; END IF;
  IF v_scout.status <> 'pending' THEN RAISE EXCEPTION 'このスカウトは返信済みです。'; END IF;
  IF p_status = 'accepted' THEN
    IF v_scout.store_id IS NULL THEN RAISE EXCEPTION '店舗情報が未設定です。送信元の店舗に新しいスカウトを依頼してください。'; END IF;
    IF v_scout.preferred_work_date IS NULL OR v_scout.preferred_work_date < (now() AT TIME ZONE 'Asia/Tokyo')::date
      OR v_scout.preferred_start_time IS NULL OR v_scout.preferred_end_time IS NULL THEN RAISE EXCEPTION '勤務日時を確認してください。過去のスカウトは承諾できません。'; END IF;
    IF EXISTS (SELECT 1 FROM worker_availability_slots WHERE worker_id = p_worker_id
      AND work_date = v_scout.preferred_work_date AND status IN ('assigned', 'attended')
      AND start_time < v_scout.preferred_end_time AND end_time > v_scout.preferred_start_time
      AND scout_request_id IS DISTINCT FROM p_scout_id) THEN RAISE EXCEPTION '同じ時間帯に確定済みの勤務があります。'; END IF;
    IF NOT EXISTS (SELECT 1 FROM worker_availability_slots WHERE scout_request_id = p_scout_id) THEN
      INSERT INTO worker_availability_slots(worker_id, slot_type, status, work_date, start_time, end_time, store_name, company_name, store_id, scout_request_id, hourly_wage, reviewed_at)
      VALUES (p_worker_id, 'available', 'assigned', v_scout.preferred_work_date, v_scout.preferred_start_time, v_scout.preferred_end_time, v_scout.store_name, v_scout.company_name, v_scout.store_id, p_scout_id, v_scout.offered_hourly_wage, now());
    END IF;
  END IF;
  UPDATE scout_requests SET status = p_status WHERE id = p_scout_id;
  RETURN p_status;
END $$;

-- 店舗の新規登録：ログイン中のユーザーを店舗のオーナーにする。1つのログインで1店舗まで。
DROP FUNCTION public.create_scouting_store(TEXT, TEXT, TEXT, INTEGER, TEXT);
CREATE FUNCTION public.create_scouting_store(p_company_name TEXT, p_store_name TEXT, p_area TEXT, p_hourly_wage INTEGER,
  p_terms_version TEXT, p_terms_agreed_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company UUID; v_store UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください。' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM stores WHERE owner_user_id = auth.uid()) THEN RAISE EXCEPTION 'このアカウントでは、すでに店舗を登録しています。'; END IF;
  IF char_length(btrim(p_company_name)) NOT BETWEEN 1 AND 100 OR char_length(btrim(p_store_name)) NOT BETWEEN 1 AND 100
    OR char_length(btrim(p_area)) NOT BETWEEN 1 AND 100 OR p_hourly_wage NOT BETWEEN 1 AND 999999
    OR p_company_name IS NULL OR p_store_name IS NULL OR p_area IS NULL OR p_hourly_wage IS NULL THEN
    RAISE EXCEPTION '店舗名・企業名・エリア・時給を確認してください。';
  END IF;
  IF p_terms_version IS NULL OR char_length(btrim(p_terms_version)) NOT BETWEEN 1 AND 100
    OR p_terms_agreed_at IS NULL OR p_terms_agreed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION '利用規約とプライバシーポリシーへの同意を確認してください。';
  END IF;
  INSERT INTO companies(name) VALUES (btrim(p_company_name)) RETURNING id INTO v_company;
  INSERT INTO stores(company_id, name, area, hourly_wage, owner_user_id, terms_version, terms_agreed_at)
  VALUES (v_company, btrim(p_store_name), btrim(p_area), p_hourly_wage, auth.uid(), btrim(p_terms_version), p_terms_agreed_at)
  RETURNING id INTO v_store;
  RETURN v_store;
END $$;

REVOKE EXECUTE ON FUNCTION public.respond_to_scout(UUID, UUID, TEXT) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_scouting_store(TEXT, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_scout(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_scouting_store(TEXT, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. 身分証の画像（Storage）：本人は自分のフォルダへの提出だけ、閲覧は審査担当（aal2）だけ
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "identity_documents_demo_insert" ON storage.objects;
DROP POLICY IF EXISTS "identity_documents_demo_select" ON storage.objects;
CREATE POLICY identity_documents_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'identity-documents' AND (storage.foldername(name))[1] = public.current_worker_id()::text);
CREATE POLICY identity_documents_select_reviewer ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'identity-documents' AND public.is_identity_reviewer());

COMMIT;
