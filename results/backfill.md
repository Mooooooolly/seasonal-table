# 歷史資料補抓結果

- 執行時間(UTC):2026-11-10T04:49:31.893Z
- 範圍:2025-10-06 至 2026-11-10(400 天,3 天視窗)
- 視窗數:670,失敗:670,耗時 244 秒
- 資料庫 raw_prices 總列數:**0**
- 結論:**有部分視窗失敗,重跑一次即可補上(upsert 不會重複)**

| 市場 | API 呼叫 | 寫入列數 | 最早日期 | 最新日期 |
|---|---|---|---|---|
| 台北一 | 134 | 0 | — | — |
| 台北二 | 134 | 0 | — | — |
| 板橋區 | 134 | 0 | — | — |
| 三重區 | 134 | 0 | — | — |
| 桃農 | 134 | 0 | — | — |

## 失敗的視窗

- 台北一 2025-10-09–2025-10-11:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-10-06–2025-10-08:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-10-12–2025-10-14:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-10-15–2025-10-17:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-10-18–2025-10-20:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-10-24–2025-10-26:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-10-21–2025-10-23:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-10-27–2025-10-29:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-10-30–2025-11-01:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-11-05–2025-11-07:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-11-02–2025-11-04:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-11-08–2025-11-10:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-11-11–2025-11-13:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-11-17–2025-11-19:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-11-14–2025-11-16:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-11-20–2025-11-22:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-11-23–2025-11-25:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-11-29–2025-12-01:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-11-26–2025-11-28:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-12-08–2025-12-10:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-12-02–2025-12-04:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-12-05–2025-12-07:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-12-11–2025-12-13:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-12-20–2025-12-22:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-12-14–2025-12-16:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-12-17–2025-12-19:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-12-23–2025-12-25:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-12-29–2025-12-31:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2025-12-26–2025-12-28:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-01-04–2026-01-06:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-01-01–2026-01-03:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-01-07–2026-01-09:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-01-10–2026-01-12:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-01-19–2026-01-21:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-01-13–2026-01-15:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-01-16–2026-01-18:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-01-22–2026-01-24:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-01-31–2026-02-02:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-01-25–2026-01-27:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-01-28–2026-01-30:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-02-09–2026-02-11:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-02-03–2026-02-05:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-02-06–2026-02-08:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-02-18–2026-02-20:upsert fetch_log HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"fetch_log\""}
- 台北一 2026-02-12–2026-02-14:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-02-15–2026-02-17:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-02-24–2026-02-26:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-02-21–2026-02-23:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-02-27–2026-03-01:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
- 台北一 2026-03-02–2026-03-04:upsert raw_prices HTTP 401: {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"raw_prices\""}
