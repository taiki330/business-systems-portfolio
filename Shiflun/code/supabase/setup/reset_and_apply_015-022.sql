-- Shiflun: 本番DBのセットアップ（テストデータの削除 → migration 015〜022）
-- 自動生成ファイル。元のファイルを直したら作り直すこと（README「ログイン（Supabase Auth）とアクセス制限」参照）。
-- 対象: 001〜014 と 017 が適用済みの本番DB。Supabase の SQL Editor に全文を貼り付けて1回だけ実行する。
-- 【注意】最初にアプリのデータをすべて消します（テストデータの削除）。実際の利用者のデータが入った後は実行しないこと。

-- ===== supabase/setup/reset_test_data.sql =====
-- Shiflun: テストデータの削除（ログイン導入前に作られたデータを全部消す）
--
-- 【注意】アプリのデータ（ワーカー・店舗・スカウト・シフト・チャット・通知など）がすべて消えます。元に戻せません。
-- ログイン（migration 022）の導入前に、ログインと結びついていないテスト用のデータを消すために使う。
-- 本番で実際の利用者のデータが入った後は、絶対に実行しないこと。
--
-- テーブルが無い場合（まだ作られていないマイグレーションの分）は飛ばす。
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_notifications', 'staff_messages', 'scout_messages', 'payouts', 'identity_verifications',
    'manager_verifications', 'worker_flags', 'store_join_requests', 'worker_availability_slots',
    'scout_requests', 'shift_periods', 'workers', 'stores', 'companies'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I CASCADE', t);
      RAISE NOTICE '消去しました: %', t;
    END IF;
  END LOOP;
END $$;

-- ===== 本番DBに先に作られていた設定の片付け =====
-- 本番では、身分証バケット（identity-documents）と 016 のアップロード用ポリシーだけが先に作られていた。
-- 016 が同じ名前のポリシーを作るので、先に消しておく（022 で最終的に消して置き換える）。
DROP POLICY IF EXISTS "identity_documents_demo_insert" ON storage.objects;
DROP POLICY IF EXISTS "identity_documents_demo_select" ON storage.objects;

-- ===== supabase/migrations/015_payouts.sql =====
-- Shiflun Phase 9-A: 支払い状況の手動記録（お金の流れの「案A：無仲介」を暫定実装）
--
-- 背景: docs/legal/02_money-flow.md の案A（Shiflunは資金に触れず、店舗が直接ワーカーへ
-- 支払う）に沿って、Shiflunは実際の送金は行わず「いくら払うべきか」の記録と
-- 「店舗が支払い済みと申告する」機能だけを提供する。決済代行（PAY.JP Platform等）を
-- 挟む案Bへ切り替える場合は、provider/provider_reference_id を使って拡張する想定。
--
-- 金額の計算自体は migration 014 の prepare_scout_offer トリガーで
-- scout_requests.offered_total_yen / service_fee_yen / store_total_yen として
-- 既に行われているため、ここでは「出勤が確定した勤務」に対する支払いレコードの
-- 作成・状態管理のみを扱う。

CREATE TABLE public.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL UNIQUE REFERENCES public.worker_availability_slots (id) ON DELETE CASCADE,
  scout_id UUID REFERENCES public.scout_requests (id) ON DELETE SET NULL,
  worker_id UUID NOT NULL REFERENCES public.workers (id) ON DELETE CASCADE,
  store_id UUID REFERENCES public.stores (id) ON DELETE SET NULL,
  store_name TEXT,
  wage_amount_yen NUMERIC(12, 0) NOT NULL CHECK (wage_amount_yen >= 0),
  service_fee_yen NUMERIC(12, 0) NOT NULL DEFAULT 0 CHECK (service_fee_yen >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid')),
  payout_method TEXT NOT NULL DEFAULT 'manual'
    CHECK (payout_method IN ('manual', 'platform')),
  provider TEXT NOT NULL DEFAULT 'none',
  provider_reference_id TEXT,
  marked_paid_by TEXT,
  paid_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payouts_worker_id ON public.payouts (worker_id);
CREATE INDEX idx_payouts_status ON public.payouts (status);

-- 出勤打刻（status='attended'）が確定した勤務枠に対して、自動的に payouts レコードを作成する。
-- 金額はスカウト経由の勤務枠（hourly_wage・scout_request_id が入っている）のみ計算できるため、
-- 自店舗シフト（スカウトを経由しない勤務）は対象外とする。
CREATE FUNCTION public.create_payout_on_attendance() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_scout scout_requests%ROWTYPE;
BEGIN
  IF NEW.status = 'attended' AND (OLD.status IS DISTINCT FROM 'attended') AND NEW.scout_request_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM payouts WHERE slot_id = NEW.id) THEN
      SELECT * INTO v_scout FROM scout_requests WHERE id = NEW.scout_request_id;
      IF FOUND AND v_scout.offered_total_yen IS NOT NULL THEN
        INSERT INTO payouts (slot_id, scout_id, worker_id, store_id, store_name, wage_amount_yen, service_fee_yen)
        VALUES (NEW.id, NEW.scout_request_id, NEW.worker_id, NEW.store_id, NEW.store_name,
          v_scout.offered_total_yen, COALESCE(v_scout.service_fee_yen, 0));
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER create_payout_on_attendance
  AFTER UPDATE OF status ON public.worker_availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.create_payout_on_attendance();

