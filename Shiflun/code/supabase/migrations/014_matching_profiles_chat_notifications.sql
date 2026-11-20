-- Shiflun: 店舗の提示額 / プロフィール / 勤務実績 / 承諾後チャット / アプリ内通知
-- 001〜013（009欠番）適用後に実行。既存データ・旧カラムは保持する。
-- Auth / RLS は既存デモ方針を維持。actor_id は認証の代替ではない。
BEGIN;

ALTER TABLE public.workers ADD COLUMN preferred_areas TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.stores ADD COLUMN hourly_wage NUMERIC(6,0) CHECK (hourly_wage > 0);
ALTER TABLE public.stores ADD COLUMN area TEXT;
ALTER TABLE public.scout_requests ADD COLUMN break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0);
ALTER TABLE public.scout_requests ADD COLUMN work_minutes INTEGER CHECK (work_minutes > 0);
ALTER TABLE public.scout_requests ADD COLUMN offered_total_yen NUMERIC(12,0) CHECK (offered_total_yen >= 0);
ALTER TABLE public.scout_requests ADD COLUMN service_fee_percent NUMERIC(5,2);
ALTER TABLE public.scout_requests ADD COLUMN service_fee_yen NUMERIC(12,0) CHECK (service_fee_yen >= 0);
ALTER TABLE public.scout_requests ADD COLUMN store_total_yen NUMERIC(12,0) CHECK (store_total_yen >= 0);

CREATE INDEX idx_workers_preferred_areas ON public.workers USING GIN (preferred_areas);
CREATE INDEX idx_scout_requests_store_status ON public.scout_requests (store_id, status, created_at DESC);

CREATE TABLE public.scout_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  scout_id UUID NOT NULL REFERENCES public.scout_requests(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('worker', 'store')),
  sender_id UUID NOT NULL,
  client_message_id UUID NOT NULL,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scout_id, sender_role, client_message_id)
);
CREATE INDEX idx_scout_messages_conversation ON public.scout_messages (scout_id, sequence DESC);

CREATE TABLE public.app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
  recipient_store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  scout_id UUID NOT NULL REFERENCES public.scout_requests(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.scout_messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('scout_received', 'scout_accepted', 'scout_rejected', 'message')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((recipient_worker_id IS NOT NULL) <> (recipient_store_id IS NOT NULL))
);
CREATE INDEX idx_notifications_worker ON public.app_notifications (recipient_worker_id, created_at DESC);
CREATE INDEX idx_notifications_store ON public.app_notifications (recipient_store_id, created_at DESC);

-- 出勤記録のあるスカウト勤務を数える。同一スカウトに旧重複勤務枠があっても1回。
CREATE VIEW public.worker_scout_stats WITH (security_invoker = true) AS
SELECT w.id AS worker_id,
  count(DISTINCT s.scout_request_id)::integer AS completed_scout_count
FROM public.workers w
LEFT JOIN public.worker_availability_slots s ON s.worker_id = w.id
  AND s.status = 'attended' AND s.work_date <= (now() AT TIME ZONE 'Asia/Tokyo')::date
  AND EXISTS (SELECT 1 FROM public.scout_requests r WHERE r.id = s.scout_request_id AND r.worker_id = w.id AND r.status = 'accepted')
GROUP BY w.id;

-- 企業と店舗の作成を一度に保存。店舗選択後の時給変更は既存の提示額を変えない。
CREATE FUNCTION public.create_scouting_store(p_company_name TEXT, p_store_name TEXT, p_area TEXT, p_hourly_wage INTEGER)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_company UUID; v_store UUID;
BEGIN
  IF char_length(btrim(p_company_name)) NOT BETWEEN 1 AND 100 OR char_length(btrim(p_store_name)) NOT BETWEEN 1 AND 100
    OR char_length(btrim(p_area)) NOT BETWEEN 1 AND 100 OR p_hourly_wage NOT BETWEEN 1 AND 999999
    OR p_company_name IS NULL OR p_store_name IS NULL OR p_area IS NULL OR p_hourly_wage IS NULL THEN
    RAISE EXCEPTION '店舗名・企業名・エリア・時給を確認してください。';
  END IF;
  INSERT INTO companies(name) VALUES (btrim(p_company_name)) RETURNING id INTO v_company;
  INSERT INTO stores(company_id, name, area, hourly_wage) VALUES (v_company, btrim(p_store_name), btrim(p_area), p_hourly_wage) RETURNING id INTO v_store;
  RETURN v_store;
END $$;

