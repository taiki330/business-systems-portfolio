-- 029_p3_2_lease_companies_is_active.sql
-- 028 適用後に Supabase SQL Editor で実行
-- Phase 3-2: リース会社マスタに is_active（有効/無効）を追加
--
-- 方針:
--   - 要件定義書 §9 Phase 3「リース会社の無効化または削除」に対応する。
--     参照中のリース会社は削除できない（借用が on delete restrict）ため、
--     運用上は is_active=false による無効化を主とする。
--   - 電話番号・担当者・FAX・メールは不要（確定事項）。列は name / note / is_active のみ。
--   - 既存行はすべて有効（true）として扱う。後方互換のため not null default true。
--   - コードレビュー指摘（Medium）: name の重複防止。
--     大文字小文字・前後空白違いの重複登録を防ぐため lower(trim(name)) の unique index を張る。
--     既存重複データがある場合は index 作成が失敗するため、適用前に確認 SQL (b) で確認すること。
--
-- 冪等性: add column if not exists / create unique index if not exists。再実行しても安全。

begin;

alter table public.lease_companies
  add column if not exists is_active boolean not null default true;

comment on column public.lease_companies.is_active is
  '有効フラグ。false=無効（新規借用の選択肢から除外。既存借用は保持）。Phase 3-2';

create index if not exists lease_companies_is_active_idx
  on public.lease_companies (is_active)
  where is_active;

create unique index if not exists lease_companies_name_unique_idx
  on public.lease_companies (lower(trim(name)));

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 適用後の確認 SQL
-- ---------------------------------------------------------------------------
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema='public' and table_name='lease_companies'
--  order by ordinal_position;
-- -- 期待: id / name / note / created_at / updated_at / is_active(boolean, NO, true)
--
-- select is_active, count(*) from public.lease_companies group by is_active;
-- -- 期待: 既存行はすべて is_active=true
--
-- -- (b) 適用前に実行推奨: 大文字小文字・空白違いの重複が無いことの確認
-- select lower(trim(name)) as key, count(*), array_agg(name) as names
--   from public.lease_companies
--  group by lower(trim(name))
-- having count(*) > 1;
-- -- 期待: 0 行（重複があれば index 作成が失敗するため、先に手動で名寄せする）

-- ---------------------------------------------------------------------------
-- ROLLBACK SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop index if exists public.lease_companies_name_unique_idx;
-- drop index if exists public.lease_companies_is_active_idx;
-- alter table public.lease_companies drop column if exists is_active;
-- commit;
-- notify pgrst, 'reload schema';
