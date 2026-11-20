-- Shiflun: 所属スタッフ ⇔ 店長のチャット（シフト相談など）
-- 018 適用後に実行。スカウトチャット（scout_messages）とは別の会話として保存する。
-- Auth / RLS は既存方針を維持。sender の検証はトリガーで行うが、認証の代替ではない。
BEGIN;

CREATE TABLE public.staff_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  -- 送信時点の所属店舗。異動しても過去の会話は元の店舗に残る。
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('worker', 'store')),
  client_message_id UUID NOT NULL,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, store_id, sender_role, client_message_id)
);
CREATE INDEX idx_staff_messages_conversation ON public.staff_messages (store_id, worker_id, sequence DESC);
CREATE INDEX idx_staff_messages_worker ON public.staff_messages (worker_id, sequence DESC);

-- 直接INSERTでも、現在の所属店舗以外とは会話できない。
CREATE FUNCTION public.check_staff_message() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM workers WHERE id = NEW.worker_id AND current_store_id = NEW.store_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '所属店舗のスタッフとだけチャットできます。'; END IF;
  NEW.body := btrim(NEW.body);
  RETURN NEW;
END $$;
CREATE TRIGGER check_staff_message BEFORE INSERT ON public.staff_messages FOR EACH ROW EXECUTE FUNCTION public.check_staff_message();

-- 通知: スタッフチャットはスカウトに紐づかない。
ALTER TABLE public.app_notifications ALTER COLUMN scout_id DROP NOT NULL;
ALTER TABLE public.app_notifications ADD COLUMN staff_message_id UUID REFERENCES public.staff_messages(id) ON DELETE CASCADE;
ALTER TABLE public.app_notifications ADD COLUMN staff_worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE;
ALTER TABLE public.app_notifications DROP CONSTRAINT app_notifications_kind_check;
ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_kind_check
  CHECK (kind IN ('scout_received', 'scout_accepted', 'scout_rejected', 'message', 'staff_message'));
ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_subject_check
  CHECK (CASE WHEN kind = 'staff_message' THEN scout_id IS NULL AND staff_message_id IS NOT NULL AND staff_worker_id IS NOT NULL ELSE scout_id IS NOT NULL END);
CREATE INDEX idx_notifications_staff_message ON public.app_notifications (staff_message_id);

CREATE FUNCTION public.notify_staff_message() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  INSERT INTO app_notifications(recipient_worker_id, recipient_store_id, staff_message_id, staff_worker_id, kind, title, body)
  VALUES (CASE WHEN NEW.sender_role = 'store' THEN NEW.worker_id END,
    CASE WHEN NEW.sender_role = 'worker' THEN NEW.store_id END,
    NEW.id, NEW.worker_id, 'staff_message',
    CASE WHEN NEW.sender_role = 'store' THEN '店長からのメッセージ' ELSE (SELECT name FROM workers WHERE id = NEW.worker_id) || 'さんからのメッセージ' END,
    left(NEW.body, 100));
  RETURN NEW;
END $$;
CREATE TRIGGER notify_staff_message AFTER INSERT ON public.staff_messages FOR EACH ROW EXECUTE FUNCTION public.notify_staff_message();

COMMIT;
