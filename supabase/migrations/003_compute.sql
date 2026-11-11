-- 第 6 節計算規則。呼叫 select recompute_stats(); 會整批重算 crop_stats 與 group_stats。
-- 之後後台的「重算」按鈕也會呼叫這個函式。

-- A 欄(市場品名)層級的計算結果,後台與檢查用
create table if not exists crop_stats (
  crop_name       text primary key,
  calc_date       date not null,
  market_days_12m int     not null,  -- 近 12 個月成交的(日期, 市場)數
  vol_30d_kg      numeric not null,
  cur_price       numeric,           -- 現值:最近 7 個資料日的加權均價(元/公斤)
  cur_vol_daily   numeric,           -- 現值:最近 7 個資料日的日均交易量(公斤)
  med_price       numeric,           -- 基準:過去 52 週週加權均價的中位數
  med_vol_daily   numeric,           -- 基準:過去 52 週週日均交易量的中位數
  base_weeks      int     not null,  -- 基準期內有資料的週數
  eligible        boolean not null,  -- 資料足夠才判斷當季、才參與群組投票
  is_season       boolean            -- eligible = false 時為 null
);
alter table crop_stats enable row level security;

alter table group_stats add column if not exists role          text;
alter table group_stats add column if not exists window_start  date;
alter table group_stats add column if not exists cur_price_kg  numeric;  -- 群組現值(五市場合計)
alter table group_stats add column if not exists med_price_kg  numeric;  -- 群組週均價中位數
alter table group_stats add column if not exists season_share  numeric;  -- 當季 A 欄占近 30 天交易量的比例

create or replace function recompute_stats() returns jsonb
language plpgsql
set search_path = public
as $$
declare
  d        date;    -- 計算基準日:最近一個「至少 3 個市場有資料」的日期
  w_dates  date[];  -- 現值視窗:最近 7 個這樣的日期
  w_start  date;
  base_to  date;    -- 基準期:w_start 所在週之前的 52 週
  base_from date;
  n_main   int;
  n_top    int;
begin
  select max(date) into d
  from (select date from raw_prices group by date having count(distinct market) >= 3) x;
  if d is null then raise exception 'raw_prices 沒有資料'; end if;

  select array_agg(date order by date) into w_dates
  from (select date from raw_prices where date <= d
        group by date having count(distinct market) >= 3
        order by date desc limit 7) x;
  w_start   := w_dates[1];
  base_to   := date_trunc('week', w_start)::date;            -- 不含
  base_from := (date_trunc('week', w_start) - interval '52 weeks')::date;

  -- 每品名每日(跨市場合計)
  create temp table t_daily on commit drop as
  select date, crop_name, sum(qty_kg) q, sum(avg_price * qty_kg) pq
  from raw_prices where date > d - 400 and date <= d
  group by 1, 2;

  -- 每週的交易日數(用來把週交易量換成日均)
  create temp table t_wdays on commit drop as
  select date_trunc('week', date)::date wk, count(distinct date) nd
  from raw_prices where date >= base_from and date < base_to
  group by 1;

  -- 品名週序列
  create temp table t_week on commit drop as
  select crop_name, date_trunc('week', date)::date wk, sum(pq) / sum(q) price, sum(q) q
  from t_daily where date >= base_from and date < base_to
  group by 1, 2;

  delete from crop_stats;
  insert into crop_stats
  with names as (select distinct crop_name from t_daily),
  md as (select crop_name, count(*) n from raw_prices where date > d - 365 and date <= d group by 1),
  v30 as (select crop_name, sum(q) v from t_daily where date > d - 30 group by 1),
  cur as (select crop_name, sum(pq) / sum(q) price, sum(q) / array_length(w_dates, 1) vol
          from t_daily where date = any (w_dates) group by 1),
  base as (select w.crop_name,
                  percentile_cont(0.5) within group (order by w.price) mp,
                  percentile_cont(0.5) within group (order by w.q / wd.nd) mv,
                  count(*) nw
           from t_week w join t_wdays wd using (wk) group by 1)
  select n.crop_name, d,
         coalesce(md.n, 0), coalesce(v30.v, 0),
         cur.price, coalesce(cur.vol, 0),
         base.mp, base.mv, coalesce(base.nw, 0),
         coalesce(md.n, 0) >= 60 and coalesce(base.nw, 0) > 0,
         case when coalesce(md.n, 0) >= 60 and coalesce(base.nw, 0) > 0
              then coalesce(cur.price < base.mp and cur.vol > base.mv, false) end
  from names n
  left join md using (crop_name) left join v30 using (crop_name)
  left join cur using (crop_name) left join base using (crop_name);

  -- 群組:只用已歸類(mapped)的品名
  create temp table t_member on commit drop as
  select c.crop_name, c.group_id, c.role from crops c where c.status = 'mapped' and c.group_id is not null;

  delete from group_stats;
  insert into group_stats (group_id, calc_date, window_start, role, price_lo, price_hi,
                           cur_price_kg, med_price_kg, delta_pct, is_season, season_share, vol_30d_kg, rank, is_top10)
  with g as (select group_id, max(role) role from t_member group by 1),
  vote as (select m.group_id,
                  sum(cs.vol_30d_kg) filter (where cs.eligible)                 eligible_vol,
                  sum(cs.vol_30d_kg) filter (where cs.eligible and cs.is_season) season_vol,
                  sum(cs.vol_30d_kg)                                             vol30
           from t_member m join crop_stats cs using (crop_name) group by 1),
  per_mkt as (select m.group_id, r.market, sum(r.avg_price * r.qty_kg) / sum(r.qty_kg) p
              from raw_prices r join t_member m using (crop_name)
              where r.date = any (w_dates) group by 1, 2),
  rng as (select group_id, min(p) lo, max(p) hi from per_mkt group by 1),
  gcur as (select m.group_id, sum(t.pq) / sum(t.q) p
           from t_daily t join t_member m using (crop_name) where t.date = any (w_dates) group by 1),
  gweek as (select m.group_id, date_trunc('week', t.date) wk, sum(t.pq) / sum(t.q) p
            from t_daily t join t_member m using (crop_name)
            where t.date >= base_from and t.date < base_to group by 1, 2),
  gmed as (select group_id, percentile_cont(0.5) within group (order by p) p from gweek group by 1)
  select g.group_id, d, w_start, g.role,
         round(rng.lo * 0.6), round(rng.hi * 0.6),
         gcur.p, gmed.p, gcur.p / nullif(gmed.p, 0) - 1,
         case when g.role = '主食材' and coalesce(vote.eligible_vol, 0) > 0
              then coalesce(vote.season_vol, 0) / vote.eligible_vol >= 0.5 end,
         case when coalesce(vote.eligible_vol, 0) > 0 then coalesce(vote.season_vol, 0) / vote.eligible_vol end,
         coalesce(vote.vol30, 0), null, false
  from g left join vote using (group_id) left join rng using (group_id)
  left join gcur using (group_id) left join gmed using (group_id);

  -- 名次與前 10%:只在主食材群組中排
  select count(*) into n_main from group_stats where role = '主食材';
  n_top := ceil(n_main * 0.1);
  update group_stats gs set rank = x.rk, is_top10 = x.rk <= n_top
  from (select group_id, rank() over (order by vol_30d_kg desc) rk
        from group_stats where role = '主食材' and vol_30d_kg > 0) x
  where gs.group_id = x.group_id;

  return jsonb_build_object(
    'calc_date', d, 'window', to_jsonb(w_dates),
    'baseline', jsonb_build_array(base_from, base_to - 1),
    'crops', (select count(*) from crop_stats),
    'groups', (select count(*) from group_stats),
    'main_groups', n_main, 'top_n', n_top);
