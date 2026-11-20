-- scout_requests にステータス追加
alter table scout_requests add column if not exists status text not null default 'pending';
-- store_join_requests にプロフィール項目追加
alter table store_join_requests add column if not exists experience_years integer;
alter table store_join_requests add column if not exists bio text;
