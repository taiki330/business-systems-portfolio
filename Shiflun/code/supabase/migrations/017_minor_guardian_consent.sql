-- Shiflun Phase 9-C: 未成年ワーカーの親権者同意の記録
--
-- 背景: 利用規約第13条は「満16歳以上・高校生を除く未成年は親権者の同意を得て利用できる」
-- と定めているが、登録フローに同意取得UIが存在しなかった（docs/legal/05_open-issues.md #11）。
-- 本マイグレーションは、登録時に年齢区分と親権者同意を記録するためのカラムを追加する。

ALTER TABLE public.workers
  ADD COLUMN is_minor BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.workers
  ADD COLUMN guardian_name TEXT;

ALTER TABLE public.workers
  ADD COLUMN guardian_consented_at TIMESTAMPTZ;

-- 未成年の場合は親権者氏名・同意日時が必須（アプリ側の登録フォームでも必須項目とする）。
ALTER TABLE public.workers
  ADD CONSTRAINT chk_workers_guardian_consent
    CHECK (
      is_minor = false
      OR (guardian_name IS NOT NULL AND btrim(guardian_name) <> '' AND guardian_consented_at IS NOT NULL)
    );

-- RLS is NOT enabled for this demo MVP.