-- RLS is NOT enabled for this demo MVP.

-- ===== supabase/migrations/016_identity_verifications.sql =====
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

-- ===== supabase/migrations/018_identity_documents_access_restriction.sql =====
-- Shiflun: 本人確認バケットの読み取りアクセスを閉じる（本番化に向けた対応）
--
-- 背景: このプロジェクトはまだ本格的なログイン認証（Supabase Auth + RLS）を導入して
-- おらず、"anon" ロールしか存在しないため、RLSでは「本人だけ」「審査担当者だけ」を
-- 区別できない（全員に許可 or 全員に禁止の二択）。身分証画像という機微情報を
-- anon に対して全面公開したままにするのは本番運用上のリスクが大きいため、
-- 読み取り（SELECT）はサーバー側限定の service role 経由に切り替え、
-- anon の読み取りポリシーを撤廃する。
--
-- アップロード（INSERT）は本人確認ができないため anon のまま残す
-- （悪用されても画像が汚染されるだけで、機微情報の漏洩ではないため許容）。
--
-- 根本対応（誰がアップロード本人か・誰が審査担当者かを認証で区別する）は
-- 別途 Auth + RLS 導入時に行う（docs/legal/05_open-issues.md 参照）。

DROP POLICY IF EXISTS "identity_documents_demo_select" ON storage.objects;

-- service role は RLS を経由せず常に全操作を行えるため、anon 向けの
-- SELECT ポリシーが無くなればアプリの一般利用者・ワーカーからは読み取れなくなる。

-- ===== supabase/migrations/019_staff_chat.sql =====
-- Shiflun: 所属スタッフ ⇔ 店長のチャット（シフト相談など）
-- 018 適用後に実行。スカウトチャット（scout_messages）とは別の会話として保存する。
-- Auth / RLS は既存方針を維持。sender の検証はトリガーで行うが、認証の代替ではない。
BEGIN;

CREATE TABLE public.staff_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  -- 送信時点の所属店舗。異動しても過去の会話は元の店舗に残る。
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('worker', 'store')),
  client_message_id UUID NOT NULL,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, store_id, sender_role, client_message_id)
);
CREATE INDEX idx_staff_messages_conversation ON public.staff_messages (store_id, worker_id, sequence DESC);
CREATE INDEX idx_staff_messages_worker ON public.staff_messages (worker_id, sequence DESC);

-- 直接INSERTでも、現在の所属店舗以外とは会話できない。
CREATE FUNCTION public.check_staff_message() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM workers WHERE id = NEW.worker_id AND current_store_id = NEW.store_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '所属店舗のスタッフとだけチャットできます。'; END IF;
  NEW.body := btrim(NEW.body);
  RETURN NEW;
END $$;
CREATE TRIGGER check_staff_message BEFORE INSERT ON public.staff_messages FOR EACH ROW EXECUTE FUNCTION public.check_staff_message();

-- 通知: スタッフチャットはスカウトに紐づかない。
ALTER TABLE public.app_notifications ALTER COLUMN scout_id DROP NOT NULL;
ALTER TABLE public.app_notifications ADD COLUMN staff_message_id UUID REFERENCES public.staff_messages(id) ON DELETE CASCADE;
ALTER TABLE public.app_notifications ADD COLUMN staff_worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE;
ALTER TABLE public.app_notifications DROP CONSTRAINT app_notifications_kind_check;
ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_kind_check
  CHECK (kind IN ('scout_received', 'scout_accepted', 'scout_rejected', 'message', 'staff_message'));
ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_subject_check
  CHECK (CASE WHEN kind = 'staff_message' THEN scout_id IS NULL AND staff_message_id IS NOT NULL AND staff_worker_id IS NOT NULL ELSE scout_id IS NOT NULL END);
