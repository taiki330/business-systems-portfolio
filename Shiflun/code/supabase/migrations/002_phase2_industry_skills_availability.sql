-- Shiflun Phase 2: 飲食業特化・スキルタグ・将来シフト連動用スキーマ
-- シフト管理 UI / API は Phase 2 では実装しない（テーブル定義のみ）

-- ============================================================
-- workers: スキルタグ（複数選択）
-- ============================================================
ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS skill_tags TEXT[] NOT NULL DEFAULT '{}';

-- 既存データ: 旧 job_type を skill_tags に移行
UPDATE workers
SET skill_tags = ARRAY[job_type]
WHERE skill_tags = '{}'
  AND job_type IS NOT NULL
  AND job_type <> '';

-- job_type は後方互換のため残すが、新規登録では非推奨
ALTER TABLE workers
  ALTER COLUMN job_type DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workers_skill_tags
  ON workers USING GIN (skill_tags);

-- ============================================================
-- worker_availability_slots（将来用: 空き時間・希望勤務時間）
-- Phase 2 ではアプリから読み書きしない
-- ============================================================
CREATE TABLE IF NOT EXISTS worker_availability_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers (id) ON DELETE CASCADE,
  slot_type TEXT NOT NULL
    CHECK (slot_type IN ('available', 'preferred')),
  day_of_week SMALLINT NOT NULL
    CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_worker_availability_slots_worker_id
  ON worker_availability_slots (worker_id);

CREATE INDEX IF NOT EXISTS idx_worker_availability_slots_slot_type
  ON worker_availability_slots (slot_type);

-- RLS is NOT enabled for this demo MVP.
