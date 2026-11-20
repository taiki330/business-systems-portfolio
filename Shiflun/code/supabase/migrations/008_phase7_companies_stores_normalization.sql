-- Shiflun Phase 7: companies / stores 正規化（store_id 先出し）
-- additive-only: 既存カラム（company_name / store_name / current_store）は削除しない。
-- 既存コード・UIは変更しない前提。新カラムは全て NULL 許容。
-- Auth / RLS はこのフェーズでは導入しない（user_id / owner_user_id は auth.users への
-- 参照だけ先に用意し、値の投入は Phase8 以降で行う）。

-- ============================================================
-- companies（新規テーブル）
-- ============================================================
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- stores（新規テーブル、1 company : N stores）
-- ============================================================
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies (id),
  name TEXT NOT NULL,
  owner_user_id UUID REFERENCES auth.users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stores_company_id ON stores (company_id);
CREATE INDEX idx_stores_owner_user_id ON stores (owner_user_id);

-- ============================================================
-- workers: user_id（1 auth user = 1 worker）・current_store_id
-- ============================================================
ALTER TABLE workers
  ADD COLUMN user_id UUID REFERENCES auth.users (id);

ALTER TABLE workers
  ADD CONSTRAINT uq_workers_user_id UNIQUE (user_id);

ALTER TABLE workers
  ADD COLUMN current_store_id UUID REFERENCES stores (id) ON DELETE SET NULL;

CREATE INDEX idx_workers_current_store_id ON workers (current_store_id);

-- workers.user_id は UNIQUE 制約がそのままインデックスを兼ねるため、別インデックス不要。

-- ============================================================
-- manager_verifications: store_id
-- ============================================================
ALTER TABLE manager_verifications
  ADD COLUMN store_id UUID REFERENCES stores (id) ON DELETE SET NULL;

CREATE INDEX idx_manager_verifications_store_id ON manager_verifications (store_id);

-- ============================================================
-- scout_requests: store_id
-- company_id は持たせない。stores.company_id から辿る方針。
-- ============================================================
ALTER TABLE scout_requests
  ADD COLUMN store_id UUID REFERENCES stores (id) ON DELETE SET NULL;

CREATE INDEX idx_scout_requests_store_id ON scout_requests (store_id);

-- ============================================================
-- shift_periods: store_id
-- ============================================================
ALTER TABLE shift_periods
  ADD COLUMN store_id UUID REFERENCES stores (id) ON DELETE SET NULL;

CREATE INDEX idx_shift_periods_store_id ON shift_periods (store_id);

-- ============================================================
-- worker_availability_slots: store_id
-- assigned / released になったシフトがどの店舗のものかを追跡するための下地。
-- ============================================================
ALTER TABLE worker_availability_slots
  ADD COLUMN store_id UUID REFERENCES stores (id) ON DELETE SET NULL;

CREATE INDEX idx_worker_availability_slots_store_id ON worker_availability_slots (store_id);

-- RLS is NOT enabled for this demo MVP (companies / stores も含む）。
