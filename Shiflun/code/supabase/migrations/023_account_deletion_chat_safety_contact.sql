-- Shiflun: 退会（アカウント削除）・チャットの通報とブロック・お問い合わせ
-- 022 適用後に実行する。App Store / Google Play の審査で求められる機能のためのもの。
--
--   * 退会：ログイン情報とプロフィールを消す。勤怠・支払いの記録とチャットの履歴は相手の店舗側に残し、
--     名前を「退会済みユーザー」に置き換える（利用規約第15条）。身分証の画像は、審査担当が /admin で削除する。
--   * ブロック：ワーカーと店舗の組み合わせごと。どちらかがブロックすると、メッセージとスカウトを送れなくなる。
--   * 通報：チャットの相手・メッセージを運営に通報する。審査担当が /admin/reports で確認する。
--   * お問い合わせ：ログインしていなくても送れる。審査担当が /admin/inquiries で確認する。
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. 退会
-- ---------------------------------------------------------------------------
ALTER TABLE public.workers ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE public.stores ADD COLUMN deleted_at TIMESTAMPTZ;
-- 退会した行はログインと結びつかない。それ以外は、これまでどおりログインとの結びつきが必須。
ALTER TABLE public.workers ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.stores ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE public.workers ADD CONSTRAINT workers_login_or_deleted CHECK (user_id IS NOT NULL OR deleted_at IS NOT NULL);
ALTER TABLE public.stores ADD CONSTRAINT stores_owner_or_deleted CHECK (owner_user_id IS NOT NULL OR deleted_at IS NOT NULL);

-- 退会した店舗を、所属先として登録・変更できないようにする（店舗の候補一覧からも外している）。
CREATE FUNCTION public.guard_worker_store() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_store_id IS NOT NULL AND EXISTS (SELECT 1 FROM stores WHERE id = NEW.current_store_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION '店舗が見つかりません。候補の中から選び直してください。';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_worker_store BEFORE INSERT OR UPDATE OF current_store_id ON public.workers
  FOR EACH ROW EXECUTE FUNCTION public.guard_worker_store();

-- 退会したワーカーの身分証画像（Storage）の削除待ち。本人は自分の画像を読めない作りのため、
-- 削除は審査担当が Storage API で行う（SQL から storage.objects を直接消すと実ファイルが残る）。
CREATE TABLE public.identity_document_purges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  purged_at TIMESTAMPTZ,
  purged_by TEXT
);
CREATE INDEX idx_identity_document_purges_pending ON public.identity_document_purges (requested_at) WHERE purged_at IS NULL;
ALTER TABLE public.identity_document_purges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_document_purges FROM anon, authenticated;
GRANT SELECT ON public.identity_document_purges TO authenticated;
GRANT UPDATE (purged_at, purged_by) ON public.identity_document_purges TO authenticated;
CREATE POLICY identity_purges_select ON public.identity_document_purges FOR SELECT TO authenticated
  USING (public.is_identity_reviewer());
CREATE POLICY identity_purges_update ON public.identity_document_purges FOR UPDATE TO authenticated
  USING (public.is_identity_reviewer()) WITH CHECK (public.is_identity_reviewer());
CREATE POLICY identity_documents_delete_reviewer ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'identity-documents' AND public.is_identity_reviewer());

