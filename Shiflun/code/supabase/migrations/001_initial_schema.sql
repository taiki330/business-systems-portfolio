-- Shiflun MVP: initial schema
-- Demo MVP only — RLS is intentionally NOT enabled.
-- Before production: enable Supabase Auth + RLS policies.

-- ============================================================
-- workers
-- ============================================================
CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  current_store TEXT NOT NULL,
  business_type TEXT NOT NULL,
  job_type TEXT NOT NULL,
  experience_years NUMERIC(3, 1) NOT NULL CHECK (experience_years >= 0),
  skills TEXT,
  bio TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workers_verification_status ON workers (verification_status);
CREATE INDEX idx_workers_business_type ON workers (business_type);
CREATE INDEX idx_workers_job_type ON workers (job_type);

-- ============================================================
-- manager_verifications
-- ============================================================
CREATE TABLE manager_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers (id) ON DELETE CASCADE,
  manager_name TEXT NOT NULL,
  manager_comment TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_manager_verifications_worker_id ON manager_verifications (worker_id);

-- ============================================================
-- scout_requests
-- ============================================================
CREATE TABLE scout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers (id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scout_requests_worker_id ON scout_requests (worker_id);

-- RLS is NOT enabled for this demo MVP.
-- Do NOT run: ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
