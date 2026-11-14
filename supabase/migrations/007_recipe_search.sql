-- 自動找食譜的紀錄:同一群組 14 天內不重複搜尋,也方便看花了多少
create table if not exists recipe_searches (
  id          bigint generated always as identity primary key,
  group_id    bigint not null references groups (id) on delete cascade,
  searched_at timestamptz not null default now(),
  found       int not null default 0,
  cost_usd    numeric,
  note        text
);
create index if not exists recipe_searches_group on recipe_searches (group_id, searched_at desc);
alter table recipe_searches enable row level security;
drop policy if exists admin_read on recipe_searches;
create policy admin_read on recipe_searches for select to authenticated using (is_admin());
