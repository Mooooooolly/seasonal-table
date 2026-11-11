// 讀重算結果,寫成給人看的 results/compute.md
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { assertEnv, selectAll } from "./lib/supabase.mjs";

assertEnv();
const runAll = JSON.parse(readFileSync("results/compute-run.json", "utf8"));
const run = runAll["蔬菜"] ?? runAll; // 舊格式相容
const G = JSON.parse(readFileSync("public/data/groups.json", "utf8"));
const R = JSON.parse(readFileSync("public/data/recipes.json", "utf8"));
const crops = await selectAll("crops", "select=crop_name,group_id,status");
const cs = Object.fromEntries((await selectAll("crop_stats")).map((c) => [c.crop_name, c]));

const pct = (d) => (d == null ? "—" : (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d) + "%");
const yes = (b) => (b === true ? "✅ 當季" : b === false ? "—" : "不判斷");
const ton = (kg) => (Number(kg) / 1000).toFixed(1);
// HANDOFF.md 第 6 節列出的前 10%(以使用者整理時的資料算)
const HANDOFF_TOP = ["高麗菜", "白蘿蔔", "大白菜", "玉米", "南瓜", "小黃瓜", "小白菜", "絲瓜", "紅蘿蔔", "油麥菜", "青花菜", "地瓜", "洋蔥", "番茄"];
// 原型(10/1–22 簡化算法)標為當季的
const PROTO_SEASON = ["白蘿蔔", "小白菜", "絲瓜", "油麥菜"];

const main = G.groups.filter((g) => g.role === "主食材" && (g.category ?? "蔬菜") === "蔬菜");
const top = main.filter((g) => g.is_top10);

let md = `# 重算結果\n\n## 蔬菜\n\n`;
md += `- 執行時間(UTC):${new Date().toISOString()}\n`;
md += `- 計算基準日(最近一個至少 3 個市場有資料的日期):**${run.calc_date}**\n`;
md += `- 現值視窗(最近 7 個資料日):${run.window.join("、")}\n`;
md += `- 基準期(52 週):${run.baseline[0]} 至 ${run.baseline[1]}\n`;
md += `- 主食材群組 ${run.main_groups} 個,前 10% = ${run.top_n} 個\n\n`;

md += `## 前 10%(依近 30 天交易量)\n\n| 名次 | 群組 | 近 30 天(公噸) | 價格(元/台斤) | 較一年中位數 | 當季 | 當季品名占交易量 | 食譜數 |\n|---|---|---|---|---|---|---|---|\n`;
for (const g of top) {
  const share = cropsShare(g.id);
  md += `| ${g.rank} | ${g.name} | ${g.vol_30d_ton} | ${g.price_lo}–${g.price_hi} | ${pct(g.delta_pct)} | ${yes(g.is_season)} | ${share} | ${g.recipe_count} |\n`;
}
const names = top.map((g) => g.name);
const added = names.filter((n) => !HANDOFF_TOP.includes(n)), dropped = HANDOFF_TOP.filter((n) => !names.includes(n));
md += `\n與 HANDOFF.md 的名單比較:${!added.length && !dropped.length ? "**完全相同**" : `新進 ${added.join("、") || "無"};掉出 ${dropped.join("、") || "無"}`}。\n`;
const seasonNow = top.filter((g) => g.is_season).map((g) => g.name);
md += `\n原型(10 月初簡化算法)標當季的:${PROTO_SEASON.join("、")};現在算出來當季的:${seasonNow.join("、") || "無"}。時間點不同,不一致是正常的。\n`;

md += `\n## 前 10% 各群組的品名明細\n\n當季判斷在品名層級做:現值均價 < 一年週均價中位數,**且**現值日均量 > 中位數。群組依近 30 天交易量投票。\n`;
for (const g of top) {
  const members = crops.filter((c) => c.group_id === g.id && c.status === "mapped").map((c) => cs[c.crop_name]).filter(Boolean)
    .sort((a, b) => b.vol_30d_kg - a.vol_30d_kg);
  md += `\n**${g.name}**\n\n| 品名 | 近 30 天(公噸) | 現值 元/公斤 | 中位數 | 現值日均量(公斤) | 中位數 | 判斷 |\n|---|---|---|---|---|---|---|\n`;
  for (const c of members.slice(0, 8)) {
    md += `| ${c.crop_name} | ${ton(c.vol_30d_kg)} | ${num(c.cur_price)} | ${num(c.med_price)} | ${num(c.cur_vol_daily, 0)} | ${num(c.med_vol_daily, 0)} | ${c.eligible ? yes(c.is_season) : "資料不足"} |\n`;
  }
  if (members.length > 8) md += `| …另 ${members.length - 8} 個品名 | | | | | | |\n`;
}

const otherSeason = main.filter((g) => g.is_season && !g.is_top10);
md += `\n## 其他當季的主食材群組(不在前 10%)\n\n${otherSeason.map((g) => `${g.name}(${pct(g.delta_pct)})`).join("、") || "無"}\n`;

for (const [cat, info] of Object.entries(runAll)) {
  if (cat === "蔬菜" || !info?.calc_date) continue;
  const gs = G.groups.filter((g) => g.category === cat && g.role === "主食材");
  md += `\n# ${cat}\n\n- 計算基準日:**${info.calc_date}**,現值視窗 ${info.window[0]} 至 ${info.window.at(-1)}\n- 主食材群組 ${info.main_groups} 個,前 10% = ${info.top_n} 個\n\n`;
  md += `| 名次 | 群組 | 近 30 天(公噸) | 價格(元/台斤) | 較一年中位數 | 盛產 | 前 10% |\n|---|---|---|---|---|---|---|\n`;
  for (const g of gs.slice(0, 40)) md += `| ${g.rank ?? "—"} | ${g.name} | ${g.vol_30d_ton} | ${g.price_lo}–${g.price_hi} | ${pct(g.delta_pct)} | ${yes(g.is_season)} | ${g.is_top10 ? "✔" : ""} |\n`;
}

md += `\n## 食譜當季\n\n| 食譜 | 主食材 | 當季 |\n|---|---|---|\n`;
for (const r of R.recipes) md += `| ${r.id} ${r.name} | ${r.main_group} | ${r.is_season === null ? "不適用" : yes(r.is_season)} |\n`;

mkdirSync("results", { recursive: true });
writeFileSync("results/compute.md", md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);

function num(v, digits = 1) { return v == null ? "—" : Number(v).toFixed(digits); }
function cropsShare(gid) {
  const m = crops.filter((c) => c.group_id === gid && c.status === "mapped").map((c) => cs[c.crop_name]).filter((c) => c?.eligible);
  const tot = m.reduce((s, c) => s + Number(c.vol_30d_kg), 0);
  if (!tot) return "—";
  return Math.round((m.filter((c) => c.is_season).reduce((s, c) => s + Number(c.vol_30d_kg), 0) / tot) * 100) + "%";
}
