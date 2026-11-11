// 每日排程(HANDOFF.md 第 7 節):
// 1. 最近 7 天 × 5 市場,各發一次 1 天視窗的請求,過濾後 upsert
// 2. 新品名 → 未歸類 + new_crop 提醒
// 3.(重算與產出 JSON 由 workflow 接著用 psql 執行)
// 4. 失敗 → job_failed 提醒;最新資料距今超過 7 天 → stale_data 提醒
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { MARKETS, FISH_MARKETS, fetchWindow, fetchFishWindow, fishToCommon, toRawRows, addDays, isoDay } from "./lib/moa.mjs";
import { assertEnv, assertWritable, upsert, selectAll, insert, select } from "./lib/supabase.mjs";
import { detectNewCrops } from "./lib/crops.mjs";

const DAYS = Number(process.env.DAYS || 7);
const STALE_DAYS = 7;
const twToday = new Date(new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) + "T00:00:00Z");

assertEnv();
await assertWritable();

const failures = [];
const perMarket = {};
// 海鮮品名若與蔬菜品名相同,加註「(海鮮)」(與補資料時一致)
const vegNames = new Set((await selectAll("crops", "select=crop_name&category=eq.蔬菜")).map((c) => c.crop_name));
const SOURCES = [
  { category: "蔬菜", markets: MARKETS, fetch: fetchWindow, rename: (n) => n },
  { category: "海鮮", markets: FISH_MARKETS, fetch: async (m, s, e) => (await fetchFishWindow(m, s, e)).map(fishToCommon),
    rename: (n) => (vegNames.has(n) ? `${n}(海鮮)` : n) },
];
for (const src of SOURCES) for (const market of src.markets) {
  const key = `${src.category}・${market}`;
  perMarket[key] = { rows: 0, days: 0 };
  let down = false; // 同一市場重試後仍失敗,其餘日期就先跳過(明天會重抓),避免每天各等一分鐘
  for (let back = DAYS - 1; back >= 0; back--) {
    const day = addDays(twToday, -back);
    if (down) { failures.push({ market: key, date: isoDay(day), error: "同市場前一個請求失敗,略過" }); continue; }
    try {
      const rows = toRawRows(await src.fetch(market, day, day), { category: src.category, rename: src.rename });
      if (rows.length) await upsert("raw_prices", rows, "date,market,crop_name");
      await upsert("fetch_log", [{ date: isoDay(day), market, category: src.category, rows: rows.length }], "date,market");
      perMarket[key].rows += rows.length;
      if (rows.length) perMarket[key].days++;
    } catch (e) {
      failures.push({ market: key, date: isoDay(day), error: e.message });
      down = true;
    }
  }
}

const newCrops = await detectNewCrops();

// 最新資料日期(以蔬菜為準;海鮮另外看前台的資料日期)
const [latest] = await select("raw_prices", "select=date&category=eq.蔬菜&order=date.desc&limit=1");
const latestDate = latest?.date ?? null;
const ageDays = latestDate ? Math.round((twToday - new Date(latestDate + "T00:00:00Z")) / 86400_000) : Infinity;

// 提醒:同類型已有未處理的就不重複開;資料恢復新鮮時自動結案 stale_data
const open = await selectAll("alerts", "select=id,type&resolved_at=is.null&type=in.(job_failed,stale_data)");
const hasOpen = (t) => open.some((a) => a.type === t);
const totalCalls = Object.keys(perMarket).length * DAYS;
if (failures.length && !hasOpen("job_failed")) {
  await insert("alerts", [{ type: "job_failed", payload: { stage: "fetch", failed: failures.length, total: totalCalls, sample: failures.slice(0, 5) } }]);
}
if (ageDays > STALE_DAYS && !hasOpen("stale_data")) {
  await insert("alerts", [{ type: "stale_data", payload: { latest_date: latestDate, age_days: ageDays } }]);
}
if (ageDays <= STALE_DAYS && hasOpen("stale_data")) {
  const URL_ = process.env.SUPABASE_URL.replace(/\/$/, ""), KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: KEY, "Content-Type": "application/json", ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}) };
  await fetch(`${URL_}/rest/v1/alerts?type=eq.stale_data&resolved_at=is.null`, { method: "PATCH", headers: h, body: JSON.stringify({ resolved_at: new Date().toISOString() }) });
}

let md = `# 每日更新\n\n- 執行時間(UTC):${new Date().toISOString()}\n- 抓取範圍:${isoDay(addDays(twToday, -(DAYS - 1)))} 至 ${isoDay(twToday)}(台灣日期)\n`;
md += `- 請求失敗:${failures.length} / ${totalCalls}\n- 最新資料日期:${latestDate ?? "無"}(距今 ${ageDays} 天${ageDays > STALE_DAYS ? ",**已過期**" : ""})\n`;
md += `- 新出現的品名:${newCrops.length ? newCrops.map((c) => c.crop_name).join("、") : "無"}\n\n`;
md += `| 市場 | 有資料的天數 | 寫入列數 |\n|---|---|---|\n` + Object.entries(perMarket).map(([m, v]) => `| ${m} | ${v.days} | ${v.rows} |`).join("\n") + "\n";
if (failures.length) md += `\n## 失敗的請求\n\n` + failures.map((f) => `- ${f.market} ${f.date}:${f.error}`).join("\n") + "\n";

mkdirSync("results", { recursive: true });
writeFileSync("results/daily.md", md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
// 全部失敗才讓 job 變紅(GitHub 會寄信通知);部分失敗只記提醒,隔天重抓會補上
if (failures.length === totalCalls) process.exitCode = 1;
