-- 093_remove_product_category_tree.sql
-- 092 を実行済みの場合のみ、Supabase SQL Editor で実行する。
-- 分類ツリー機能を取り消す。分類そのもの・商品との紐付け（products.category_id）は残す。

begin;

drop trigger if exists product_categories_prevent_cycle on public.product_categories;
drop function if exists public.prevent_product_category_cycle();

-- 親子関係だけを破棄する。分類名・コード・商品への既存分類は保持される。
alter table public.product_categories
  drop column if exists parent_id;

drop index if exists public.product_categories_parent_id_idx;

commit;

notify pgrst, 'reload schema';
