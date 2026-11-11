// 資料來源測試:海鮮、肉類有哪些 API 可用、欄位長什麼樣。
// 端點名稱有些是推測的,所以每個都試、把結果原樣記下來,由人判斷。
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";

const pad = (n) => String(n).padStart(2, "0");
const roc = (d) => `${d.getUTCFullYear() - 1911}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
const ago = (n) => new Date(Date.now() + 8 * 3600_000 - n * 86400_000);
const S = roc(ago(10)), E = roc(ago(3));

const rocNoDot = (d) => roc(d).replaceAll(".", "");
const S2 = rocNoDot(ago(10)), E2 = rocNoDot(ago(3));
const V1 = "https://data.moa.gov.tw/api/v1/";
// 第二輪:第一輪發現漁產與毛豬端點存在,但日期格式可能不同(毛豬回傳的 TransDate 是 1151110,沒有點)
const CANDIDATES = [
  ["蔬菜(對照組)", `${V1}AgriProductsTransType/?Start_time=${E}&End_time=${E}&TcType=N04&MarketName=台北一`],
  ["漁產:不帶參數", `${V1}FisheryProductsTransType/`],
  ["漁產:日期無點", `${V1}FisheryProductsTransType/?Start_time=${S2}&End_time=${E2}`],
  ["漁產:日期有點", `${V1}FisheryProductsTransType/?Start_time=${S}&End_time=${E}`],
  ["漁產:單日無點", `${V1}FisheryProductsTransType/?Start_time=${E2}&End_time=${E2}`],
  ["毛豬:不帶參數", `${V1}PorkTransType/`],
  ["毛豬:日期無點", `${V1}PorkTransType/?Start_time=${S2}&End_time=${E2}`],
  ["毛豬:日期無點+台北", `${V1}PorkTransType/?Start_time=${S2}&End_time=${E2}&MarketName=台北市`],
];

const out = [];
for (const [label, url] of CANDIDATES) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    let summary = "", fields = null, rows = null, sample = null, markets = null, names = null;
    try {
      const j = JSON.parse(text);
      const data = Array.isArray(j) ? j : j.Data ?? j.data ?? null;
      if (Array.isArray(data)) {
        rows = data.length; fields = data[0] ? Object.keys(data[0]) : [];
        sample = data.slice(0, 2);
        const mk = fields.find((f) => /market/i.test(f)), nm = fields.find((f) => /name/i.test(f) && f !== mk);
        if (mk) markets = [...new Set(data.map((r) => r[mk]))].slice(0, 40);
        if (nm) names = [...new Set(data.map((r) => r[nm]))];
      } else if (j.paths) {
        summary = "Swagger:" + Object.keys(j.paths).join("、");
      } else summary = "JSON:" + text.slice(0, 300);
    } catch { summary = text.slice(0, 300).replace(/\s+/g, " "); }
    out.push({ label, url, status: res.status, ms: Date.now() - t0, rows, fields, markets, nameCount: names?.length, names: names?.slice(0, 60), sample, summary });
  } catch (e) {
    out.push({ label, url, status: 0, ms: Date.now() - t0, summary: `${e.name}: ${e.message}` });
  }
}

let apiList = [];
try {
  const html = await (await fetch("https://data.moa.gov.tw/api.aspx", { signal: AbortSignal.timeout(60_000) })).text();
  apiList = [...new Set([...html.matchAll(/api\/v1\/([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
  const titles = [...html.matchAll(/<(?:h\d|a|td|li)[^>]*>([^<]{2,40}(?:行情|價格|交易)[^<]{0,20})</g)].map((m) => m[1].trim());
  apiList.push(...[...new Set(titles)].map((t) => "(標題)" + t));
} catch (e) { apiList = ["抓取失敗:" + e.message]; }

let md = `# 資料來源測試\n\n- 執行時間(UTC):${new Date().toISOString()}\n- 測試日期範圍:${S} 至 ${E}\n\n`;
md += `## api.aspx 裡找到的端點與標題\n\n${apiList.length ? apiList.join("、") : "沒找到"}\n\n`;
md += `| 項目 | HTTP | 列數 | 回應時間 |\n|---|---|---|---|\n` + out.map((o) => `| ${o.label} | ${o.status} | ${o.rows ?? "—"} | ${o.ms} ms |`).join("\n") + "\n";
for (const o of out) {
  md += `\n## ${o.label}\n\n\`${o.url}\`\n\n`;
  if (o.fields) md += `- 欄位:${o.fields.join("、")}\n`;
  if (o.markets) md += `- 市場:${o.markets.join("、")}\n`;
  if (o.names) md += `- 品名(${o.nameCount} 種,列前 60):${o.names.join("、")}\n`;
  if (o.sample?.length) md += `\n\`\`\`json\n${JSON.stringify(o.sample, null, 1)}\n\`\`\`\n`;
  if (o.summary) md += `- 回應:${o.summary}\n`;
}
mkdirSync("results", { recursive: true });
writeFileSync("results/probe-sources.md", md);
writeFileSync("results/probe-sources.json", JSON.stringify(out, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
