// 匯入海鮮對照表 data/seed/fish-mapping.csv → groups(類別=海鮮)與 crops
// 已在後台改過(status=mapped 且已存在)的品名不覆蓋;OVERWRITE=1 才覆蓋。
// 之前被每日排程標成「未歸類」的海鮮品名,會被這份對照表歸類,並把對應的 new_crop 提醒結案。
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { parseCsv } from "../lib/csv.mjs";
import { assertEnv, assertWritable, upsert, selectAll } from "../lib/supabase.mjs";

const OVERWRITE = process.env.OVERWRITE === "1" || process.env.OVERWRITE === "true";
const rows = parseCsv(readFileSync(new URL("../../data/seed/fish-mapping.csv", import.meta.url), "utf8"));

assertEnv();
await assertWritable();

// 群組名若與蔬菜群組相同,加註「(海鮮)」
const allGroups = await selectAll("groups", "select=id,name,category");
const vegGroupNames = new Set(allGroups.filter((g) => g.category !== "海鮮").map((g) => g.name));
const gname = (n) => (vegGroupNames.has(n) ? `${n}(海鮮)` : n);

const groupDefs = new Map();
for (const r of rows) {
  const name = gname(r.group_name);
  const seasonal = r.frozen !== "是";
  const prev = groupDefs.get(name);
  groupDefs.set(name, { name, category: "海鮮", seasonal: prev ? prev.seasonal && seasonal : seasonal });
}
await upsert("groups", [...groupDefs.values()], "name", { ignore: !OVERWRITE });
const gid = Object.fromEntries((await selectAll("groups", "select=id,name")).map((g) => [g.name, g.id]));

const existing = Object.fromEntries((await selectAll("crops", "select=crop_name,status")).map((c) => [c.crop_name, c.status]));
const seen = Object.fromEntries((await selectAll("crop_seen", "select=crop_name,first_seen")).map((s) => [s.crop_name, s.first_seen]));
const toWrite = rows
  .filter((r) => OVERWRITE || existing[r.crop_name] !== "mapped")
  .map((r) => ({
    crop_name: r.crop_name, crop_code: r.crop_code || null, category: "海鮮",
    group_id: gid[gname(r.group_name)], role: r.role, confidence: r.confidence || null,
    is_import: r.is_import === "是", note: r.note || null, status: "mapped", first_seen: seen[r.crop_name] ?? null,
  }));
await upsert("crops", toWrite, "crop_name"); // merge:未歸類的佔位列會被補上歸類

// 結案已歸類品名的 new_crop 提醒
const URL_ = process.env.SUPABASE_URL.replace(/\/$/, ""), KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: KEY, "Content-Type": "application/json", ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}) };
const openAlerts = await selectAll("alerts", "select=id,payload&type=eq.new_crop&resolved_at=is.null");
const names = new Set(toWrite.map((r) => r.crop_name));
const closeIds = openAlerts.filter((a) => names.has(a.payload?.crop_name)).map((a) => a.id);
if (closeIds.length)
  await fetch(`${URL_}/rest/v1/alerts?id=in.(${closeIds.join(",")})`, { method: "PATCH", headers: h, body: JSON.stringify({ resolved_at: new Date().toISOString() }) });

const unseen = rows.filter((r) => !seen[r.crop_name]).map((r) => r.crop_name);
let md = `# 海鮮對照表匯入結果\n\n- 執行時間(UTC):${new Date().toISOString()}\n- 模式:${OVERWRITE ? "覆蓋" : "只新增,後台改過的不覆蓋"}\n`;
md += `- 對照表:${rows.length} 個品名 → ${groupDefs.size} 個群組(其中 ${[...groupDefs.values()].filter((g) => !g.seasonal).length} 個冷凍群組不判斷盛產)\n`;
md += `- 寫入品名:${toWrite.length} 個;結案的新品名提醒:${closeIds.length} 則\n- 對照表有、行情裡沒有的品名:${unseen.length ? `${unseen.length} 個:` + unseen.slice(0, 50).join("、") + (unseen.length > 50 ? "…" : "") : "無"}\n`;
mkdirSync("results", { recursive: true });
writeFileSync("results/seed-fish.md", md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
