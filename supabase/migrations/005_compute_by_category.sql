-- 依類別(蔬菜、海鮮…)分開計算:各類別市場的交易日不同,現值視窗、基準期、前 10% 都各自算。
-- 取代 003 的 recompute_stats(),規則不變。

alter table crop_stats  add column if not exists category text not null default '蔬菜';
alter table group_stats add column if not exists category text not null default '蔬菜';
-- 品名出現情況加上類別(新品名提醒要知道是蔬菜還是海鮮)
create or replace view crop_seen with (security_invoker = true) as
select crop_name, max(crop_code) as crop_code, min(date) as first_seen, max(date) as last_seen,
       count(distinct date) as trade_days, count(*) as market_days, sum(qty_kg) as qty_kg,
       max(category) as category
from raw_prices group by crop_name;
revoke all on crop_seen from anon, authenticated;

-- 群組是否判斷盛產(冷凍品等全年供應的設為 false)
alter table groups add column if not exists seasonal boolean not null default true;

create or replace function recompute_stats() returns jsonb
language plpgsql
set search_path = public
as $$
declare
  cat       text;
  d         date;
  w_dates   date[];
  w_start   date;
  base_to   date;
  base_from date;
  n_main    int;
  n_top     int;
  min_mkts  int;
  summary   jsonb := '{}';
begin
  delete from crop_stats;
  delete from group_stats;

  for cat in select distinct category from raw_prices order by 1 loop
    -- 「資料日」:至少 3 個市場(或該類別市場數不到 3 時,全部市場)有資料的日期
    select least(3, count(distinct market)) into min_mkts from raw_prices where category = cat;

    select max(date) into d
    from (select date from raw_prices where category = cat group by date having count(distinct market) >= min_mkts) x;
    continue when d is null;

    select array_agg(date order by date) into w_dates
    from (select date from raw_prices where category = cat and date <= d
          group by date having count(distinct market) >= min_mkts
          order by date desc limit 7) x;
    w_start   := w_dates[1];
    base_to   := date_trunc('week', w_start)::date;
    base_from := (date_trunc('week', w_start) - interval '52 weeks')::date;

    drop table if exists t_daily, t_wdays, t_week, t_member;

    create temp table t_daily as
    select date, crop_name, sum(qty_kg) q, sum(avg_price * qty_kg) pq
    from raw_prices where category = cat and date > d - 400 and date <= d
    group by 1, 2;

    create temp table t_wdays as
    select date_trunc('week', date)::date wk, count(distinct date) nd
    from raw_prices where category = cat and date >= base_from and date < base_to
    group by 1;

    create temp table t_week as
    select crop_name, date_trunc('week', date)::date wk, sum(pq) / sum(q) price, sum(q) q
    from t_daily where date >= base_from and date < base_to
    group by 1, 2;

    insert into crop_stats (crop_name, calc_date, market_days_12m, vol_30d_kg, cur_price, cur_vol_daily,
                            med_price, med_vol_daily, base_weeks, eligible, is_season, category)
    with names as (select distinct crop_name from t_daily),
    md as (select crop_name, count(*) n from raw_prices where category = cat and date > d - 365 and date <= d group by 1),
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
                then coalesce(cur.price < base.mp and cur.vol > base.mv, false) end,
           cat
    from names n
    left join md using (crop_name) left join v30 using (crop_name)
    left join cur using (crop_name) left join base using (crop_name);

    create temp table t_member as
    select c.crop_name, c.group_id, c.role
    from crops c join groups g on g.id = c.group_id
    where c.status = 'mapped' and g.category = cat;

    insert into group_stats (group_id, calc_date, window_start, role, category, price_lo, price_hi,
                             cur_price_kg, med_price_kg, delta_pct, is_season, season_share, vol_30d_kg, rank, is_top10)
    with g as (select m.group_id, max(m.role) role, bool_and(gr.seasonal) seasonal
               from t_member m join groups gr on gr.id = m.group_id group by 1),
    vote as (select m.group_id,
                    sum(cs.vol_30d_kg) filter (where cs.eligible)                 eligible_vol,
                    sum(cs.vol_30d_kg) filter (where cs.eligible and cs.is_season) season_vol,
                    sum(cs.vol_30d_kg)                                             vol30
             from t_member m join crop_stats cs using (crop_name) group by 1),
    per_mkt as (select m.group_id, r.market, sum(r.avg_price * r.qty_kg) / sum(r.qty_kg) p
                from raw_prices r join t_member m using (crop_name)
                where r.category = cat and r.date = any (w_dates) group by 1, 2),
    rng as (select group_id, min(p) lo, max(p) hi from per_mkt group by 1),
    gcur as (select m.group_id, sum(t.pq) / sum(t.q) p
             from t_daily t join t_member m using (crop_name) where t.date = any (w_dates) group by 1),
    gweek as (select m.group_id, date_trunc('week', t.date) wk, sum(t.pq) / sum(t.q) p
              from t_daily t join t_member m using (crop_name)
              where t.date >= base_from and t.date < base_to group by 1, 2),
    gmed as (select group_id, percentile_cont(0.5) within group (order by p) p from gweek group by 1),
    -- 漲跌:各品名先跟自己的一年中位數比,再依現值交易量加權平均。
    -- 不直接用群組均價比,因為品種組成改變(例如貴的品種占比變高)會讓群組均價看起來漲了
    dlt as (select m.group_id, sum(cs.cur_vol_daily * (cs.cur_price / cs.med_price - 1)) / nullif(sum(cs.cur_vol_daily), 0) dv
            from t_member m join crop_stats cs using (crop_name)
            where cs.cur_price is not null and cs.med_price > 0 and cs.cur_vol_daily > 0 group by 1)
    select g.group_id, d, w_start, g.role, cat,
           round(rng.lo * 0.6), round(rng.hi * 0.6),
           gcur.p, gmed.p, dlt.dv,
           case when g.role = '主食材' and g.seasonal and coalesce(vote.eligible_vol, 0) > 0
                then coalesce(vote.season_vol, 0) / vote.eligible_vol >= 0.5 end,
           case when coalesce(vote.eligible_vol, 0) > 0 then coalesce(vote.season_vol, 0) / vote.eligible_vol end,
           coalesce(vote.vol30, 0), null, false
    from g left join vote using (group_id) left join rng using (group_id)
    left join gcur using (group_id) left join gmed using (group_id) left join dlt using (group_id);

    select count(*) into n_main from group_stats where role = '主食材' and category = cat;
    n_top := ceil(n_main * 0.1);
    update group_stats gs set rank = x.rk, is_top10 = x.rk <= n_top
    from (select group_id, rank() over (order by vol_30d_kg desc) rk
          from group_stats where role = '主食材' and category = cat and vol_30d_kg > 0) x
    where gs.group_id = x.group_id;

    summary := summary || jsonb_build_object(cat, jsonb_build_object(
      'calc_date', d, 'window', to_jsonb(w_dates),
      'baseline', jsonb_build_array(base_from, base_to - 1),
      'crops', (select count(*) from crop_stats where category = cat),
      'groups', (select count(*) from group_stats where category = cat),
      'main_groups', n_main, 'top_n', n_top));
  end loop;

  drop table if exists t_daily, t_wdays, t_week, t_member;
  return summary;