CREATE INDEX idx_notifications_staff_message ON public.app_notifications (staff_message_id);

CREATE FUNCTION public.notify_staff_message() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  INSERT INTO app_notifications(recipient_worker_id, recipient_store_id, staff_message_id, staff_worker_id, kind, title, body)
  VALUES (CASE WHEN NEW.sender_role = 'store' THEN NEW.worker_id END,
    CASE WHEN NEW.sender_role = 'worker' THEN NEW.store_id END,
    NEW.id, NEW.worker_id, 'staff_message',
    CASE WHEN NEW.sender_role = 'store' THEN '店長からのメッセージ' ELSE (SELECT name FROM workers WHERE id = NEW.worker_id) || 'さんからのメッセージ' END,
    left(NEW.body, 100));
  RETURN NEW;
END $$;
CREATE TRIGGER notify_staff_message AFTER INSERT ON public.staff_messages FOR EACH ROW EXECUTE FUNCTION public.notify_staff_message();

COMMIT;

-- ===== supabase/migrations/020_terms_consent.sql =====
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

-- ===== supabase/migrations/021_store_access_policies.sql =====
-- Shiflun: companies / stores のアクセスポリシー
-- 本番DBでは companies（と stores）に RLS が有効化されていて、ポリシーが無いため
-- anon キーのアプリから店舗の一覧表示・登録ができなかった（ワーカー登録の店舗候補が空になる）。
-- 認証（Supabase Auth）導入までの暫定として、閲覧・登録・更新だけを anon に許可する（削除は許可しない）。
-- RLS が無効なDBでは、これらのポリシーは効果を持たない（害もない）。
-- Auth 導入時に、店舗オーナー本人だけが更新できるポリシーへ置き換えること。
BEGIN;

DROP POLICY IF EXISTS shiflun_companies_select ON public.companies;
DROP POLICY IF EXISTS shiflun_companies_insert ON public.companies;
DROP POLICY IF EXISTS shiflun_stores_select ON public.stores;
DROP POLICY IF EXISTS shiflun_stores_insert ON public.stores;
DROP POLICY IF EXISTS shiflun_stores_update ON public.stores;

CREATE POLICY shiflun_companies_select ON public.companies FOR SELECT TO anon USING (true);
CREATE POLICY shiflun_companies_insert ON public.companies FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY shiflun_stores_select ON public.stores FOR SELECT TO anon USING (true);
CREATE POLICY shiflun_stores_insert ON public.stores FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY shiflun_stores_update ON public.stores FOR UPDATE TO anon USING (true) WITH CHECK (true);

COMMIT;

-- ===== supabase/migrations/022_auth_rls.sql =====
-- Shiflun: ログイン（Supabase Auth）とアクセス制限（RLS）
--
-- これまでは端末に保存したIDで本人を区別しており、公開用の anon キーでどのテーブルも読み書きできた。
-- このマイグレーションで、次のようにする。
--   * anon（ログインしていない状態）は、どのテーブルも読み書きできない
--   * ワーカーは workers.user_id、店長は stores.owner_user_id でログインユーザーと結びつける
--   * 各テーブルは「本人」「関係する店舗」の範囲だけを読み書きできる
--   * 重要な値（認証状態・提示額・支払い状態など）は、決められた操作でしか変えられない
--   * 身分証は、審査担当（app_metadata.role = 'identity_reviewer'）が2段階認証（aal2）でログインしたときだけ見られる
--
-- 【実行前に必要なこと】既存のテストデータを消すこと（supabase/setup/reset_test_data.sql）。
-- workers.user_id / stores.owner_user_id を必須にするため、ログインと結びついていない行が残っていると失敗する。
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ログインユーザーとの結びつき
-- ---------------------------------------------------------------------------
ALTER TABLE public.workers ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.stores ALTER COLUMN owner_user_id SET NOT NULL;
-- 1つのログインで持てる店舗は1つ（アプリは「自分の店舗」を1つとして扱う）。
CREATE UNIQUE INDEX uq_stores_owner_user_id ON public.stores (owner_user_id);

