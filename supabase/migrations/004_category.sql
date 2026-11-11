-- 類別欄位:為之後加入海鮮、肉類預留。現有資料全部是「蔬菜」。
-- 主鍵暫不改;加入新類別時,若品名或市場名與蔬菜重複,再一併調整。
alter table raw_prices add column if not exists category text not null default '蔬菜';
alter table fetch_log  add column if not exists category text not null default '蔬菜';
alter table crops      add column if not exists category text not null default '蔬菜';
alter table groups     add column if not exists category text not null default '蔬菜';
