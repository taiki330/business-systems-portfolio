-- Shiflun Phase 6: シフト期間管理
-- 店長が作成する「○月のシフト」「2週間シフト」などの期間単位のシフト

CREATE TABLE shift_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  submission_deadline DATE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'draft')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_shift_periods_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_shift_periods_deadline CHECK (
    submission_deadline IS NULL OR submission_deadline <= end_date
  )
);

CREATE INDEX idx_shift_periods_store_name ON shift_periods (store_name);
CREATE INDEX idx_shift_periods_start_date ON shift_periods (start_date DESC);