-- 所属登録の記録・通報を、店舗名ではなく店舗IDで絞り込めるようにする。
ALTER TABLE public.store_join_requests ADD COLUMN store_id UUID REFERENCES public.stores (id) ON DELETE CASCADE;
ALTER TABLE public.store_join_requests ADD COLUMN worker_id UUID REFERENCES public.workers (id) ON DELETE CASCADE;
CREATE INDEX idx_store_join_requests_store_id ON public.store_join_requests (store_id, created_at DESC);
ALTER TABLE public.worker_flags ADD COLUMN store_id UUID REFERENCES public.stores (id) ON DELETE CASCADE;
CREATE INDEX idx_worker_flags_store_id ON public.worker_flags (store_id, status);

-- ---------------------------------------------------------------------------
-- 2. 判定用の関数（RLS の中で使う。SECURITY DEFINER なので RLS を再帰的に評価しない）
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.current_worker_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM workers WHERE user_id = auth.uid()
$$;

CREATE FUNCTION public.current_store_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM stores WHERE owner_user_id = auth.uid()
$$;

CREATE FUNCTION public.owns_store(p_store_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_store_id IS NOT NULL AND EXISTS (SELECT 1 FROM stores WHERE id = p_store_id AND owner_user_id = auth.uid())
$$;

CREATE FUNCTION public.is_store_owner() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM stores WHERE owner_user_id = auth.uid())
$$;

-- 店舗が自店のスタッフ（現在の所属店舗が自店のワーカー）かどうか。
CREATE FUNCTION public.is_my_staff(p_worker_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM workers w JOIN stores s ON s.id = w.current_store_id WHERE w.id = p_worker_id AND s.owner_user_id = auth.uid())
$$;

-- 審査担当。app_metadata は利用者が自分で書き換えられない（運営が SQL か Dashboard で付与する）。
-- 2段階認証を済ませたログイン（aal2）のときだけ true。
CREATE FUNCTION public.is_identity_reviewer() RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'identity_reviewer'
    AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- ---------------------------------------------------------------------------
-- 3. 権限の初期化：anon は何もできない。authenticated は下のポリシーの範囲だけ
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS shiflun_companies_select ON public.companies;
DROP POLICY IF EXISTS shiflun_companies_insert ON public.companies;
DROP POLICY IF EXISTS shiflun_stores_select ON public.stores;
DROP POLICY IF EXISTS shiflun_stores_insert ON public.stores;
DROP POLICY IF EXISTS shiflun_stores_update ON public.stores;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

-- authenticated は、テーブルごとに必要な操作だけ許可し直す。
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
GRANT EXECUTE ON FUNCTION public.current_worker_id(), public.current_store_id(), public.owns_store(UUID),
  public.is_store_owner(), public.is_my_staff(UUID), public.is_identity_reviewer() TO authenticated;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. テーブルごとのポリシー
-- ---------------------------------------------------------------------------
-- companies / stores: 店舗名は全員に見せる（所属店舗の選択・スカウト元の表示）。登録は create_scouting_store だけ。
GRANT SELECT ON public.companies, public.stores TO authenticated;
CREATE POLICY companies_select ON public.companies FOR SELECT TO authenticated USING (true);
CREATE POLICY stores_select ON public.stores FOR SELECT TO authenticated USING (true);
GRANT UPDATE (area, hourly_wage, terms_version, terms_agreed_at) ON public.stores TO authenticated;
CREATE POLICY stores_update_own ON public.stores FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

-- workers: 本人と、店舗（スカウト・スタッフ管理のため）と、審査担当が読める。
-- 認証状態（verification_status）とログインとの結びつき（user_id）は本人も変えられない。
GRANT SELECT, INSERT ON public.workers TO authenticated;
GRANT UPDATE (name, current_store, current_store_id, business_type, job_type, experience_years, skills, bio,
  skill_tags, preferred_areas, terms_version, terms_agreed_at) ON public.workers TO authenticated;
