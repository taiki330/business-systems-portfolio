-- Shiflun: スマホアプリへのプッシュ通知（端末の登録先）
-- 024 適用後に実行する。
--
--   * アプリが通知を受け取れるようになると、端末ごとの宛先（トークン）を push_tokens に保存する。
--   * app_notifications に通知が作られると、Supabase の Database Webhook が Edge Function（send-push）を呼び、
--     宛先のログインに結びつく端末へ送る。Webhook の設定は docs/mobile-release.md を参照。
--   * 利用者はトークンを直接読み書きできない。登録・解除は下の関数だけ。送信側（Edge Function）は service role で読む。
BEGIN;

CREATE TABLE public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 20 AND 4096),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_tokens_user ON public.push_tokens (user_id);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_tokens FROM anon, authenticated;

-- この端末を、ログイン中の本人の通知先にする。
-- 同じ端末で別の人がログインし直した場合は、前の人の登録を外して付け替える（前の人の通知が届かないように）。
CREATE FUNCTION public.register_push_token(p_token TEXT, p_platform TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください。' USING ERRCODE = '42501'; END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN RAISE EXCEPTION '端末の種類が不正です。'; END IF;
  IF p_token IS NULL OR char_length(p_token) NOT BETWEEN 20 AND 4096 THEN RAISE EXCEPTION '通知の登録情報が不正です。'; END IF;
  -- 1つのログインで登録できる端末は10台まで（古いものから外す）。
  DELETE FROM push_tokens WHERE id IN (
    SELECT id FROM push_tokens WHERE user_id = auth.uid() AND token <> p_token ORDER BY updated_at DESC OFFSET 9);
  INSERT INTO push_tokens(user_id, token, platform) VALUES (auth.uid(), p_token, p_platform)
  ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now();
END $$;

-- ログアウトするときに、この端末を本人の通知先から外す。
CREATE FUNCTION public.unregister_push_token(p_token TEXT) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM push_tokens WHERE token = p_token AND user_id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT), public.unregister_push_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT), public.unregister_push_token(TEXT) TO authenticated;

COMMIT;
