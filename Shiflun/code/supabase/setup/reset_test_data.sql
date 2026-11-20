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