CREATE POLICY workers_select ON public.workers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_store_owner() OR public.is_identity_reviewer());
CREATE POLICY workers_insert_self ON public.workers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND verification_status = 'unverified');
CREATE POLICY workers_update_self ON public.workers FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- worker_availability_slots: 本人と、自店に関係するシフト（スタッフの希望・自店のスカウト）と、
-- 他店へ公開されたシフト（status = 'released'、人材検索用）を店舗が読める。
GRANT SELECT, INSERT, DELETE ON public.worker_availability_slots TO authenticated;
GRANT UPDATE (status, reviewed_at, clock_in_at, clock_in_lat, clock_in_lng, clock_out_at, clock_out_lat, clock_out_lng, checkin_method)
  ON public.worker_availability_slots TO authenticated;
CREATE POLICY slots_select ON public.worker_availability_slots FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id()
    OR (public.is_store_owner() AND (status = 'released' OR public.owns_store(store_id) OR public.is_my_staff(worker_id))));
CREATE POLICY slots_insert_self ON public.worker_availability_slots FOR INSERT TO authenticated
  WITH CHECK (worker_id = public.current_worker_id() AND status = 'pending' AND scout_request_id IS NULL
    AND clock_in_at IS NULL AND clock_out_at IS NULL);
CREATE POLICY slots_update ON public.worker_availability_slots FOR UPDATE TO authenticated
  USING (worker_id = public.current_worker_id() OR public.is_my_staff(worker_id))
  WITH CHECK (worker_id = public.current_worker_id() OR public.is_my_staff(worker_id));
CREATE POLICY slots_delete_own_pending ON public.worker_availability_slots FOR DELETE TO authenticated
  USING (worker_id = public.current_worker_id() AND status = 'pending');

-- 誰がどの状態遷移をしてよいかを、変更できる列も含めて確認する。
-- ワーカー: 当日の確定シフトの出勤打刻（assigned → attended）、出勤後の退勤打刻。
-- 店長: 自店スタッフの勤務希望の確定・他店への公開（pending → assigned / released）。
CREATE FUNCTION public.guard_slot_update() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_same_except JSONB;
  v_today DATE := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  -- ログインしていない文脈（運営の SQL Editor、SECURITY DEFINER の関数内など）は対象外。
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.worker_id = current_worker_id() THEN
    IF OLD.status = 'assigned' AND NEW.status = 'attended' AND OLD.work_date = v_today
      AND (to_jsonb(NEW) - ARRAY['status', 'reviewed_at', 'clock_in_at', 'clock_in_lat', 'clock_in_lng', 'checkin_method'])
        = (to_jsonb(OLD) - ARRAY['status', 'reviewed_at', 'clock_in_at', 'clock_in_lat', 'clock_in_lng', 'checkin_method']) THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'attended' AND NEW.status = 'attended' AND OLD.clock_out_at IS NULL AND NEW.clock_out_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['clock_out_at', 'clock_out_lat', 'clock_out_lng'])
        = (to_jsonb(OLD) - ARRAY['clock_out_at', 'clock_out_lat', 'clock_out_lng']) THEN
      RETURN NEW;
    END IF;
  ELSIF is_my_staff(NEW.worker_id) THEN
    IF OLD.status = 'pending' AND NEW.status IN ('assigned', 'released')
      AND (to_jsonb(NEW) - ARRAY['status', 'reviewed_at']) = (to_jsonb(OLD) - ARRAY['status', 'reviewed_at']) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'このシフトは変更できません。画面を更新してください。' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER guard_slot_update BEFORE UPDATE ON public.worker_availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.guard_slot_update();

-- scout_requests: 当事者（ワーカー本人・送った店舗）だけが読める。送れるのは自店から。
-- 返信は respond_to_scout だけ（直接の UPDATE は許可しない）。
GRANT SELECT, INSERT ON public.scout_requests TO authenticated;
CREATE POLICY scouts_select ON public.scout_requests FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id() OR public.owns_store(store_id));
CREATE POLICY scouts_insert_from_own_store ON public.scout_requests FOR INSERT TO authenticated
  WITH CHECK (public.owns_store(store_id));

-- scout_messages: スカウトの当事者だけ。送信者は自分自身に限る。
GRANT SELECT, INSERT ON public.scout_messages TO authenticated;
CREATE POLICY scout_messages_select ON public.scout_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM scout_requests r WHERE r.id = scout_id
    AND (r.worker_id = public.current_worker_id() OR public.owns_store(r.store_id))));
CREATE POLICY scout_messages_insert ON public.scout_messages FOR INSERT TO authenticated
  WITH CHECK ((sender_role = 'worker' AND sender_id = public.current_worker_id())
    OR (sender_role = 'store' AND public.owns_store(sender_id)));

