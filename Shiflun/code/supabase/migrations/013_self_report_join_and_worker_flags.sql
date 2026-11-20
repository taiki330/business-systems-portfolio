-- Shiflun Phase 8-B: 店舗所属を「店長承認制」から「自己申告制＋通報」へ変更
--
-- 背景: 弁護士・自治体（市役所）への相談で、店舗所属の店長承認フローが
-- 有料職業紹介事業の「あっせん（選別・仲介）」に該当しうると指摘された。
-- 対応として、店舗への所属は本人の自己申告で即時反映し（承認によるゲートを外す）、
-- 店長は所属者一覧を閲覧し、見覚えのない人物を「通報」できるようにする（事後チェック）。
--
-- 注意: この対応で職業紹介該当性の懸念が解消されるとは限らない（要再確認）。
-- 詳細は docs/legal/05_open-issues.md を参照。

-- ============================================================
-- store_join_requests: 承認待ちゲートを廃止し、自己申告の記録用に用途変更
-- 既存カラムは削除しない。status は今後 'approved' 固定で作成される
-- （後方互換のため pending/rejected の値は許容したままにする）。
-- ============================================================
COMMENT ON TABLE store_join_requests IS
  'Phase 8-B以降: 承認待ちの申請ではなく、自己申告による店舗所属の記録。status は自己申告時点で approved 固定。';

-- ============================================================
-- worker_flags（新規）: 店長による「見覚えがない」通報
-- ============================================================
CREATE TABLE IF NOT EXISTS worker_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers (id) ON DELETE CASCADE,
  store_name TEXT NOT NULL,
  reporter_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_flags_worker_id ON worker_flags (worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_flags_status ON worker_flags (status);

-- RLS is NOT enabled for this demo MVP.
