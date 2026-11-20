-- Shiflun Phase 5-A: 勤務可能時間（特定日付）
-- バイト側の空き時間登録用。曜日繰り返しは Phase 5 以降。

-- ============================================================
-- worker_availability_slots: work_date 追加
-- ============================================================
ALTER TABLE worker_availability_slots
  ADD COLUMN IF NOT EXISTS work_date DATE;

ALTER TABLE worker_availability_slots
  ALTER COLUMN day_of_week DROP NOT NULL;

-- end_time > start_time は 002 で定義済み（維持）

-- ============================================================
-- 検索用インデックス
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_worker_availability_slots_work_date
  ON worker_availability_slots (work_date);

CREATE INDEX IF NOT EXISTS idx_worker_availability_slots_search
  ON worker_availability_slots (work_date, start_time, end_time);
