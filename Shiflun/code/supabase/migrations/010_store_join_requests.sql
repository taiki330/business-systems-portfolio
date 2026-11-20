create table if not exists store_join_requests (
  id uuid primary key default gen_random_uuid(),
  worker_name text not null,
  skill_tags text[] not null default '{}',
  store_name text not null,
  message text,
  status text not null default 'pending', -- pending | approved | rejected
  created_at timestamptz not null default now()
);
