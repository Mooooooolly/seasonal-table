-- 時令食材:初始資料表(對應 HANDOFF.md 第 5 節)
-- 在 Supabase 後台 → SQL Editor 貼上整份執行一次即可。重複執行不會出錯。

-- 原始行情:一律以市場品名(A 欄 crop_name)存,群組只在計算時套用
create table if not exists raw_prices (
  date         date    not null,
  market       text    not null,
  crop_name    text    not null,
  crop_code    text,
  avg_price    numeric not null,  -- 元/公斤
  upper_price  numeric,
  middle_price numeric,
  lower_price  numeric,
  qty_kg       numeric not null,
  primary key (date, market, crop_name)
);
create index if not exists raw_prices_crop_date on raw_prices (crop_name, date);

-- 抓取紀錄:哪一天、哪個市場抓過、拿到幾列(0 = 休市或無交易)。用來分辨「沒抓」和「抓了但沒資料」
create table if not exists fetch_log (
  date       date        not null,
  market     text        not null,
  rows       int         not null,
  fetched_at timestamptz not null default now(),
  primary key (date, market)
);

-- 群組(B 欄)
create table if not exists groups (
  id   bigint generated always as identity primary key,
  name text not null unique
);

-- 市場品名(A 欄)→ 群組
create table if not exists crops (
  crop_name  text primary key,
  crop_code  text,
  group_id   bigint references groups (id),
  role       text check (role in ('主食材', '佐料', '不適用(加工品)', '不適用(非蔬菜或不明)')),
  confidence text check (confidence in ('高', '中', '低')),
  is_import  boolean not null default false,
  note       text,
  status     text not null default 'unmapped' check (status in ('mapped', 'unmapped')),
  first_seen date
);

create table if not exists recipes (
  id              text primary key,          -- 例如 R01
  name            text not null,
  main_group_id   bigint references groups (id),
  servings_text   text,
  equipment       text[] not null default '{}'
                  check (equipment <@ array['電鍋', '炒鍋', '湯鍋', '烤箱', '免開火']),
  source_url      text,
  seasonings_text text,
  notes           text,
  active          boolean not null default true
);

create table if not exists recipe_ingredients (
  recipe_id      text    not null references recipes (id) on delete cascade,
  ord            int     not null,
  name           text    not null,
  qty_text       text,
  group_id       bigint references groups (id),
  group_is_guess boolean not null default false,
  primary key (recipe_id, ord)
);

create table if not exists alerts (
  id          bigint generated always as identity primary key,
  type        text not null check (type in ('new_crop', 'unmatched_ingredient', 'job_failed', 'stale_data')),
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists alerts_open on alerts (created_at) where resolved_at is null;

-- 計算結果(第 6 節),每次重算整批覆寫
create table if not exists group_stats (
  group_id    bigint primary key references groups (id) on delete cascade,
  calc_date   date    not null,
  price_lo    int,              -- 元/台斤
  price_hi    int,
  delta_pct   numeric,          -- 相對近一年中位數
  is_season   boolean,
  vol_30d_kg  numeric,
  rank        int,
  is_top10    boolean not null default false
);

-- 全部開 RLS 且不給任何政策:目前只有 service_role(排程)能讀寫。
-- 之後做 /admin 登入時再補給登入者的政策。
alter table raw_prices         enable row level security;
alter table fetch_log          enable row level security;
alter table groups             enable row level security;
alter table crops              enable row level security;
alter table recipes            enable row level security;
alter table recipe_ingredients enable row level security;
alter table alerts             enable row level security;
alter table group_stats        enable row level security;
