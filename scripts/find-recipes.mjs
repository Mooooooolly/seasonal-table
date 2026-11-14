// 自動找食譜:前 10% 的群組若「上架中 + 待審核」的食譜少於 2 道,用 Claude + 網路搜尋找台灣家常食譜,
// 存成「待審核」(不會直接上架),並在後台提醒收件匣產生一則提醒。
// 需要 ANTHROPIC_API_KEY;沒有就跳過。每次最多處理 MAX_GROUPS 個群組,同一群組 COOLDOWN_DAYS 天內不重搜。
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { assertEnv, selectAll, upsert, insert } from "./lib/supabase.mjs";

const MAX_GROUPS = Number(process.env.MAX_GROUPS || 2);
const COOLDOWN_DAYS = Number(process.env.COOLDOWN_DAYS || 14);
const TARGET = 2; // 每個群組至少要有幾道食譜
const MODEL = "claude-opus-5-5";
// 美元計價(用於報告估算):Claude Opus 5.5 每百萬 token 輸入 $4 / 輸出 $20;網路搜尋每 1000 次 $10
const PRICE = { in: 4 / 1e6, out: 20 / 1e6, search: 10 / 1000 };
const EQUIP = ["電鍋", "炒鍋", "湯鍋", "烤箱", "免開火"];

