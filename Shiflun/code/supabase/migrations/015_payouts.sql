-- Shiflun Phase 9-A: 支払い状況の手動記録（お金の流れの「案A：無仲介」を暫定実装）
--
-- 背景: docs/legal/02_money-flow.md の案A（Shiflunは資金に触れず、店舗が直接ワーカーへ
-- 支払う）に沿って、Shiflunは実際の送金は行わず「いくら払うべきか」の記録と
-- 「店舗が支払い済みと申告する」機能だけを提供する。決済代行（PAY.JP Platform等）を
-- 挟む案Bへ切り替える場合は、provider/provider_reference_id を使って拡張する想定。
--
-- 金額の計算自体は migration 014 の prepare_scout_offer トリガーで
-- scout_requests.offered_total_yen / service_fee_yen / store_total_yen として
-- 既に行われているため、ここでは「出勤が確定した勤務」に対する支払いレコードの
-- 作成・状態管理のみを扱う。

CREATE TABLE public.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL UNIQUE REFERENCES public.worker_availability_slots (id) ON DELETE CASCADE,
  scout_id UUID REFERENCES public.scout_requests (id) ON DELETE SET NULL,
  worker_id UUID NOT NULL REFERENCES public.workers (id) ON DELETE CASCADE,
  store_id UUID REFERENCES public.stores (id) ON DELETE SET NULL,
  store_name TEXT,
  wage_amount_yen NUMERIC(12, 0) NOT NULL CHECK (wage_amount_yen >= 0),
  service_fee_yen NUMERIC(12, 0) NOT NULL DEFAULT 0 CHECK (service_fee_yen >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid')),
  payout_method TEXT NOT NULL DEFAULT 'manual'
    CHECK (payout_method IN ('manual', 'platform')),
  provider TEXT NOT NULL DEFAULT 'none',
  provider_reference_id TEXT,
  marked_paid_by TEXT,
  paid_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payouts_worker_id ON public.payouts (worker_id);
CREATE INDEX idx_payouts_status ON public.payouts (status);

-- 出勤打刻（status='attended'）が確定した勤務枠に対して、自動的に payouts レコードを作成する。
-- 金額はスカウト経由の勤務枠（hourly_wage・scout_request_id が入っている）のみ計算できるため、
-- 自店舗シフト（スカウトを経由しない勤務）は対象外とする。
CREATE FUNCTION public.create_payout_on_attendance() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_scout scout_requests%ROWTYPE;
BEGIN
  IF NEW.status = 'attended' AND (OLD.status IS DISTINCT FROM 'attended') AND NEW.scout_request_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM payouts WHERE slot_id = NEW.id) THEN
      SELECT * INTO v_scout FROM scout_requests WHERE id = NEW.scout_request_id;
      IF FOUND AND v_scout.offered_total_yen IS NOT NULL THEN
        INSERT INTO payouts (slot_id, scout_id, worker_id, store_id, store_name, wage_amount_yen, service_fee_yen)
        VALUES (NEW.id, NEW.scout_request_id, NEW.worker_id, NEW.store_id, NEW.store_name,
          v_scout.offered_total_yen, COALESCE(v_scout.service_fee_yen, 0));
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER create_payout_on_attendance
  AFTER UPDATE OF status ON public.worker_availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.create_payout_on_attendance();

-- RLS is NOT enabled for this demo MVP.