end;
$$;

-- 食譜當季:主食材群組當季,或食譜裡「有追蹤價格的主食材群組」一半以上當季(佐料不算)
-- 完全沒有可判斷的群組 → null(不適用)
create or replace view recipe_season with (security_invoker = true) as
with tracked as (
  select r.id recipe_id, gs.group_id, gs.is_season
  from recipes r
  join lateral (select r.main_group_id gid
                union select ri.group_id from recipe_ingredients ri where ri.recipe_id = r.id and ri.group_id is not null) x on true
  join group_stats gs on gs.group_id = x.gid
  where gs.role = '主食材' and gs.is_season is not null
)
select r.id recipe_id,
       case when ms.is_season then true
            when count(t.group_id) = 0 then null
            else count(*) filter (where t.is_season) >= count(t.group_id) / 2.0 end is_season,
       count(t.group_id) tracked_groups,
       count(*) filter (where t.is_season) season_groups
from recipes r
left join group_stats ms on ms.group_id = r.main_group_id and ms.role = '主食材'
left join tracked t on t.recipe_id = r.id
group by r.id, ms.is_season;

-- 給前台的 JSON
create or replace function export_groups_json() returns json
language sql stable set search_path = public as $$
  select json_build_object(
    'generated_at', now(),
    'data_date', (select max(calc_date) from group_stats),
    'window_start', (select max(window_start) from group_stats),
    'unit', '元/台斤',
    'groups', coalesce(json_agg(json_build_object(
        'id', g.id, 'name', g.name, 'role', gs.role,
        'price_lo', gs.price_lo, 'price_hi', gs.price_hi,
        'delta_pct', round(gs.delta_pct * 100),
        'is_season', gs.is_season,
        'vol_30d_ton', round(gs.vol_30d_kg / 1000, 1),
        'rank', gs.rank, 'is_top10', gs.is_top10,
        'recipe_count', (select count(*) from recipes r where r.active and (r.main_group_id = g.id
                          or exists (select 1 from recipe_ingredients ri where ri.recipe_id = r.id and ri.group_id = g.id))))
      order by gs.rank nulls last, gs.vol_30d_kg desc), '[]'))
  from groups g join group_stats gs on gs.group_id = g.id
  where gs.role in ('主食材', '佐料') and gs.price_lo is not null;
$$;

create or replace function export_recipes_json() returns json
language sql stable set search_path = public as $$
  select json_build_object(
    'generated_at', now(),
    'recipes', coalesce(json_agg(json_build_object(
        'id', r.id, 'name', r.name, 'main_group', mg.name,
        'is_season', rs.is_season,
        'servings_text', r.servings_text, 'equipment', r.equipment,
        'seasonings_text', r.seasonings_text, 'source_url', r.source_url,
        'ingredients', (select coalesce(json_agg(json_build_object('name', ri.name, 'qty_text', ri.qty_text, 'group', g.name) order by ri.ord), '[]')
                        from recipe_ingredients ri left join groups g on g.id = ri.group_id where ri.recipe_id = r.id))
      order by r.id), '[]'))
  from recipes r
  left join groups mg on mg.id = r.main_group_id
  left join recipe_season rs on rs.recipe_id = r.id
  where r.active;
$$;

revoke all on function recompute_stats() from anon, authenticated, public;
revoke all on function export_groups_json() from anon, authenticated, public;
revoke all on function export_recipes_json() from anon, authenticated, public;
revoke all on recipe_season from anon, authenticated;