const lines = [];
const out = (s) => { lines.push(s); console.log(s); };
function finish() {
  const md = `# 自動找食譜\n\n- 執行時間(UTC):${new Date().toISOString()}\n\n${lines.join("\n")}\n`;
  mkdirSync("results", { recursive: true });
  writeFileSync("results/find-recipes.md", md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

if (!process.env.ANTHROPIC_API_KEY) {
  out("沒有設定 ANTHROPIC_API_KEY,略過自動找食譜。");
  finish();
  process.exit(0);
}
assertEnv();

// ---- 找出需要補食譜的群組 ----
const [groups, stats, recipes, ings, searches] = await Promise.all([
  selectAll("groups", "select=id,name,category,seasonal"),
  selectAll("group_stats", "select=group_id,role,rank,is_top10,category"),
  selectAll("recipes", "select=id,name,main_group_id,active,review_status,source_url"),
  selectAll("recipe_ingredients", "select=recipe_id,group_id"),
  selectAll("recipe_searches", `select=group_id,searched_at&searched_at=gte.${new Date(Date.now() - COOLDOWN_DAYS * 86400_000).toISOString()}`),
]);
const G = Object.fromEntries(groups.map((g) => [g.id, g]));
const live = recipes.filter((r) => r.active || r.review_status === "pending");
const countFor = (gid) => live.filter((r) => r.main_group_id === gid || ings.some((i) => i.recipe_id === r.id && i.group_id === gid)).length;
const recent = new Set(searches.map((s) => s.group_id));
const candidates = stats
  .filter((s) => s.is_top10 && s.role === "主食材" && G[s.group_id]?.seasonal !== false) // 冷凍群組跳過,鮮品群組會找
  .filter((s) => !recent.has(s.group_id) && countFor(s.group_id) < TARGET)
  .sort((a, b) => (a.category === "蔬菜" ? 0 : 1) - (b.category === "蔬菜" ? 0 : 1) || a.rank - b.rank);
out(`前 10% 中食譜不足 ${TARGET} 道、且 ${COOLDOWN_DAYS} 天內沒搜過的群組:${candidates.length} 個;這次處理 ${Math.min(MAX_GROUPS, candidates.length)} 個。\n`);

const client = new Anthropic();
const knownUrls = new Set(recipes.map((r) => r.source_url).filter(Boolean));
let nextId = Math.max(0, ...recipes.map((r) => +(r.id.match(/\d+/)?.[0] || 0))) + 1;
let totalCost = 0;

// 第二步用的格式
const RecipeSchema = z.object({
  recipes: z.array(z.object({
    name: z.string(),
    source_url: z.string(),
    servings_text: z.string(),
    equipment: z.array(z.enum(EQUIP)),
    ingredients: z.array(z.object({ name: z.string(), qty_text: z.string() })),
    seasonings_text: z.string(),
    notes: z.string(),
  })),
});

const usageCost = (u) => {
  const searchesN = u?.server_tool_use?.web_search_requests ?? 0;
  return (u?.input_tokens ?? 0) * PRICE.in + (u?.cache_read_input_tokens ?? 0) * PRICE.in * 0.1 +
    (u?.cache_creation_input_tokens ?? 0) * PRICE.in * 1.25 + (u?.output_tokens ?? 0) * PRICE.out + searchesN * PRICE.search;
};

for (const s of candidates.slice(0, MAX_GROUPS)) {
  const g = G[s.group_id];
  const need = TARGET - countFor(g.id);
  const have = live.filter((r) => r.main_group_id === g.id).map((r) => r.name);
  out(`## ${g.name}(${g.category},第 ${s.rank} 名)`);
  let cost = 0, found = 0, note = "";
  try {
    // ---- 第一步:搜尋與閱讀(伺服器端網路工具)----
    const messages = [{
      role: "user",
      content: `請幫我找 ${need} 道以「${g.name}」為主食材的台灣家常食譜,來源優先選台灣的食譜網站或媒體(例如愛料理、早安健康、TVBS 健康、各大媒體的料理專欄)。
條件:
- 家裡用電鍋、炒鍋、湯鍋、烤箱或不開火就能做。
- 我已經有這些,請不要重複:${have.length ? have.join("、") : "(無)"}。也不要用這些網址:${[...knownUrls].slice(0, 40).join(" ") || "(無)"}
- 每道請實際打開網頁確認,只記錄網頁上真的寫的內容,不要自己補份量;網頁沒寫的就寫「未標示」。不要記錄作法步驟。
每道請列出:菜名、原網址、份數、需要的器材、食材與份量(每項一行)、佐料與份量、備註(例如份量看起來有誤、需要特殊器材)。`,
    }];
    let res;
    for (let turn = 0; turn < 4; turn++) {
      res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "TW" } },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
        ],
        messages,
      });
      cost += usageCost(res.usage);
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content }); // 伺服器端工具還沒做完,原樣送回讓它繼續
    }
    if (res.stop_reason === "refusal") throw new Error(`模型拒絕(${res.stop_details?.category ?? "未說明"})`);
    const findings = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (!findings.trim()) throw new Error("搜尋沒有產生內容");

    // ---- 第二步:整理成固定格式(結構化輸出)----
    const parsed = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { format: betaZodOutputFormat(RecipeSchema) },
      messages: [{
        role: "user",
        content: `把下面的食譜整理成指定格式。只用下面寫的內容,不要補資料;沒寫的欄位填「未標示」,器材只能從 ${EQUIP.join("、")} 選(沒有寫就給空陣列)。原網址要完整保留。\n\n${findings}`,
      }],
    });
    cost += usageCost(parsed.usage);
    if (parsed.stop_reason === "refusal") throw new Error("整理時模型拒絕");
    const list = parsed.parsed_output?.recipes ?? [];

    // ---- 寫入:待審核、不上架 ----
    const today = new Date().toISOString().slice(0, 10);
    const groupNames = groups.filter((x) => x.category === g.category || x.category === "蔬菜").sort((a, b) => b.name.length - a.name.length);
    const ids = [];
    for (const r of list) {
      if (!/^https?:\/\//.test(r.source_url) || knownUrls.has(r.source_url)) { out(`- 略過「${r.name}」:網址無效或重複`); continue; }
      const id = "R" + String(nextId++).padStart(2, "0");
      await upsert("recipes", [{
        id, name: r.name, main_group_id: g.id, servings_text: r.servings_text, equipment: r.equipment,
        source_url: r.source_url, seasonings_text: r.seasonings_text,
        notes: [`${today} 自動找到,請對照原網址確認`, r.notes].filter(Boolean).join(";"),
        active: false, review_status: "pending", auto_found: true,
      }], "id");
      // 食材 → 群組:名稱裡包含哪個群組名就對到(取最長的),一律標為猜測
      await insert("recipe_ingredients", r.ingredients.map((x, k) => {
        const hit = groupNames.find((gg) => x.name.includes(gg.name));
        return { recipe_id: id, ord: k + 1, name: x.name, qty_text: x.qty_text, group_id: hit?.id ?? null, group_is_guess: true };
      }));
      knownUrls.add(r.source_url);
      ids.push(id);
      out(`- ${id} ${r.name}:${r.source_url}(${r.ingredients.length} 項食材)`);
    }
    found = ids.length;
    if (ids.length) await insert("alerts", [{ type: "recipe_draft", payload: { group: g.name, group_id: g.id, recipe_ids: ids } }]);
    if (!ids.length) out("- 沒有找到可用的食譜");
  } catch (e) {
    note = e instanceof Anthropic.APIError ? `API 錯誤 ${e.status}:${e.message}` : e.message;
    out(`- 失敗:${note}`);
  }
  await insert("recipe_searches", [{ group_id: g.id, found, cost_usd: +cost.toFixed(4), note: note || null }]);
  totalCost += cost;
  out(`- 估計花費:US$${cost.toFixed(3)}\n`);
}
out(`本次估計總花費:US$${totalCost.toFixed(3)}`);
finish();