-- ログイン中の本人のアカウントを削除する。ワーカーと店舗の両方を登録していれば、両方とも退会する。
CREATE FUNCTION public.delete_my_account() RETURNS VOID
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
    -- 返信していないスカウトと、まだ働いていないこれからの勤務は「辞退」にして、店舗へ知らせる（通知はトリガーが作る）。
    UPDATE scout_requests r SET status = 'rejected'
    WHERE r.worker_id = v_worker
      AND (r.status = 'pending'
        OR (r.status = 'accepted' AND r.preferred_work_date >= v_today
          AND NOT EXISTS (SELECT 1 FROM worker_availability_slots s WHERE s.scout_request_id = r.id AND s.status = 'attended')));
    -- 出勤の記録（attended）と、それに結びつく支払いの記録は残す。それ以外の勤務希望・予定は消す。
    DELETE FROM worker_availability_slots WHERE worker_id = v_worker AND status <> 'attended';
    IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'identity-documents' AND (storage.foldername(name))[1] = v_worker::text) THEN
      INSERT INTO identity_document_purges(folder) VALUES (v_worker::text);
    END IF;
    DELETE FROM identity_verifications WHERE worker_id = v_worker;
    DELETE FROM manager_verifications WHERE worker_id = v_worker;
    DELETE FROM store_join_requests WHERE worker_id = v_worker;
    DELETE FROM app_notifications WHERE recipient_worker_id = v_worker;
    DELETE FROM chat_blocks WHERE worker_id = v_worker;
    UPDATE workers SET
      user_id = NULL, deleted_at = now(), name = '退会済みユーザー',
      current_store = '', current_store_id = NULL, business_type = '', job_type = NULL, experience_years = 0,
      skills = NULL, bio = NULL, skill_tags = '{}', preferred_areas = '{}', verification_status = 'unverified',
      is_minor = false, guardian_name = NULL, guardian_consented_at = NULL, terms_version = NULL, terms_agreed_at = NULL
    WHERE id = v_worker;
  END IF;

  IF v_store IS NOT NULL THEN
    -- これからの勤務（承諾済みでまだ働いていないもの）は取り消して、ワーカーへ知らせる。
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
    -- まだ返信のないスカウトは取り下げる。
    DELETE FROM scout_requests WHERE store_id = v_store AND status = 'pending';
    DELETE FROM worker_flags WHERE store_id = v_store;
    DELETE FROM store_join_requests WHERE store_id = v_store;
    DELETE FROM app_notifications WHERE recipient_store_id = v_store;
    DELETE FROM chat_blocks WHERE store_id = v_store;
    -- 店舗名は、ワーカー側に残る勤怠・支払いの記録に必要なので残す。未払いの支払い記録もそのまま残る（利用規約第15条3項）。
    UPDATE stores SET owner_user_id = NULL, deleted_at = now() WHERE id = v_store;
  END IF;

  DELETE FROM auth.users WHERE id = v_uid;
END $$;

-- ---------------------------------------------------------------------------
-- 2. ブロック（ワーカーと店舗の組み合わせごと）
-- ---------------------------------------------------------------------------
CREATE TABLE public.chat_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES public.workers (id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  blocked_by TEXT NOT NULL CHECK (blocked_by IN ('worker', 'store')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, store_id, blocked_by)
);
CREATE INDEX idx_chat_blocks_store ON public.chat_blocks (store_id);
ALTER TABLE public.chat_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_blocks FROM anon, authenticated;
-- 読める・作れる・解除できるのは、自分がしたブロックだけ（相手にブロックされているかどうかは読めない）。
GRANT SELECT, INSERT, DELETE ON public.chat_blocks TO authenticated;
CREATE POLICY chat_blocks_select ON public.chat_blocks FOR SELECT TO authenticated
  USING ((blocked_by = 'worker' AND worker_id = public.current_worker_id()) OR (blocked_by = 'store' AND public.owns_store(store_id)));
CREATE POLICY chat_blocks_insert ON public.chat_blocks FOR INSERT TO authenticated
  WITH CHECK ((blocked_by = 'worker' AND worker_id = public.current_worker_id()) OR (blocked_by = 'store' AND public.owns_store(store_id)));
CREATE POLICY chat_blocks_delete ON public.chat_blocks FOR DELETE TO authenticated
  USING ((blocked_by = 'worker' AND worker_id = public.current_worker_id()) OR (blocked_by = 'store' AND public.owns_store(store_id)));

-- どちらかがブロックしているか。
CREATE FUNCTION public.is_chat_blocked(p_worker_id UUID, p_store_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM chat_blocks WHERE worker_id = p_worker_id AND store_id = p_store_id)
$$;

-- 自店とブロック関係にあるワーカー（どちら側からのブロックでも）。人材検索の結果から外すために使う。
CREATE FUNCTION public.my_blocked_worker_ids() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT worker_id FROM chat_blocks WHERE store_id = current_store_id()
$$;