end;
$$;

-- 前台 JSON:每個群組帶類別;各類別的資料日期另列
create or replace function export_groups_json() returns json
language sql stable set search_path = public as $$
  select json_build_object(
    'generated_at', now(),
    'data_date', (select max(calc_date) from group_stats where category = '蔬菜'),
    'window_start', (select max(window_start) from group_stats where category = '蔬菜'),
    'categories', (select json_object_agg(category, json_build_object('data_date', dd, 'window_start', ws))
                   from (select category, max(calc_date) dd, max(window_start) ws from group_stats group by 1) c),
    'unit', '元/台斤',
    'groups', coalesce(json_agg(json_build_object(
        'id', g.id, 'name', g.name, 'category', gs.category, 'role', gs.role,
        'price_lo', gs.price_lo, 'price_hi', gs.price_hi,
        'delta_pct', round(gs.delta_pct * 100),
        'is_season', gs.is_season,
        'vol_30d_ton', round(gs.vol_30d_kg / 1000, 1),
        'rank', gs.rank, 'is_top10', gs.is_top10,
        'recipe_count', (select count(*) from recipes r where r.active and (r.main_group_id = g.id
                          or exists (select 1 from recipe_ingredients ri where ri.recipe_id = r.id and ri.group_id = g.id))))
      order by gs.category, gs.rank nulls last, gs.vol_30d_kg desc), '[]'))
  from groups g join group_stats gs on gs.group_id = g.id
  where gs.role in ('主食材', '佐料') and gs.price_lo is not null;
$$;

revoke all on function recompute_stats() from anon, authenticated, public;
revoke all on function export_groups_json() from anon, authenticated, public;
