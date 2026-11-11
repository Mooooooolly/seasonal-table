// 資料來源測試:海鮮、肉類有哪些 API 可用、欄位長什麼樣。
// 端點名稱有些是推測的,所以每個都試、把結果原樣記下來,由人判斷。
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";

const pad = (n) => String(n).padStart(2, "0");
const roc = (d) => `${d.getUTCFullYear() - 1911}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
const ago = (n) => new Date(Date.now() + 8 * 3600_000 - n * 86400_000);
const S = roc(ago(10)), E = roc(ago(3));

const CANDIDATES = [
  // 對照組:已知可用的蔬菜 API
  ["蔬菜(對照組)", `https://data.moa.gov.tw/api/v1/AgriProductsTransType/?Start_time=${E}&End_time=${E}&TcType=N04&MarketName=台北一`],
  // 漁產(推測的名稱)
  ["漁產品交易行情 A", `https://data.moa.gov.tw/api/v1/FisheryProductsTransType/?Start_time=${S}&End_time=${E}`],
  ["漁產品交易行情 B", `https://data.moa.gov.tw/api/v1/AquaticTransType/?Start_time=${S}&End_time=${E}`],
  ["漁產品交易行情 C", `https://data.moa.gov.tw/api/v1/FishTransType/?Start_time=${S}&End_time=${E}`],
  // 畜產(推測的名稱)
  ["毛豬交易行情 A", `https://data.moa.gov.tw/api/v1/PorkTransType/?Start_time=${S}&End_time=${E}`],
  ["毛豬交易行情 B", `https://data.moa.gov.tw/api/v1/LivestockTransType/?Start_time=${S}&End_time=${E}`],
  ["家禽交易行情", `https://data.moa.gov.tw/api/v1/PoultryTransType/?Start_time=${S}&End_time=${E}`],
  // API 說明文件(若有,可直接看到全部端點清單)
  ["API 說明 A", `https://data.moa.gov.tw/api/v1/swagger/docs/v1`],
  ["API 說明 B", `https://data.moa.gov.tw/swagger/v1/swagger.json`],
  ["API 說明 C", `https://data.moa.gov.tw/api.aspx`],
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

let md = `# 資料來源測試\n\n- 執行時間(UTC):${new Date().toISOString()}\n- 測試日期範圍:${S} 至 ${E}\n\n`;
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
