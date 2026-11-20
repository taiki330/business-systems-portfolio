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
