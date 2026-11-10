// 補歷史資料:北部 5 市場 × 3 天視窗,併發 4,遇錯重試加退避(HANDOFF.md 第 7 節第 6 點)
// 可重複執行:raw_prices 用 upsert,不會重複。
// 用法:DAYS=400 node scripts/backfill.mjs
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { MARKETS, ROW_CAP, fetchWindow, toRawRows, addDays, isoDay } from "./lib/moa.mjs";
import { assertEnv, upsert, count } from "./lib/supabase.mjs";

assertEnv();
const DAYS = Number(process.env.DAYS || 400); // 52 週基準 + 現值 + 緩衝
const WINDOW = 3;
const CONCURRENCY = 4;

// 日期一律用台灣當地日曆日
const twToday = new Date(new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) + "T00:00:00Z");
const first = addDays(twToday, -DAYS);

const jobs = [];
for (const market of MARKETS)
  for (let s = first; s <= twToday; s = addDays(s, WINDOW)) {
    const e = addDays(s, WINDOW - 1);
    jobs.push({ market, start: s, end: e > twToday ? twToday : e });
  }

const t0 = Date.now();
const stats = Object.fromEntries(MARKETS.map((m) => [m, { calls: 0, rows: 0, minDate: null, maxDate: null }]));
const failures = [];
let done = 0;

async function runJob({ market, start, end }) {
  let api = await fetchWindow(market, start, end);
  stats[market].calls++;
  if (api.length >= ROW_CAP) {
    // 碰到上限:拆成 1 天視窗重抓,避免漏資料
    api = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      api.push(...(await fetchWindow(market, d, d)));
      stats[market].calls++;
    }
  }
  const rows = toRawRows(api);
  if (rows.length) await upsert("raw_prices", rows, "date,market,crop_name");

  // 抓取紀錄:視窗內每一天都記,沒資料的記 0
  const perDay = {};
  for (let d = start; d <= end; d = addDays(d, 1)) perDay[isoDay(d)] = 0;
  for (const r of rows) perDay[r.date] = (perDay[r.date] || 0) + 1;
  await upsert("fetch_log", Object.entries(perDay).map(([date, n]) => ({ date, market, rows: n })), "date,market");

  const st = stats[market];
  st.rows += rows.length;
  for (const r of rows) {
    if (!st.minDate || r.date < st.minDate) st.minDate = r.date;
    if (!st.maxDate || r.date > st.maxDate) st.maxDate = r.date;
  }
}

let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      try {
        await runJob(j);
      } catch (e) {
        failures.push({ market: j.market, start: isoDay(j.start), end: isoDay(j.end), error: e.message });
      }
      if (++done % 50 === 0) console.log(`${done}/${jobs.length} 視窗完成,${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
    }
  }),
);

const secs = ((Date.now() - t0) / 1000).toFixed(0);
const total = await count("raw_prices");

let md = `# 歷史資料補抓結果\n\n- 執行時間(UTC):${new Date().toISOString()}\n- 範圍:${isoDay(first)} 至 ${isoDay(twToday)}(${DAYS} 天,${WINDOW} 天視窗)\n- 視窗數:${jobs.length},失敗:${failures.length},耗時 ${secs} 秒\n- 資料庫 raw_prices 總列數:**${total.toLocaleString()}**\n- 結論:**${failures.length ? "有部分視窗失敗,重跑一次即可補上(upsert 不會重複)" : "全部成功"}**\n\n`;
md += `| 市場 | API 呼叫 | 寫入列數 | 最早日期 | 最新日期 |\n|---|---|---|---|---|\n`;
for (const m of MARKETS) {
  const s = stats[m];
  md += `| ${m} | ${s.calls} | ${s.rows.toLocaleString()} | ${s.minDate ?? "—"} | ${s.maxDate ?? "—"} |\n`;
}
if (failures.length) {
  md += `\n## 失敗的視窗\n\n`;
  for (const f of failures.slice(0, 50)) md += `- ${f.market} ${f.start}–${f.end}:${f.error}\n`;
}
mkdirSync("results", { recursive: true });
writeFileSync("results/backfill.md", md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log("\n" + md);
if (failures.length > jobs.length * 0.1) process.exitCode = 1; // 失敗超過一成才讓 job 變紅
