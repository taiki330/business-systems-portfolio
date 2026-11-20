-- Shiflun: 利用規約・プライバシーポリシーへの同意記録
-- 019 適用後に実行。既存の登録は NULL（同意記録なし）のまま残る。
BEGIN;

-- terms_version には同意した版を保存（例: 'terms-v3+privacy-v1-draft'）。版と日時は必ずセット。
ALTER TABLE public.workers ADD COLUMN terms_version TEXT;
ALTER TABLE public.workers ADD COLUMN terms_agreed_at TIMESTAMPTZ;
ALTER TABLE public.workers ADD CONSTRAINT workers_terms_consent_check CHECK ((terms_version IS NULL) = (terms_agreed_at IS NULL));

ALTER TABLE public.stores ADD COLUMN terms_version TEXT;
ALTER TABLE public.stores ADD COLUMN terms_agreed_at TIMESTAMPTZ;
ALTER TABLE public.stores ADD CONSTRAINT stores_terms_consent_check CHECK ((terms_version IS NULL) = (terms_agreed_at IS NULL));

-- 店舗の新規登録と同意記録を一度に保存する。p_terms_version は旧呼び出し互換のため省略可。
DROP FUNCTION public.create_scouting_store(TEXT, TEXT, TEXT, INTEGER);
CREATE FUNCTION public.create_scouting_store(p_company_name TEXT, p_store_name TEXT, p_area TEXT, p_hourly_wage INTEGER, p_terms_version TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_company UUID; v_store UUID;
BEGIN
  IF char_length(btrim(p_company_name)) NOT BETWEEN 1 AND 100 OR char_length(btrim(p_store_name)) NOT BETWEEN 1 AND 100
    OR char_length(btrim(p_area)) NOT BETWEEN 1 AND 100 OR p_hourly_wage NOT BETWEEN 1 AND 999999
    OR p_company_name IS NULL OR p_store_name IS NULL OR p_area IS NULL OR p_hourly_wage IS NULL THEN
    RAISE EXCEPTION '店舗名・企業名・エリア・時給を確認してください。';
  END IF;
  IF p_terms_version IS NOT NULL AND char_length(btrim(p_terms_version)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '同意した規約の版を確認してください。';
  END IF;
  INSERT INTO companies(name) VALUES (btrim(p_company_name)) RETURNING id INTO v_company;
  INSERT INTO stores(company_id, name, area, hourly_wage, terms_version, terms_agreed_at)
  VALUES (v_company, btrim(p_store_name), btrim(p_area), p_hourly_wage, btrim(p_terms_version), CASE WHEN p_terms_version IS NOT NULL THEN now() END)
  RETURNING id INTO v_store;
  RETURN v_store;
END $$;

COMMIT;
