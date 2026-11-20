-- Shiflun Phase 3-A: 店長認証の店舗名・1ワーカー1認証
-- 画面実装は Phase 3-B 以降。ここではスキーマ変更のみ。

-- ============================================================
-- manager_verifications: 店舗名カラム追加
-- ============================================================
ALTER TABLE manager_verifications
  ADD COLUMN IF NOT EXISTS store_name TEXT;

-- 既存レコードがある場合のバックフィル（新規環境では影響なし）
UPDATE manager_verifications
SET store_name = '(未設定)'
WHERE store_name IS NULL;

ALTER TABLE manager_verifications
  ALTER COLUMN store_name SET NOT NULL;

-- ============================================================
-- 1ワーカーにつき1認証（デモ MVP）
-- 既に同一 worker_id の重複がある場合は先に整理してから実行してください。
-- ============================================================
ALTER TABLE manager_verifications
  ADD CONSTRAINT uq_manager_verifications_worker_id UNIQUE (worker_id);
