-- Shiflun Phase 5-D1: 勤務希望ステータス
-- pending → 店長判定 → assigned / released
-- 企業検索は released のみ

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE worker_availability_slots
  ADD CONSTRAINT chk_worker_availability_slots_status
    CHECK (status IN ('pending', 'assigned', 'released', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_worker_availability_slots_search_status
  ON worker_availability_slots (work_date, status, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_worker_availability_slots_worker_status
  ON worker_availability_slots (worker_id, status);
