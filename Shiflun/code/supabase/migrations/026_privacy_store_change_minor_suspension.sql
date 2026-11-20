-- Shiflun: 本人専用情報の分離・所属店舗の変更・18歳未満の夜間規制・利用停止
-- 025 適用後に実行する。
--
--   1. 本人専用情報の分離：親権者の氏名・同意日時と、規約の同意記録を workers から worker_private に移す。
--      workers は、スカウトのために全店舗が読める。この3種類の情報は本人しか読めないテーブルに置く。
--      「18歳未満かどうか（is_minor）」だけは、深夜勤務の規制を店舗が確認できるよう workers に残す。
--   2. ワーカーの登録は、register_worker だけで行う（workers と worker_private を同時に作る）。
--   3. 所属店舗の変更（change_my_store）：7日に1回まで。変更すると店長認証は外れ、旧店舗向けの勤務希望は取り消す。
--   4. 18歳未満の夜間規制（労働基準法第61条）：午後10時から翌午前5時にかかるスカウトと勤務希望を、DBで止める。
--   5. 利用停止：審査担当（2段階認証済み）が、ログインを止める。Supabase Auth の banned_until を使うので、
--      service role key は要らない。
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. 本人専用情報の分離
-- ---------------------------------------------------------------------------
CREATE TABLE public.worker_private (
  worker_id UUID PRIMARY KEY REFERENCES public.workers (id) ON DELETE CASCADE,
  guardian_name TEXT CHECK (guardian_name IS NULL OR btrim(guardian_name) <> ''),
  guardian_consented_at TIMESTAMPTZ,
  terms_version TEXT,
  terms_agreed_at TIMESTAMPTZ,
  CONSTRAINT worker_private_guardian_check CHECK ((guardian_name IS NULL) = (guardian_consented_at IS NULL)),
  CONSTRAINT worker_private_terms_check CHECK ((terms_version IS NULL) = (terms_agreed_at IS NULL))
);

INSERT INTO public.worker_private (worker_id, guardian_name, guardian_consented_at, terms_version, terms_agreed_at)
SELECT id, guardian_name, guardian_consented_at, terms_version, terms_agreed_at FROM public.workers;

-- 列を消すと、その列を使っていた制約（chk_workers_guardian_consent / workers_terms_consent_check）も一緒に消える。
ALTER TABLE public.workers
  DROP COLUMN guardian_name,
  DROP COLUMN guardian_consented_at,
  DROP COLUMN terms_version,
  DROP COLUMN terms_agreed_at;

-- 18歳未満のワーカーは、親権者の氏名の記録が必須（以前は workers の制約だった）。
CREATE FUNCTION public.check_worker_private() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.guardian_name IS NULL AND EXISTS (SELECT 1 FROM workers WHERE id = NEW.worker_id AND is_minor) THEN
    RAISE EXCEPTION '18歳未満の方は、親権者の氏名と同意の記録が必要です。';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_worker_private BEFORE INSERT OR UPDATE ON public.worker_private
  FOR EACH ROW EXECUTE FUNCTION public.check_worker_private();

-- 本人だけが読める。書き換えられるのは規約の同意記録だけ（親権者の記録は登録時のまま）。作成は register_worker だけ。
ALTER TABLE public.worker_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worker_private FROM anon, authenticated;
GRANT SELECT ON public.worker_private TO authenticated;
GRANT UPDATE (terms_version, terms_agreed_at) ON public.worker_private TO authenticated;
CREATE POLICY worker_private_select ON public.worker_private FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id());
CREATE POLICY worker_private_update ON public.worker_private FOR UPDATE TO authenticated
  USING (worker_id = public.current_worker_id()) WITH CHECK (worker_id = public.current_worker_id());

-- ---------------------------------------------------------------------------
-- 2. ワーカーの登録（workers と worker_private を同時に作る）
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.workers FROM authenticated;
DROP POLICY workers_insert_self ON public.workers;

