// 一次性整理 recipes.original.json → recipes.json,並把每個改動寫進 recipes-changes.md 供人檢查。
// 用法:node scripts/seed/clean-recipes.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "../lib/csv.mjs";

const DIR = new URL("../../data/seed/", import.meta.url);
const src = JSON.parse(readFileSync(new URL("recipes.original.json", DIR), "utf8"));
const groups = new Set(parseCsv(readFileSync(new URL("mapping.csv", DIR), "utf8")).map((r) => r.group_name));

// 食材名稱 → 群組。只列原檔沒對到、但應該對到的;原檔已對到的保留
const GROUP_BY_NAME = {
  // 佐料:只供查價,不算當季
  蒜碎: "蒜頭", 蒜頭: "蒜頭", 蒜: "蒜頭", 大蒜: "蒜頭", 蒜瓣: "蒜頭",
  老薑: "薑", 生薑: "薑", 薑: "薑", 薑絲: "薑",
  蔥花: "蔥", 蔥: "蔥", 蔥白: "蔥",
  辣椒: "辣椒",
  香菜或芹菜珠: "香菜",
  洋香菜: "巴西利",
  // 主食材
  洋蔥: "洋蔥",
  紅椒丁: "彩椒",
  鴻禧菇: "鴻喜菇",
};
// 刻意不對應(乾貨或加工品,市場資料是鮮品):乾香菇、冬菇（已泡）、乾辣椒段、大乾蝦米、菜脯碎…
for (const g of new Set(Object.values(GROUP_BY_NAME)))
  if (!groups.has(g)) throw new Error(`對照表沒有群組「${g}」`);

const changes = [];
const log = (r, msg) => changes.push(`- **${r.id} ${r.name}**:${msg}`);

const out = src.map((r) => {
  let ings = r.ingredients.map((x) => ({ ...x }));

  // 1. 被逗號拆成兩列的「(推定,來源寫 Ng)」合併回一列
  for (let i = 0; i < ings.length - 1; i++) {
    const a = ings[i], b = ings[i + 1];
    if (a.qty_text.includes("（推定") && !a.qty_text.includes("）") && b.name === "來源寫") {
      const merged = `${a.qty_text}，來源寫 ${b.qty_text}`;
      log(r, `合併拆開的列:「${a.name} ${a.qty_text}」+「${b.name} ${b.qty_text}」→「${a.name} ${merged}」`);
      a.qty_text = merged;
      ings.splice(i + 1, 1);
    }
  }

  // 2. 份量寫在名稱裡、份量欄空白 → 拆開
  for (const x of ings) {
    if (x.qty_text) continue;
    const m = x.name.match(/^(.*[）)])\s*(\d[\d.\/~–-]*\s*\S+)$/);
    if (m) {
      log(r, `名稱與份量拆開:「${x.name}」→ 名稱「${m[1]}」、份量「${m[2]}」`);
      x.name = m[1]; x.qty_text = m[2];
    } else {
      const opt = x.name.match(/^(.*?)（可省略）$/);
      if (opt) {
        log(r, `名稱與份量拆開:「${x.name}」→ 名稱「${opt[1]}」、份量「未標示（可省略）」`);
        x.name = opt[1]; x.qty_text = "未標示（可省略）";
      }
    }
  }

  // 3. 補對應群組
  for (const x of ings) {
    const g = GROUP_BY_NAME[x.name];
    if (!x.group && g) {
      log(r, `「${x.name}」對應到群組「${g}」`);
      x.group = g;
    }
  }

  ings = ings.map((x, i) => ({ order: i + 1, name: x.name, qty_text: x.qty_text, group: x.group, group_is_guess: true }));
  if (!r.equipment.length) log(r, "來源沒有器材資訊,維持空白(前台顯示「器材未確認」)");

  return {
    id: r.id, name: r.name, main_group: r.main_group,
    servings_text: r.servings_text, equipment: r.equipment,
    equipment_source_text: r.equipment_source_text,
    seasonings_text: r.seasonings_text, source_url: r.source_url, notes: r.notes,
    ingredients: ings,
  };
});

writeFileSync(new URL("recipes.json", DIR), JSON.stringify(out, null, 1) + "\n");
writeFileSync(
  new URL("recipes-changes.md", DIR),
  `# 食譜整理紀錄\n\n由 \`scripts/seed/clean-recipes.mjs\` 從 \`recipes.original.json\` 產生 \`recipes.json\`。所有食材的群組對應仍標為「猜測」,等後台確認。\n\n${changes.join("\n")}\n`,
);
console.log(changes.join("\n"));
