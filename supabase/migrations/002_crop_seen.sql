-- 每個市場品名在 raw_prices 的出現情況(匯入對照表、找未歸類品名、後台顯示交易量用)
-- security_invoker:照呼叫者權限讀 raw_prices,所以 RLS 一樣有效,公開金鑰讀不到
-- 先刪再建:005 會在這個檢視表加欄位,直接 create or replace 會在重跑時失敗
drop view if exists crop_seen;
create view crop_seen with (security_invoker = true) as
select
  crop_name,
  max(crop_code)       as crop_code,
  min(date)            as first_seen,
  max(date)            as last_seen,
  count(distinct date) as trade_days,
  count(*)             as market_days,
  sum(qty_kg)          as qty_kg
from raw_prices
group by crop_name;

revoke all on crop_seen from anon, authenticated;
