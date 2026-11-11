// 匯入種子資料:mapping.csv → groups / crops,recipes.json → recipes / recipe_ingredients
// 並找出 raw_prices 裡有、對照表沒有的品名(標為未歸類 + 產生 new_crop 提醒)。
// 預設不覆蓋已存在的資料(之後在後台改過的不會被蓋掉);OVERWRITE=1 才覆蓋。
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { parseCsv } from "../lib/csv.mjs";
import { assertEnv, assertWritable, upsert, selectAll, insert, del } from "../lib/supabase.mjs";

const OVERWRITE = process.env.OVERWRITE === "1" || process.env.OVERWRITE === "true";
const DIR = new URL("../../data/seed/", import.meta.url);
const mapping = parseCsv(readFileSync(new URL("mapping.csv", DIR), "utf8"));
const recipes = JSON.parse(readFileSync(new URL("recipes.json", DIR), "utf8"));

assertEnv();
await assertWritable();

// ---- 群組 ----
const groupNames = [...new Set(mapping.map((r) => r.group_name))];
await upsert("groups", groupNames.map((name) => ({ name })), "name", { ignore: true });
const gid = Object.fromEntries((await selectAll("groups", "select=id,name")).map((g) => [g.name, g.id]));

// ---- 市場品名 ----
const seen = Object.fromEntries((await selectAll("crop_seen")).map((s) => [s.crop_name, s]));
const existing = new Set((await selectAll("crops", "select=crop_name")).map((c) => c.crop_name));
const mapped = new Set(mapping.map((r) => r.crop_name));

const cropRows = mapping.map((r) => ({
  crop_name: r.crop_name,
  crop_code: r.crop_code || null,
  group_id: gid[r.group_name],
  role: r.role,
  confidence: r.confidence || null,
  is_import: r.is_import === "是",
  note: r.note || null,
  status: "mapped",
  first_seen: seen[r.crop_name]?.first_seen ?? null,
}));
await upsert("crops", cropRows, "crop_name", { ignore: !OVERWRITE });

// 行情裡有、對照表沒有 → 未歸類,不屬於任何群組
const unmapped = Object.values(seen).filter((s) => !mapped.has(s.crop_name)).sort((a, b) => b.qty_kg - a.qty_kg);
const newUnmapped = unmapped.filter((s) => !existing.has(s.crop_name));
await upsert(
  "crops",
  newUnmapped.map((s) => ({ crop_name: s.crop_name, crop_code: s.crop_code, status: "unmapped", first_seen: s.first_seen })),
  "crop_name",
  { ignore: true },
);
await insert(
  "alerts",
  newUnmapped.map((s) => ({
    type: "new_crop",
    payload: { crop_name: s.crop_name, crop_code: s.crop_code, first_seen: s.first_seen, trade_days: s.trade_days, qty_kg: s.qty_kg },
  })),
);
const notSeen = mapping.filter((r) => !seen[r.crop_name]);

// ---- 食譜 ----
const existingRecipes = new Set((await selectAll("recipes", "select=id")).map((r) => r.id));
let wrote = 0;
for (const r of recipes) {
  if (existingRecipes.has(r.id) && !OVERWRITE) continue;
  const notes = [r.notes, r.equipment_source_text && `器材(來源原文):${r.equipment_source_text}`].filter(Boolean).join("\n");
  await upsert("recipes", [{
    id: r.id, name: r.name, main_group_id: gid[r.main_group] ?? null,
    servings_text: r.servings_text, equipment: r.equipment, source_url: r.source_url,
    seasonings_text: r.seasonings_text, notes, active: true,
  }], "id");
  await del("recipe_ingredients", `recipe_id=eq.${r.id}`);
  await insert("recipe_ingredients", r.ingredients.map((x) => ({
    recipe_id: r.id, ord: x.order, name: x.name, qty_text: x.qty_text || null,
    group_id: x.group ? gid[x.group] : null, group_is_guess: x.group_is_guess,
  })));
  wrote++;
}

// ---- 報告 ----
const roleOf = Object.fromEntries(mapping.map((r) => [r.group_name, r.role]));
const ton = (kg) => (Number(kg) / 1000).toFixed(1);
let md = `# 種子資料匯入結果\n\n- 執行時間(UTC):${new Date().toISOString()}\n- 模式:${OVERWRITE ? "覆蓋已存在的資料" : "只新增,不覆蓋已存在的資料"}\n`;
md += `- 群組:${groupNames.length} 個\n- 市場品名(對照表):${mapping.length} 個\n- 食譜:寫入 ${wrote} 道(檔案共 ${recipes.length} 道)\n`;
md += `- 行情裡出現過的品名:${Object.keys(seen).length} 個\n- **未歸類品名:${unmapped.length} 個**(本次新增提醒 ${newUnmapped.length} 則)\n`;
md += `- 對照表有、近 400 天行情沒出現:${notSeen.length} 個\n\n`;

md += `## 未歸類品名(行情有、對照表沒有)\n\n在後台處理前,這些品名不會算進任何群組。\n\n`;
md += unmapped.length
  ? `| 品名 | 代號 | 交易天數 | 總交易量(公噸) | 最早 | 最近 |\n|---|---|---|---|---|---|\n` +
    unmapped.map((s) => `| ${s.crop_name} | ${s.crop_code} | ${s.trade_days} | ${ton(s.qty_kg)} | ${s.first_seen} | ${s.last_seen} |`).join("\n") + "\n"
  : "沒有。\n";

md += `\n## 對照表有、但近 400 天行情沒出現的品名\n\n`;
md += notSeen.length ? notSeen.map((r) => `- ${JSON.stringify(r.crop_name)} → ${r.group_name}`).join("\n") + "\n" : "沒有。\n";

md += `\n## 食譜食材對應\n\n「—」= 沒有對應群組(肉、蛋、乾貨、調味品等,第一版沒有價格)。全部標為「猜測」,等後台確認。\n\n`;
for (const r of recipes) {
  md += `**${r.id} ${r.name}**(主食材:${r.main_group})\n`;
  md += r.ingredients.map((x) => `${x.name} → ${x.group ? `${x.group}${roleOf[x.group] === "佐料" ? "(佐料)" : ""}` : "—"}`).join("、") + "\n\n";
}
md += `資料整理紀錄見 \`data/seed/recipes-changes.md\`。\n`;

mkdirSync("results", { recursive: true });
writeFileSync("results/seed.md", md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
