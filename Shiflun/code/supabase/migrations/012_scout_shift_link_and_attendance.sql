-- Shiflun Phase 8-A: スカウト成立→シフト連携 + 勤怠打刻拡張
--
-- 背景: これまで updateScoutStatus は scout_requests.status を更新するだけで、
-- 承諾されたスカウトが worker_availability_slots（勤怠打刻の対象）に反映されず、
-- 他店舗スカウト成立分の出勤打刻ができなかった。
-- また、既存の CHECK 制約 chk_worker_availability_slots_status は
-- 'attended' を許可しておらず、clockInShift が本番DBでは失敗する状態だった（バグ修正）。

-- ============================================================
-- worker_availability_slots: スカウト連携・勤怠詳細カラム追加
-- ============================================================
ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS store_name TEXT;

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS company_name TEXT;

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS scout_request_id UUID REFERENCES scout_requests (id) ON DELETE SET NULL;

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS hourly_wage NUMERIC(6, 0);

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS clock_in_at TIMESTAMPTZ;

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS clock_out_at TIMESTAMPTZ;

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS clock_in_lat NUMERIC(9, 6);

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS clock_in_lng NUMERIC(9, 6);

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS clock_out_lat NUMERIC(9, 6);

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS clock_out_lng NUMERIC(9, 6);

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS checkin_method TEXT NOT NULL DEFAULT 'self_report';

ALTER TABLE worker_availability_slots
  ADD CONSTRAINT chk_worker_availability_slots_checkin_method
    CHECK (checkin_method IN ('self_report', 'gps', 'qr'));

CREATE INDEX IF NOT EXISTS idx_worker_availability_slots_scout_request_id
  ON worker_availability_slots (scout_request_id);

-- ============================================================
-- status CHECK 制約の修正（'attended' 追加）
-- ============================================================
ALTER TABLE worker_availability_slots
  DROP CONSTRAINT IF EXISTS chk_worker_availability_slots_status;

ALTER TABLE worker_availability_slots
  ADD CONSTRAINT chk_worker_availability_slots_status
    CHECK (status IN ('pending', 'assigned', 'released', 'cancelled', 'attended'));

-- RLS is NOT enabled for this demo MVP.