CREATE FUNCTION public.register_worker(
  p_name TEXT, p_store_id UUID, p_business_type TEXT, p_skill_tags TEXT[], p_experience_years NUMERIC,
  p_bio TEXT, p_is_minor BOOLEAN, p_guardian_name TEXT, p_terms_version TEXT, p_terms_agreed_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store stores%ROWTYPE; v_id UUID; v_guardian TEXT := nullif(btrim(coalesce(p_guardian_name, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください。' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM workers WHERE user_id = auth.uid()) THEN RAISE EXCEPTION 'このアカウントは登録済みです。'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '名前を100文字以内で入力してください。'; END IF;
  IF p_is_minor IS NULL OR (p_is_minor AND v_guardian IS NULL) THEN RAISE EXCEPTION '親権者の氏名の入力と同意へのチェックが必要です。'; END IF;
  IF p_terms_version IS NULL OR char_length(btrim(p_terms_version)) NOT BETWEEN 1 AND 100
    OR p_terms_agreed_at IS NULL OR p_terms_agreed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION '利用規約とプライバシーポリシーへの同意を確認してください。';
  END IF;
  SELECT * INTO v_store FROM stores WHERE id = p_store_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '店舗が見つかりません。候補の中から選び直してください。'; END IF;
  INSERT INTO workers(user_id, name, current_store, current_store_id, business_type, skill_tags, experience_years, bio, verification_status, is_minor)
  VALUES (auth.uid(), btrim(p_name), v_store.name, v_store.id, p_business_type, coalesce(p_skill_tags, '{}'), p_experience_years,
    nullif(btrim(coalesce(p_bio, '')), ''), 'unverified', p_is_minor)
  RETURNING id INTO v_id;
  INSERT INTO worker_private(worker_id, guardian_name, guardian_consented_at, terms_version, terms_agreed_at)
  VALUES (v_id, CASE WHEN p_is_minor THEN v_guardian END, CASE WHEN p_is_minor THEN now() END, btrim(p_terms_version), p_terms_agreed_at);
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 3. 利用停止の列（以降の関数が使うので、先に作る）
-- ---------------------------------------------------------------------------
ALTER TABLE public.workers ADD COLUMN suspended_at TIMESTAMPTZ;
ALTER TABLE public.stores ADD COLUMN suspended_at TIMESTAMPTZ;
ALTER TABLE public.workers ADD COLUMN store_changed_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 4. 所属店舗の変更
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.change_my_store(p_store_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_worker workers%ROWTYPE; v_store stores%ROWTYPE; v_days INTEGER;
  v_today DATE := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください。' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_worker FROM workers WHERE user_id = auth.uid() AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'プロフィールが見つかりません。'; END IF;
  SELECT * INTO v_store FROM stores WHERE id = p_store_id AND deleted_at IS NULL AND suspended_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '店舗が見つかりません。候補の中から選び直してください。'; END IF;
  IF v_worker.current_store_id IS NOT DISTINCT FROM v_store.id THEN RAISE EXCEPTION 'すでにこの店舗に所属しています。'; END IF;
  IF v_worker.store_changed_at IS NOT NULL AND v_worker.store_changed_at > now() - interval '7 days' THEN
    v_days := ceil(extract(epoch FROM (v_worker.store_changed_at + interval '7 days' - now())) / 86400)::int;
    RAISE EXCEPTION '所属店舗の変更は7日に1回までです。あと%日後に変更できます。', v_days;
  END IF;
  -- 今の所属先で確定している、これからの勤務がある間は変えられない（店長に黙って抜けるのを防ぐ）。
  IF EXISTS (SELECT 1 FROM worker_availability_slots WHERE worker_id = v_worker.id AND scout_request_id IS NULL
    AND status = 'assigned' AND work_date >= v_today) THEN
    RAISE EXCEPTION '今の所属店舗で確定している勤務があります。店長に相談して、勤務が終わってから変更してください。';
  END IF;

  -- 旧店舗に出していた勤務希望・他店への公開は取り消す（新しい店舗に引き継がない）。出勤の記録（attended）とスカウト経由の勤務は残す。
  DELETE FROM worker_availability_slots WHERE worker_id = v_worker.id AND scout_request_id IS NULL AND status IN ('pending', 'released', 'assigned');
  -- 店長認証は、前の店舗の店長が「ここで働いている」と確認したもの。新しい店舗で認証し直す（認証の記録は残る）。
  UPDATE workers SET current_store_id = v_store.id, current_store = v_store.name, verification_status = 'unverified', store_changed_at = now()
  WHERE id = v_worker.id;
  -- 登録のときと同じ、自己申告の記録（新しい店舗の「最近自己申告した人」に出る）。
  INSERT INTO store_join_requests(worker_id, store_id, worker_name, store_name, skill_tags, message, experience_years, bio, status)
  VALUES (v_worker.id, v_store.id, v_worker.name, v_store.name, v_worker.skill_tags, NULL, v_worker.experience_years, v_worker.bio, 'approved');
  RETURN v_store.id;
END $$;

-- ---------------------------------------------------------------------------
-- 5. 18歳未満の夜間規制（午後10時から翌午前5時にかかる勤務は不可）
-- ---------------------------------------------------------------------------
-- 勤務は同日内（終了 > 開始）。終了が22:00を過ぎるか、開始が5:00より前なら、深夜の時間にかかる。
CREATE FUNCTION public.violates_minor_night_rule(p_start TIME, p_end TIME) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$ SELECT p_end > TIME '22:00' OR p_start < TIME '05:00' $$;

CREATE FUNCTION public.guard_minor_night_scout() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF violates_minor_night_rule(NEW.preferred_start_time, NEW.preferred_end_time)
    AND EXISTS (SELECT 1 FROM workers WHERE id = NEW.worker_id AND is_minor) THEN
    RAISE EXCEPTION '18歳未満のワーカーには、午後10時から翌午前5時にかかる勤務はお願いできません。';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_minor_night_scout BEFORE INSERT ON public.scout_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_minor_night_scout();

CREATE FUNCTION public.guard_minor_night_slot() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF violates_minor_night_rule(NEW.start_time, NEW.end_time)
    AND EXISTS (SELECT 1 FROM workers WHERE id = NEW.worker_id AND is_minor) THEN
    RAISE EXCEPTION '18歳未満の方は、午後10時から翌午前5時にかかる時間は登録できません。';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_minor_night_slot BEFORE INSERT ON public.worker_availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.guard_minor_night_slot();

-- ---------------------------------------------------------------------------
-- 6. 利用停止
-- ---------------------------------------------------------------------------
CREATE TABLE public.account_suspensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ログイン（auth.users）の ID。ログインが消えても記録は残すので、外部キーにはしない。
  user_id UUID NOT NULL,
  email TEXT,
  worker_id UUID REFERENCES public.workers (id) ON DELETE SET NULL,
  store_id UUID REFERENCES public.stores (id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  report_id UUID REFERENCES public.chat_reports (id) ON DELETE SET NULL,
  suspended_by TEXT NOT NULL,
  suspended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lifted_at TIMESTAMPTZ,
  lifted_by TEXT,
  lift_note TEXT CHECK (lift_note IS NULL OR char_length(lift_note) <= 1000)
);
CREATE UNIQUE INDEX uq_account_suspensions_active ON public.account_suspensions (user_id) WHERE lifted_at IS NULL;
ALTER TABLE public.account_suspensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_suspensions FROM anon, authenticated;
GRANT SELECT ON public.account_suspensions TO authenticated;
CREATE POLICY account_suspensions_select ON public.account_suspensions FOR SELECT TO authenticated USING (public.is_identity_reviewer());

-- 利用停止にする。同じログインのワーカー・店舗の両方が止まる。ログイン自体を止め（banned_until）、今のログイン状態も消す。
CREATE FUNCTION public.suspend_account(p_worker_id UUID, p_store_id UUID, p_reason TEXT, p_report_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_email TEXT; v_by TEXT; v_id UUID; v_reason TEXT := btrim(coalesce(p_reason, ''));
BEGIN
  IF NOT public.is_identity_reviewer() THEN RAISE EXCEPTION '審査担当として2段階認証でログインしてください。' USING ERRCODE = '42501'; END IF;
  IF (p_worker_id IS NULL) = (p_store_id IS NULL) THEN RAISE EXCEPTION '停止するワーカーか店舗の、どちらか一方を指定してください。'; END IF;
  IF char_length(v_reason) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION '停止の理由を1〜1000文字で入力してください。'; END IF;
  IF p_worker_id IS NOT NULL THEN SELECT user_id INTO v_uid FROM workers WHERE id = p_worker_id AND deleted_at IS NULL;
  ELSE SELECT owner_user_id INTO v_uid FROM stores WHERE id = p_store_id AND deleted_at IS NULL; END IF;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'アカウントが見つかりません。すでに退会している可能性があります。'; END IF;
  IF v_uid = auth.uid() THEN RAISE EXCEPTION '自分のアカウントは停止できません。'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND raw_app_meta_data ->> 'role' = 'identity_reviewer') THEN
    RAISE EXCEPTION '審査担当のアカウントは、この画面からは停止できません。';
  END IF;
  IF EXISTS (SELECT 1 FROM account_suspensions WHERE user_id = v_uid AND lifted_at IS NULL) THEN RAISE EXCEPTION 'すでに利用停止中です。'; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  v_by := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  UPDATE workers SET suspended_at = now() WHERE user_id = v_uid AND deleted_at IS NULL;
  UPDATE stores SET suspended_at = now() WHERE owner_user_id = v_uid AND deleted_at IS NULL;
  -- 停止した店舗の、返信待ちのスカウトは辞退扱いにする（承諾されて勤務が組まれないように）。
  UPDATE scout_requests SET status = 'rejected' WHERE status = 'pending' AND store_id IN (SELECT id FROM stores WHERE owner_user_id = v_uid);
  UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = v_uid;
  DELETE FROM auth.sessions WHERE user_id = v_uid;
  INSERT INTO account_suspensions(user_id, email, worker_id, store_id, reason, report_id, suspended_by)
  VALUES (v_uid, v_email, (SELECT id FROM workers WHERE user_id = v_uid), (SELECT id FROM stores WHERE owner_user_id = v_uid), v_reason, p_report_id, v_by)
  RETURNING id INTO v_id;
  IF p_report_id IS NOT NULL THEN
    UPDATE chat_reports SET status = 'resolved', resolved_at = now(), resolved_by = v_by, resolution_note = left('利用停止にした：' || v_reason, 1000)
    WHERE id = p_report_id AND status = 'open';
  END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION public.lift_suspension(p_suspension_id UUID, p_note TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_note TEXT := btrim(coalesce(p_note, ''));
BEGIN
  IF NOT public.is_identity_reviewer() THEN RAISE EXCEPTION '審査担当として2段階認証でログインしてください。' USING ERRCODE = '42501'; END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION '解除の理由を1〜1000文字で入力してください。'; END IF;
  SELECT user_id INTO v_uid FROM account_suspensions WHERE id = p_suspension_id AND lifted_at IS NULL FOR UPDATE;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'この利用停止はすでに解除されています。'; END IF;
  UPDATE auth.users SET banned_until = NULL WHERE id = v_uid;
  UPDATE workers SET suspended_at = NULL WHERE user_id = v_uid;
  UPDATE stores SET suspended_at = NULL WHERE owner_user_id = v_uid;
  UPDATE account_suspensions SET lifted_at = now(), lifted_by = coalesce(auth.jwt() ->> 'email', auth.uid()::text), lift_note = v_note
  WHERE id = p_suspension_id;
END $$;

-- 停止中・退会済みの相手には、メッセージもスカウトも送れない（023 の関数に、停止中の確認を足す）。
CREATE OR REPLACE FUNCTION public.guard_chat_pair(p_worker_id UUID, p_store_id UUID, p_blocked_message TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workers WHERE id = p_worker_id AND deleted_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM stores WHERE id = p_store_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION '相手が退会したため、送信できません。';
  END IF;
  IF EXISTS (SELECT 1 FROM workers WHERE id = p_worker_id AND suspended_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM stores WHERE id = p_store_id AND suspended_at IS NOT NULL) THEN
    RAISE EXCEPTION '相手のアカウントが現在ご利用いただけないため、送信できません。';
  END IF;
  IF is_chat_blocked(p_worker_id, p_store_id) THEN RAISE EXCEPTION '%', p_blocked_message; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. 退会（023 の関数を、worker_private に合わせて作り直す）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_account() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_worker UUID;
  v_store UUID;
  v_store_name TEXT;
  v_today DATE := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインしてください。' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_worker FROM workers WHERE user_id = v_uid FOR UPDATE;
  SELECT id, name INTO v_store, v_store_name FROM stores WHERE owner_user_id = v_uid FOR UPDATE;

  IF v_worker IS NOT NULL THEN
    UPDATE scout_requests r SET status = 'rejected'
    WHERE r.worker_id = v_worker
      AND (r.status = 'pending'
        OR (r.status = 'accepted' AND r.preferred_work_date >= v_today
          AND NOT EXISTS (SELECT 1 FROM worker_availability_slots s WHERE s.scout_request_id = r.id AND s.status = 'attended')));
    DELETE FROM worker_availability_slots WHERE worker_id = v_worker AND status <> 'attended';
    IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'identity-documents' AND (storage.foldername(name))[1] = v_worker::text) THEN
      INSERT INTO identity_document_purges(folder) VALUES (v_worker::text);
    END IF;
    DELETE FROM identity_verifications WHERE worker_id = v_worker;
    DELETE FROM manager_verifications WHERE worker_id = v_worker;
    DELETE FROM store_join_requests WHERE worker_id = v_worker;
    DELETE FROM app_notifications WHERE recipient_worker_id = v_worker;
    DELETE FROM chat_blocks WHERE worker_id = v_worker;
    DELETE FROM worker_private WHERE worker_id = v_worker;
    UPDATE workers SET
      user_id = NULL, deleted_at = now(), name = '退会済みユーザー',
      current_store = '', current_store_id = NULL, business_type = '', job_type = NULL, experience_years = 0,
      skills = NULL, bio = NULL, skill_tags = '{}', preferred_areas = '{}', verification_status = 'unverified',
      is_minor = false, store_changed_at = NULL
    WHERE id = v_worker;
  END IF;

  IF v_store IS NOT NULL THEN
    INSERT INTO app_notifications(recipient_worker_id, scout_id, kind, title, body)
    SELECT r.worker_id, r.id, 'scout_rejected', '勤務予定が取り消されました', v_store_name || 'が退会したため、この勤務はなくなりました。'
    FROM scout_requests r
    WHERE r.store_id = v_store AND r.status = 'accepted' AND r.preferred_work_date >= v_today
      AND NOT EXISTS (SELECT 1 FROM worker_availability_slots s WHERE s.scout_request_id = r.id AND s.status = 'attended');
    DELETE FROM worker_availability_slots s USING scout_requests r
    WHERE s.scout_request_id = r.id AND r.store_id = v_store AND s.status <> 'attended';
    UPDATE scout_requests r SET status = 'rejected'
    WHERE r.store_id = v_store AND r.status = 'accepted' AND r.preferred_work_date >= v_today
      AND NOT EXISTS (SELECT 1 FROM worker_availability_slots s WHERE s.scout_request_id = r.id AND s.status = 'attended');
    DELETE FROM scout_requests WHERE store_id = v_store AND status = 'pending';
    DELETE FROM worker_flags WHERE store_id = v_store;
    DELETE FROM store_join_requests WHERE store_id = v_store;
    DELETE FROM app_notifications WHERE recipient_store_id = v_store;
    DELETE FROM chat_blocks WHERE store_id = v_store;
    UPDATE stores SET owner_user_id = NULL, deleted_at = now() WHERE id = v_store;
  END IF;

  DELETE FROM auth.users WHERE id = v_uid;
END $$;

-- ---------------------------------------------------------------------------
-- 8. 関数を呼べる範囲
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.check_worker_private(), public.register_worker(TEXT, UUID, TEXT, TEXT[], NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ),
  public.change_my_store(UUID), public.violates_minor_night_rule(TIME, TIME), public.guard_minor_night_scout(), public.guard_minor_night_slot(),
  public.suspend_account(UUID, UUID, TEXT, UUID), public.lift_suspension(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_worker(TEXT, UUID, TEXT, TEXT[], NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ),
  public.change_my_store(UUID), public.suspend_account(UUID, UUID, TEXT, UUID), public.lift_suspension(UUID, TEXT) TO authenticated;
-- 夜間規制の判定は、画面側（authenticated）からも同じ式で確かめられるようにしておく。
GRANT EXECUTE ON FUNCTION public.violates_minor_night_rule(TIME, TIME) TO authenticated;

COMMIT;