-- staff_messages: 所属スタッフ本人と、所属先の店舗だけ。
GRANT SELECT, INSERT ON public.staff_messages TO authenticated;
CREATE POLICY staff_messages_select ON public.staff_messages FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id() OR public.owns_store(store_id));
CREATE POLICY staff_messages_insert ON public.staff_messages FOR INSERT TO authenticated
  WITH CHECK ((sender_role = 'worker' AND worker_id = public.current_worker_id())
    OR (sender_role = 'store' AND public.owns_store(store_id)));

-- app_notifications: 宛先本人だけ。作成はトリガーだけ、更新は既読（read_at）だけ。
GRANT SELECT ON public.app_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.app_notifications TO authenticated;
CREATE POLICY notifications_select ON public.app_notifications FOR SELECT TO authenticated
  USING (recipient_worker_id = public.current_worker_id() OR public.owns_store(recipient_store_id));
CREATE POLICY notifications_mark_read ON public.app_notifications FOR UPDATE TO authenticated
  USING (recipient_worker_id = public.current_worker_id() OR public.owns_store(recipient_store_id))
  WITH CHECK (recipient_worker_id = public.current_worker_id() OR public.owns_store(recipient_store_id));

-- manager_verifications: 店長認証。登録できるのは、そのワーカーの所属店舗の店長だけ。
-- 登録すると、トリガーがワーカーの認証状態を verified にする（ワーカー本人は変えられない）。
GRANT SELECT, INSERT ON public.manager_verifications TO authenticated;
CREATE POLICY manager_verifications_select ON public.manager_verifications FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id() OR public.is_store_owner());
CREATE POLICY manager_verifications_insert ON public.manager_verifications FOR INSERT TO authenticated
  WITH CHECK (public.owns_store(store_id) AND public.is_my_staff(worker_id) AND verified = true);

CREATE FUNCTION public.mark_worker_verified() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE workers SET verification_status = 'verified' WHERE id = NEW.worker_id;
  RETURN NEW;
END $$;
CREATE TRIGGER mark_worker_verified AFTER INSERT ON public.manager_verifications
  FOR EACH ROW EXECUTE FUNCTION public.mark_worker_verified();

-- shift_periods: 自店のシフト期間。自店のスタッフも読める。
GRANT SELECT, INSERT ON public.shift_periods TO authenticated;
GRANT UPDATE (status) ON public.shift_periods TO authenticated;
CREATE POLICY shift_periods_select ON public.shift_periods FOR SELECT TO authenticated
  USING (public.owns_store(store_id)
    OR EXISTS (SELECT 1 FROM workers w WHERE w.user_id = auth.uid() AND w.current_store_id = store_id));
CREATE POLICY shift_periods_insert ON public.shift_periods FOR INSERT TO authenticated
  WITH CHECK (public.owns_store(store_id));
CREATE POLICY shift_periods_update ON public.shift_periods FOR UPDATE TO authenticated
  USING (public.owns_store(store_id)) WITH CHECK (public.owns_store(store_id));

-- store_join_requests: 所属登録の記録。登録したワーカー本人が作り、所属先の店舗が読む。
GRANT SELECT, INSERT ON public.store_join_requests TO authenticated;
CREATE POLICY join_requests_select ON public.store_join_requests FOR SELECT TO authenticated
  USING (public.owns_store(store_id));
CREATE POLICY join_requests_insert_self ON public.store_join_requests FOR INSERT TO authenticated
  WITH CHECK (worker_id = public.current_worker_id());

-- worker_flags: 店長からの通報。自店のスタッフについてだけ通報でき、自店の通報だけ読める・対応できる。
GRANT SELECT, INSERT ON public.worker_flags TO authenticated;
GRANT UPDATE (status, resolved_at, resolution_note) ON public.worker_flags TO authenticated;
CREATE POLICY worker_flags_select ON public.worker_flags FOR SELECT TO authenticated
  USING (public.owns_store(store_id));
CREATE POLICY worker_flags_insert ON public.worker_flags FOR INSERT TO authenticated
  WITH CHECK (public.owns_store(store_id) AND public.is_my_staff(worker_id) AND status = 'open');
CREATE POLICY worker_flags_update ON public.worker_flags FOR UPDATE TO authenticated
  USING (public.owns_store(store_id)) WITH CHECK (public.owns_store(store_id));

