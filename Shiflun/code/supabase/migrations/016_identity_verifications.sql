-- Shiflun Phase 9-B: eKYC（本人確認）の暫定実装
--
-- 背景: 要件定義書はeKYCサービス連携による本人確認を必須構想としているが、
-- 実際のeKYCベンダー（TRUSTDOCK等）とは未契約。本番導入までのつなぎとして、
-- ワーカーが身分証画像を提出し、運営内部で目視審査するプレースホルダーを用意する。
-- provider カラムは 'manual'（今回実装）から将来 'trustdock' 等の外部ベンダーへ
-- 差し替えることを想定した拡張ポイント。
--
-- 個人情報の取扱いはdocs/legal/04_questions-lawyer.md「5. 個人情報」の
-- 弁護士確認待ち事項であるため、本番投入前に要確認。

CREATE TABLE public.identity_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL UNIQUE REFERENCES public.workers (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified', 'pending', 'verified', 'rejected')),
  full_name_kana TEXT,
  birth_date DATE,
  document_type TEXT
    CHECK (document_type IS NULL OR document_type IN ('license', 'my_number_card', 'passport', 'residence_card')),
  document_storage_path TEXT,
  provider TEXT NOT NULL DEFAULT 'manual',
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewer_name TEXT,
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_identity_verifications_status ON public.identity_verifications (status);

-- 身分証画像の保管用バケット（非公開）。
-- 実行にはservice_role権限が必要な場合があります。失敗する場合はDashboard→Storageから
-- 手動でバケット名 "identity-documents"（非公開）を作成してください。
INSERT INTO storage.buckets (id, name, public)
VALUES ('identity-documents', 'identity-documents', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 【重要・デモ限定】anon キーでのアップロード・閲覧を許可するポリシー。
-- このアプリは RLS OFF・anon key のみで動くデモ構成のため、他のテーブルと
-- 同様の前提でストレージも anon に開放している。これは身分証画像という
-- 機微情報の入れ物として本番運用に耐えない設定であり、
-- 「URL（バケット名・ファイルパス）を知っていれば誰でも読み書きできる」状態になる。
-- 本番導入前に、認証済みユーザー・本人・審査担当者のみに制限すること
-- （docs/legal/04_questions-lawyer.md「5. 個人情報」の弁護士確認と合わせて要対応）。
-- ============================================================
CREATE POLICY "identity_documents_demo_insert" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'identity-documents');

CREATE POLICY "identity_documents_demo_select" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'identity-documents');

-- RLS is NOT enabled for this demo MVP（storage.objects 自体は Supabase 管理でRLS必須のため、
-- 上記の限定的なポリシーのみ追加している）。