-- メッセージとスカウトは、ブロック中・退会済みの相手には送れない。
CREATE FUNCTION public.guard_chat_pair(p_worker_id UUID, p_store_id UUID, p_blocked_message TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workers WHERE id = p_worker_id AND deleted_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM stores WHERE id = p_store_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION '相手が退会したため、送信できません。';
  END IF;
  IF is_chat_blocked(p_worker_id, p_store_id) THEN RAISE EXCEPTION '%', p_blocked_message; END IF;
END $$;

CREATE FUNCTION public.guard_scout_message() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_worker UUID; v_store UUID;
BEGIN
  SELECT worker_id, store_id INTO v_worker, v_store FROM scout_requests WHERE id = NEW.scout_id;
  PERFORM guard_chat_pair(v_worker, v_store, 'この相手とはメッセージを送受信できません。');
  RETURN NEW;
END $$;
CREATE TRIGGER guard_scout_message BEFORE INSERT ON public.scout_messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_scout_message();

CREATE FUNCTION public.guard_staff_message() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM guard_chat_pair(NEW.worker_id, NEW.store_id, 'この相手とはメッセージを送受信できません。');
  RETURN NEW;
END $$;
CREATE TRIGGER guard_staff_message BEFORE INSERT ON public.staff_messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_message();

CREATE FUNCTION public.guard_scout_request() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM guard_chat_pair(NEW.worker_id, NEW.store_id, 'このワーカーにはスカウトを送れません。');
  RETURN NEW;
END $$;
CREATE TRIGGER guard_scout_request BEFORE INSERT ON public.scout_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_scout_request();

-- ---------------------------------------------------------------------------
-- 3. チャットの通報
-- ---------------------------------------------------------------------------
CREATE TABLE public.chat_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_role TEXT NOT NULL CHECK (reporter_role IN ('worker', 'store')),
  worker_id UUID NOT NULL REFERENCES public.workers (id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('scout', 'staff')),
  scout_id UUID REFERENCES public.scout_requests (id) ON DELETE SET NULL,
  -- 通報されたメッセージ。本文は通報時点の写しを残す（元のメッセージが消えても確認できるように）。
  message_id UUID,
  message_body TEXT,
  message_sent_at TIMESTAMPTZ,
  reason TEXT NOT NULL CHECK (reason IN ('harassment', 'inappropriate', 'spam', 'fraud', 'other')),
  detail TEXT CHECK (detail IS NULL OR char_length(detail) <= 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution_note TEXT CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_reports_status ON public.chat_reports (status, created_at);
ALTER TABLE public.chat_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_reports FROM anon, authenticated;
-- 作成は report_chat だけ。読める・対応できるのは審査担当だけ。
GRANT SELECT ON public.chat_reports TO authenticated;
GRANT UPDATE (status, resolution_note, resolved_at, resolved_by) ON public.chat_reports TO authenticated;
CREATE POLICY chat_reports_select ON public.chat_reports FOR SELECT TO authenticated USING (public.is_identity_reviewer());
CREATE POLICY chat_reports_update ON public.chat_reports FOR UPDATE TO authenticated
  USING (public.is_identity_reviewer()) WITH CHECK (public.is_identity_reviewer());

-- 会話の当事者だけが通報できる。メッセージの本文は、利用者の入力ではなくデータベースから写す。
CREATE FUNCTION public.report_chat(p_reporter_role TEXT, p_kind TEXT, p_scout_id UUID, p_worker_id UUID, p_store_id UUID,
  p_message_id UUID, p_reason TEXT, p_detail TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_body TEXT; v_sent TIMESTAMPTZ; v_sender TEXT; v_id UUID; v_detail TEXT := nullif(btrim(coalesce(p_detail, '')), '');
BEGIN
  IF p_reporter_role = 'worker' AND p_worker_id IS NOT DISTINCT FROM current_worker_id() THEN NULL;
  ELSIF p_reporter_role = 'store' AND owns_store(p_store_id) THEN NULL;
  ELSE RAISE EXCEPTION '会話の参加者を確認してください。' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('harassment', 'inappropriate', 'spam', 'fraud', 'other') THEN RAISE EXCEPTION '通報の理由を選んでください。'; END IF;
  IF char_length(coalesce(v_detail, '')) > 1000 THEN RAISE EXCEPTION '詳細は1000文字以内で入力してください。'; END IF;

  IF p_kind = 'scout' THEN
    PERFORM 1 FROM scout_requests WHERE id = p_scout_id AND worker_id = p_worker_id AND store_id = p_store_id;
    IF NOT FOUND THEN RAISE EXCEPTION '会話の参加者を確認してください。' USING ERRCODE = '42501'; END IF;
    IF p_message_id IS NOT NULL THEN
      SELECT body, created_at, sender_role INTO v_body, v_sent, v_sender FROM scout_messages WHERE id = p_message_id AND scout_id = p_scout_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'メッセージが見つかりません。'; END IF;
    END IF;
  ELSIF p_kind = 'staff' THEN
    IF NOT EXISTS (SELECT 1 FROM workers WHERE id = p_worker_id AND current_store_id = p_store_id)
      AND NOT EXISTS (SELECT 1 FROM staff_messages WHERE worker_id = p_worker_id AND store_id = p_store_id) THEN
      RAISE EXCEPTION '会話の参加者を確認してください。' USING ERRCODE = '42501';
    END IF;
    IF p_message_id IS NOT NULL THEN
      SELECT body, created_at, sender_role INTO v_body, v_sent, v_sender FROM staff_messages WHERE id = p_message_id AND worker_id = p_worker_id AND store_id = p_store_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'メッセージが見つかりません。'; END IF;
    END IF;
  ELSE RAISE EXCEPTION '会話の種類が不正です。';
  END IF;
  IF v_sender = p_reporter_role THEN RAISE EXCEPTION '自分のメッセージは通報できません。'; END IF;

  -- いたずらの大量送信を防ぐ。
  IF (SELECT count(*) FROM chat_reports WHERE reporter_role = p_reporter_role AND worker_id = p_worker_id AND store_id = p_store_id
      AND created_at > now() - interval '1 day') >= 20 THEN
    RAISE EXCEPTION '通報の回数が上限に達しました。時間をおいてお試しください。';
  END IF;

  INSERT INTO chat_reports(reporter_role, worker_id, store_id, kind, scout_id, message_id, message_body, message_sent_at, reason, detail)
  VALUES (p_reporter_role, p_worker_id, p_store_id, p_kind, CASE WHEN p_kind = 'scout' THEN p_scout_id END, p_message_id, v_body, v_sent, p_reason, v_detail)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 4. お問い合わせ
-- ---------------------------------------------------------------------------
CREATE TABLE public.contact_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  category TEXT NOT NULL CHECK (category IN ('account', 'deletion', 'report', 'bug', 'other')),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution_note TEXT CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contact_inquiries_status ON public.contact_inquiries (status, created_at);
CREATE INDEX idx_contact_inquiries_email ON public.contact_inquiries (email, created_at);
ALTER TABLE public.contact_inquiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_inquiries FROM anon, authenticated;
-- 作成は submit_contact_inquiry だけ。読める・対応できるのは審査担当だけ。
GRANT SELECT ON public.contact_inquiries TO authenticated;
GRANT UPDATE (status, resolution_note, resolved_at, resolved_by) ON public.contact_inquiries TO authenticated;
CREATE POLICY contact_inquiries_select ON public.contact_inquiries FOR SELECT TO authenticated USING (public.is_identity_reviewer());
CREATE POLICY contact_inquiries_update ON public.contact_inquiries FOR UPDATE TO authenticated
  USING (public.is_identity_reviewer()) WITH CHECK (public.is_identity_reviewer());

-- ログインできない人も問い合わせられるよう、ログインなし（anon）でも呼べる。送りすぎは回数で止める。
CREATE FUNCTION public.submit_contact_inquiry(p_email TEXT, p_category TEXT, p_body TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email TEXT := lower(btrim(coalesce(p_email, ''))); v_body TEXT := btrim(coalesce(p_body, '')); v_id UUID;
BEGIN
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(v_email) > 254 THEN RAISE EXCEPTION 'メールアドレスを確認してください。'; END IF;
  IF p_category IS NULL OR p_category NOT IN ('account', 'deletion', 'report', 'bug', 'other') THEN RAISE EXCEPTION 'お問い合わせの種類を選んでください。'; END IF;
  IF char_length(v_body) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'お問い合わせの内容は1〜2000文字で入力してください。'; END IF;
  IF (SELECT count(*) FROM contact_inquiries WHERE email = v_email AND created_at > now() - interval '1 day') >= 5
    OR (SELECT count(*) FROM contact_inquiries WHERE created_at > now() - interval '1 hour') >= 200 THEN
    RAISE EXCEPTION '送信が集中しています。時間をおいてお試しください。';
  END IF;
  INSERT INTO contact_inquiries(user_id, email, category, body) VALUES (auth.uid(), v_email, p_category, v_body) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 5. 関数を呼べる範囲
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.delete_my_account(), public.guard_worker_store(), public.is_chat_blocked(UUID, UUID), public.my_blocked_worker_ids(),
  public.guard_chat_pair(UUID, UUID, TEXT), public.guard_scout_message(), public.guard_staff_message(), public.guard_scout_request(),
  public.report_chat(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT), public.submit_contact_inquiry(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_account(), public.my_blocked_worker_ids(),
  public.report_chat(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_contact_inquiry(TEXT, TEXT, TEXT) TO anon, authenticated;

COMMIT;