-- 新規スカウトの店舗・時給はDBの設定を採用し、送信時点の金額を保存する。
CREATE FUNCTION public.prepare_scout_offer() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_store stores%ROWTYPE; v_minutes INTEGER;
BEGIN
  SELECT * INTO v_store FROM stores WHERE id = NEW.store_id FOR SHARE;
  IF NOT FOUND OR v_store.hourly_wage IS NULL THEN RAISE EXCEPTION '店舗と時給を設定してください。'; END IF;
  IF NEW.offered_hourly_wage IS DISTINCT FROM v_store.hourly_wage THEN RAISE EXCEPTION '店舗の時給が変更されました。画面を更新して提示額をご確認ください。'; END IF;
  IF NEW.preferred_work_date IS NULL OR NEW.preferred_work_date < (now() AT TIME ZONE 'Asia/Tokyo')::date
    OR NEW.preferred_start_time IS NULL OR NEW.preferred_end_time IS NULL OR NEW.preferred_end_time <= NEW.preferred_start_time
    OR extract(second FROM NEW.preferred_start_time) <> 0 OR extract(second FROM NEW.preferred_end_time) <> 0 THEN
    RAISE EXCEPTION '勤務日と同日内の開始・終了時刻を確認してください。';
  END IF;
  v_minutes := extract(epoch FROM (NEW.preferred_end_time - NEW.preferred_start_time))::integer / 60 - NEW.break_minutes;
  IF v_minutes <= 0 THEN RAISE EXCEPTION '休憩時間は勤務時間より短くしてください。'; END IF;
  NEW.store_name := v_store.name;
  SELECT name INTO NEW.company_name FROM companies WHERE id = v_store.company_id;
  NEW.work_minutes := v_minutes;
  NEW.offered_total_yen := round(v_store.hourly_wage * v_minutes / 60);
  -- 店舗負担の手数料。ワーカーへの提示額からは差し引かない。
  IF NEW.service_fee_percent IS DISTINCT FROM 20::numeric THEN RAISE EXCEPTION '手数料が更新されています。画面を更新して合計額をご確認ください。'; END IF;
  NEW.service_fee_yen := round(NEW.offered_total_yen * NEW.service_fee_percent / 100);
  NEW.store_total_yen := NEW.offered_total_yen + NEW.service_fee_yen;
  NEW.status := 'pending';
  RETURN NEW;
END $$;
CREATE TRIGGER prepare_scout_offer BEFORE INSERT ON public.scout_requests FOR EACH ROW EXECUTE FUNCTION public.prepare_scout_offer();

CREATE FUNCTION public.notify_scout_event() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO app_notifications(recipient_worker_id, scout_id, kind, title, body)
    VALUES (NEW.worker_id, NEW.id, 'scout_received', '新しいスカウトが届きました', NEW.store_name || 'から勤務のご相談です。');
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('accepted', 'rejected') AND NEW.store_id IS NOT NULL THEN
    INSERT INTO app_notifications(recipient_store_id, scout_id, kind, title, body)
    VALUES (NEW.store_id, NEW.id, CASE WHEN NEW.status = 'accepted' THEN 'scout_accepted' ELSE 'scout_rejected' END,
      CASE WHEN NEW.status = 'accepted' THEN 'スカウトが承諾されました' ELSE 'スカウトへの返信が届きました' END,
      CASE WHEN NEW.status = 'accepted' THEN 'チャットで当日のことを相談できます。' ELSE '今回は辞退のご連絡です。' END);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notify_scout_event AFTER INSERT OR UPDATE OF status ON public.scout_requests FOR EACH ROW EXECUTE FUNCTION public.notify_scout_event();

-- 返信・勤務枠作成・通知を同じトランザクションで実行する。
-- 同じ返信は再送しても増えず、確定済みの返信は変更しない。
CREATE FUNCTION public.respond_to_scout(p_scout_id UUID, p_worker_id UUID, p_status TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_scout scout_requests%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('accepted', 'rejected') THEN RAISE EXCEPTION '返信内容が不正です。'; END IF;
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

-- 直接INSERTでも承諾前・辞退済みのチャットは作成できない。
CREATE FUNCTION public.check_scout_message() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_scout scout_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_scout FROM scout_requests WHERE id = NEW.scout_id FOR SHARE;
  IF NOT FOUND OR v_scout.status <> 'accepted' OR v_scout.store_id IS NULL THEN RAISE EXCEPTION 'チャットはスカウト承諾後に利用できます。'; END IF;
  IF (NEW.sender_role = 'worker' AND NEW.sender_id IS DISTINCT FROM v_scout.worker_id)
    OR (NEW.sender_role = 'store' AND NEW.sender_id IS DISTINCT FROM v_scout.store_id) THEN RAISE EXCEPTION '会話の参加者を確認してください。'; END IF;
  NEW.body := btrim(NEW.body);
  RETURN NEW;
END $$;
CREATE TRIGGER check_scout_message BEFORE INSERT ON public.scout_messages FOR EACH ROW EXECUTE FUNCTION public.check_scout_message();

CREATE FUNCTION public.notify_chat_message() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_scout scout_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_scout FROM scout_requests WHERE id = NEW.scout_id;
  INSERT INTO app_notifications(recipient_worker_id, recipient_store_id, scout_id, message_id, kind, title, body)
  VALUES (CASE WHEN NEW.sender_role = 'store' THEN v_scout.worker_id END,
    CASE WHEN NEW.sender_role = 'worker' THEN v_scout.store_id END,
    NEW.scout_id, NEW.id, 'message', '新しいメッセージ', left(NEW.body, 100));
  RETURN NEW;
END $$;
CREATE TRIGGER notify_chat_message AFTER INSERT ON public.scout_messages FOR EACH ROW EXECUTE FUNCTION public.notify_chat_message();

COMMIT;