-- payouts: ワーカー本人と支払う店舗だけ。店舗が「支払い済み」を記録できる（作成はトリガーだけ）。
GRANT SELECT ON public.payouts TO authenticated;
GRANT UPDATE (status, marked_paid_by, paid_at) ON public.payouts TO authenticated;
CREATE POLICY payouts_select ON public.payouts FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id() OR public.owns_store(store_id));
CREATE POLICY payouts_mark_paid ON public.payouts FOR UPDATE TO authenticated
  USING (public.owns_store(store_id) AND status = 'pending')
  WITH CHECK (public.owns_store(store_id) AND status = 'paid');

-- identity_verifications: 本人は提出（審査待ちにする）だけ。審査結果を書けるのは審査担当だけ。
GRANT SELECT, INSERT ON public.identity_verifications TO authenticated;
-- worker_id は upsert（ON CONFLICT DO UPDATE）が SET 句に含めるため許可する。行の持ち主はポリシーで固定している。
GRANT UPDATE (worker_id, status, full_name_kana, birth_date, document_type, document_storage_path, provider, submitted_at,
  reviewed_at, reviewer_name, reject_reason) ON public.identity_verifications TO authenticated;
CREATE POLICY identity_select ON public.identity_verifications FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id() OR public.is_identity_reviewer());
CREATE POLICY identity_submit_insert ON public.identity_verifications FOR INSERT TO authenticated
  WITH CHECK (worker_id = public.current_worker_id() AND status = 'pending' AND provider = 'manual'
    AND reviewed_at IS NULL AND reviewer_name IS NULL AND reject_reason IS NULL
    AND split_part(document_storage_path, '/', 1) = worker_id::text);
CREATE POLICY identity_submit_update ON public.identity_verifications FOR UPDATE TO authenticated
  USING (worker_id = public.current_worker_id() AND status <> 'verified')
  WITH CHECK (worker_id = public.current_worker_id() AND status = 'pending' AND provider = 'manual'
    AND reviewed_at IS NULL AND reviewer_name IS NULL AND reject_reason IS NULL
    AND split_part(document_storage_path, '/', 1) = worker_id::text);
CREATE POLICY identity_review ON public.identity_verifications FOR UPDATE TO authenticated
  USING (public.is_identity_reviewer()) WITH CHECK (public.is_identity_reviewer());

-- worker_scout_stats: 完了したスカウト件数だけを返すビュー。店舗が他店の実績件数も見られるよう、
-- ビュー所有者の権限で集計する（件数以外の列は出さない）。
ALTER VIEW public.worker_scout_stats SET (security_invoker = false);
GRANT SELECT ON public.worker_scout_stats TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. トリガー・関数：他人の行を読む・通知を作るものは SECURITY DEFINER にする
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.prepare_scout_offer() SECURITY DEFINER;
ALTER FUNCTION public.notify_scout_event() SECURITY DEFINER;
ALTER FUNCTION public.check_scout_message() SECURITY DEFINER;
ALTER FUNCTION public.notify_chat_message() SECURITY DEFINER;
ALTER FUNCTION public.create_payout_on_attendance() SECURITY DEFINER;
ALTER FUNCTION public.check_staff_message() SECURITY DEFINER;
ALTER FUNCTION public.notify_staff_message() SECURITY DEFINER;

