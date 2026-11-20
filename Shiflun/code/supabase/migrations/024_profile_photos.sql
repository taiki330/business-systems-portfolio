-- Shiflun: ワーカーのプロフィール写真と、店舗の写真
-- 023 適用後に実行する。写真は任意（登録しなければ、名前の頭文字が表示される）。
--
--   * 保存先は非公開のバケット profile-photos。画面には、短時間だけ有効なURL（署名付きURL）で表示する。
--   * アップロード・削除できるのは本人のフォルダだけ（workers/{worker_id}/… と stores/{store_id}/…）。
--   * ワーカーの写真を見られるのは、本人・店舗・審査担当。店舗の写真は、ログインしていれば誰でも見られる。
--     （ワーカーのプロフィールを店舗が読めるのと同じ範囲。migration 022 の workers_select）
BEGIN;

ALTER TABLE public.workers ADD COLUMN photo_path TEXT;
ALTER TABLE public.stores ADD COLUMN photo_path TEXT;
-- 登録できるのは、自分のフォルダの中のファイルだけ。
ALTER TABLE public.workers ADD CONSTRAINT workers_photo_path_own CHECK (photo_path IS NULL OR photo_path LIKE 'workers/' || id::text || '/%');
ALTER TABLE public.stores ADD CONSTRAINT stores_photo_path_own CHECK (photo_path IS NULL OR photo_path LIKE 'stores/' || id::text || '/%');
GRANT UPDATE (photo_path) ON public.workers TO authenticated;
GRANT UPDATE (photo_path) ON public.stores TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY profile_photos_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-photos' AND (
    ((storage.foldername(name))[1] = 'workers' AND (storage.foldername(name))[2] = public.current_worker_id()::text)
    OR ((storage.foldername(name))[1] = 'stores' AND (storage.foldername(name))[2] = public.current_store_id()::text)));
CREATE POLICY profile_photos_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'profile-photos' AND (
    ((storage.foldername(name))[1] = 'workers' AND (storage.foldername(name))[2] = public.current_worker_id()::text)
    OR ((storage.foldername(name))[1] = 'stores' AND (storage.foldername(name))[2] = public.current_store_id()::text)));
CREATE POLICY profile_photos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'profile-photos' AND (
    (storage.foldername(name))[1] = 'stores'
    OR ((storage.foldername(name))[1] = 'workers'
      AND ((storage.foldername(name))[2] = public.current_worker_id()::text OR public.is_store_owner() OR public.is_identity_reviewer()))));

-- 退会した行には写真を残さない（ファイルの削除は、退会の処理が Storage API で行う）。
CREATE FUNCTION public.clear_photo_on_delete() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN NEW.photo_path := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clear_photo_on_delete BEFORE UPDATE ON public.workers FOR EACH ROW EXECUTE FUNCTION public.clear_photo_on_delete();
CREATE TRIGGER clear_photo_on_delete BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.clear_photo_on_delete();
REVOKE EXECUTE ON FUNCTION public.clear_photo_on_delete() FROM PUBLIC, anon, authenticated;

COMMIT;
