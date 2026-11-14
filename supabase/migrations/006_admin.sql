-- 後台(/admin)需要的權限與資料表。
-- 只有 admins 表裡的帳號能透過網頁讀寫;排程用的 service_role 金鑰不受影響。

create table if not exists admins (
  user_id  uuid primary key,
  email    text,
  added_at timestamptz not null default now()
);
alter table admins enable row level security;

-- 管理者不自動指派。在 Supabase 建好帳號後,到 SQL Editor 手動加入:
--   insert into admins (user_id, email) select id, email from auth.users where email = '你的 email';

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;
revoke all on function is_admin() from public, anon;
grant execute on function is_admin() to authenticated;

-- 後台按「重算」:寫一筆請求,GitHub 排程每 20 分鐘檢查一次並執行
create table if not exists recompute_requests (
  id           bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  requested_by uuid default auth.uid(),
  note         text,
  done_at      timestamptz
);
alter table recompute_requests enable row level security;

-- 食譜審核:自動找到的食譜先是 pending、active = false;按「上架」才變 approved + active
alter table recipes add column if not exists review_status text not null default 'approved';
alter table recipes add column if not exists auto_found boolean not null default false;
alter table recipes add column if not exists created_at timestamptz not null default now();
alter table recipes drop constraint if exists recipes_review_status_check;
alter table recipes add constraint recipes_review_status_check check (review_status in ('pending', 'approved', 'rejected'));

-- 提醒類型多一種:有自動找到的食譜等審核
alter table alerts drop constraint if exists alerts_type_check;
alter table alerts add constraint alerts_type_check
  check (type in ('new_crop', 'unmatched_ingredient', 'job_failed', 'stale_data', 'recipe_draft'));

-- 管理者權限:每張表一條「管理者可讀寫」的政策(可重複執行)
do $$
declare t text;
begin
  foreach t in array array['groups', 'crops', 'recipes', 'recipe_ingredients', 'alerts', 'group_stats', 'crop_stats', 'recompute_requests'] loop
    execute format('drop policy if exists admin_all on %I', t);
    execute format('create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
  -- 行情、抓取紀錄、管理者名單:管理者只能讀
  foreach t in array array['raw_prices', 'fetch_log', 'admins'] loop
    execute format('drop policy if exists admin_read on %I', t);
    execute format('create policy admin_read on %I for select to authenticated using (is_admin())', t);
  end loop;
end $$;

-- 檢視表(security_invoker,會套用上面的政策)讓管理者讀
grant select on crop_seen, recipe_season to authenticated;