-- スカウトへの返信：ログイン中のワーカー本人だけが返信できる。
CREATE OR REPLACE FUNCTION public.respond_to_scout(p_scout_id UUID, p_worker_id UUID, p_status TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_scout scout_requests%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('accepted', 'rejected') THEN RAISE EXCEPTION '返信内容が不正です。'; END IF;
  IF p_worker_id IS DISTINCT FROM current_worker_id() THEN RAISE EXCEPTION 'スカウトが見つかりません。'; END IF;
  PERFORM 1 FROM workers WHERE id = p_worker_id FOR UPDATE;
  SELECT * INTO v_scout FROM scout_requests WHERE id = p_scout_id AND worker_id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'スカウトが見つかりません。'; END IF;
  IF v_scout.status = p_status THEN RETURN p_status; END IF;
  IF v_scout.status <> 'pending' THEN RAISE EXCEPTION 'このスカウトは返信済みです。'; END IF;
  IF p_status = 'accepted' THEN
    IF v_scout.store_id IS NULL THEN RAISE EXCEPTION '店舗情報が未設定です。送信元の店舗に新しいスカウトを依頼してください。'; END IF;
    IF v_scout.preferred_work_date IS NULL OR v_scout.preferred_work_date < (now() AT TIME ZONE 'Asia/Tokyo')::date
      OR v_scout.preferred_start_time IS NULL OR v_scout.preferred_end_time IS NULL THEN RAISE EXCEPTION '勤務日時を確認してください。過去のスカウトは承諾できません。'; END IF;
    IF EXISTS (SELECT 1 FROM worker_availability_slots WHERE worker_id = p_worker_id
      AND work_date = v_scout.preferred_work_date AND status IN ('assigned', 'attended')
      AND start_time < v_scout.preferred_end_time AND end_time > v_scout.preferred_start_time
      AND scout_request_id IS DISTINCT FROM p_scout_id) THEN RAISE EXCEPTION '同じ時間帯に確定済みの勤務があります。'; END IF;
    IF NOT EXISTS (SELECT 1 FROM worker_availability_slots WHERE scout_request_id = p_scout_id) THEN
      INSERT INTO worker_availability_slots(worker_id, slot_type, status, work_date, start_time, end_time, store_name, company_name, store_id, scout_request_id, hourly_wage, reviewed_at)
      VALUES (p_worker_id, 'available', 'assigned', v_scout.preferred_work_date, v_scout.preferred_start_time, v_scout.preferred_end_time, v_scout.store_name, v_scout.company_name, v_scout.store_id, p_scout_id, v_scout.offered_hourly_wage, now());
    END IF;
  END IF;
  UPDATE scout_requests SET status = p_status WHERE id = p_scout_id;
  RETURN p_status;
END $$;

-- 店舗の新規登録：ログイン中のユーザーを店舗のオーナーにする。1つのログインで1店舗まで。
DROP FUNCTION public.create_scouting_store(TEXT, TEXT, TEXT, INTEGER, TEXT);
CREATE FUNCTION public.create_scouting_store(p_company_name TEXT, p_store_name TEXT, p_area TEXT, p_hourly_wage INTEGER,
  p_terms_version TEXT, p_terms_agreed_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company UUID; v_store UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください。' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM stores WHERE owner_user_id = auth.uid()) THEN RAISE EXCEPTION 'このアカウントでは、すでに店舗を登録しています。'; END IF;
  IF char_length(btrim(p_company_name)) NOT BETWEEN 1 AND 100 OR char_length(btrim(p_store_name)) NOT BETWEEN 1 AND 100
    OR char_length(btrim(p_area)) NOT BETWEEN 1 AND 100 OR p_hourly_wage NOT BETWEEN 1 AND 999999
    OR p_company_name IS NULL OR p_store_name IS NULL OR p_area IS NULL OR p_hourly_wage IS NULL THEN
    RAISE EXCEPTION '店舗名・企業名・エリア・時給を確認してください。';
  END IF;
  IF p_terms_version IS NULL OR char_length(btrim(p_terms_version)) NOT BETWEEN 1 AND 100
    OR p_terms_agreed_at IS NULL OR p_terms_agreed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION '利用規約とプライバシーポリシーへの同意を確認してください。';
  END IF;
  INSERT INTO companies(name) VALUES (btrim(p_company_name)) RETURNING id INTO v_company;
  INSERT INTO stores(company_id, name, area, hourly_wage, owner_user_id, terms_version, terms_agreed_at)
  VALUES (v_company, btrim(p_store_name), btrim(p_area), p_hourly_wage, auth.uid(), btrim(p_terms_version), p_terms_agreed_at)
  RETURNING id INTO v_store;
  RETURN v_store;
END $$;

REVOKE EXECUTE ON FUNCTION public.respond_to_scout(UUID, UUID, TEXT) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_scouting_store(TEXT, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_scout(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_scouting_store(TEXT, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. 身分証の画像（Storage）：本人は自分のフォルダへの提出だけ、閲覧は審査担当（aal2）だけ
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "identity_documents_demo_insert" ON storage.objects;
DROP POLICY IF EXISTS "identity_documents_demo_select" ON storage.objects;
CREATE POLICY identity_documents_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'identity-documents' AND (storage.foldername(name))[1] = public.current_worker_id()::text);
CREATE POLICY identity_documents_select_reviewer ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'identity-documents' AND public.is_identity_reviewer());

COMMIT;

