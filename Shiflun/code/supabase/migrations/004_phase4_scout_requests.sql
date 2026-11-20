-- Shiflun Phase 4-B: scout_requests 拡張（スカウト詳細カラム）
-- 必須チェックはアプリ側 Server Action で行う（カラムは NULL 許容）

-- ============================================================
-- scout_requests: 店舗名・希望勤務条件・提示時給
-- ============================================================
ALTER TABLE scout_requests
  ADD COLUMN IF NOT EXISTS store_name TEXT;

ALTER TABLE scout_requests
  ADD COLUMN IF NOT EXISTS preferred_work_date DATE;

ALTER TABLE scout_requests
  ADD COLUMN IF NOT EXISTS preferred_start_time TIME;

ALTER TABLE scout_requests
  ADD COLUMN IF NOT EXISTS preferred_end_time TIME;

ALTER TABLE scout_requests
  ADD COLUMN IF NOT EXISTS offered_hourly_wage NUMERIC(6, 0);

-- ============================================================
-- CHECK 制約（NULL 許容を考慮）
-- ============================================================
ALTER TABLE scout_requests
  ADD CONSTRAINT chk_scout_requests_time_range
    CHECK (
      preferred_end_time IS NULL
      OR preferred_start_time IS NULL
      OR preferred_end_time > preferred_start_time
    );

ALTER TABLE scout_requests
  ADD CONSTRAINT chk_scout_requests_offered_hourly_wage
    CHECK (
      offered_hourly_wage IS NULL
      OR offered_hourly_wage > 0
    );
