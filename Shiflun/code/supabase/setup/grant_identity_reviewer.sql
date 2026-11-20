-- Shiflun: 審査担当（身分証の審査ができる運営アカウント）の権限を付ける・外す
--
-- 手順:
--   1. Supabase Dashboard → Authentication → Users → "Add user" で、審査担当のメールアドレスとパスワードを作る
--      （アプリの店舗用の新規登録で作ったアカウントでもよい）
--   2. 下の SQL のメールアドレスを書き換えて、SQL Editor で実行する
--   3. 審査担当は /admin/login でログインし、認証アプリ（2段階認証）を登録する
--
-- app_metadata は利用者が自分で書き換えられない場所なので、ここに役割を持たせる（user_metadata ではない）。
-- 権限の変更は、次にログインしたとき（またはログイン情報が更新されたとき）から効く。
-- 審査担当は必要最小限の人数にすること。

-- 権限を付ける
UPDATE auth.users
SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "identity_reviewer"}'::jsonb
WHERE email = 'reviewer@example.com';

-- 権限を外す（担当を外れた人がいたら、すぐに実行する）
-- UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'role' WHERE email = 'reviewer@example.com';

-- 審査担当の一覧
SELECT email, raw_app_meta_data ->> 'role' AS role, last_sign_in_at
FROM auth.users WHERE raw_app_meta_data ->> 'role' = 'identity_reviewer';
