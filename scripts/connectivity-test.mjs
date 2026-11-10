// 連線測試:GitHub Actions 能不能呼叫農業部農產品交易行情 API。
// 對北部 5 市場各發一次「1 天視窗」的請求,找最近一個有資料的日期。
// 結果寫到 results/connectivity.md 與 results/connectivity.json,也寫進 Actions 的 job summary。
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";

const API = "https://data.moa.gov.tw/api/v1/AgriProductsTransType/";
const MARKETS = ["台北一", "台北二", "板橋區", "三重區", "桃農"];
const TIMEOUT_MS = 60_000;

const rocDate = (d) =>
  `${d.getUTCFullYear() - 1911}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;

async function call(params) {
  const url = API + "?" + new URLSearchParams(params).toString();
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    const text = await res.text();
    const ms = Date.now() - t0;
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: res.ok && json !== null, status: res.status, ms, json, snippet: json ? null : text.slice(0, 300), url };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: `${e.name}: ${e.message}${e.cause ? " / " + e.cause.code + " " + (e.cause.message || "") : ""}`, url };
  } finally {
    clearTimeout(timer);
  }
}

const valid = (r) => r.CropName !== "休市" && r.CropCode !== "-" && Number(r.Trans_Quantity) > 0 && Number(r.Avg_Price) > 0;

const results = [];
const today = new Date();
for (const market of MARKETS) {
  let found = null;
  const attempts = [];
  // 資料約晚 4 天,從 3 天前往回找到 12 天前
  for (let back = 3; back <= 12 && !found; back++) {
    const d = new Date(today.getTime() - back * 86400_000);
    const day = rocDate(d);
    const r = await call({ Start_time: day, End_time: day, TcType: "N04", MarketName: market });
    const rows = r.json?.Data ?? [];
    const ok = rows.filter(valid);
    attempts.push({ day, status: r.status, ms: r.ms, rows: rows.length, valid: ok.length, error: r.error, snippet: r.snippet, rs: r.json?.RS });
    if (!r.ok) break; // 連線/HTTP 層失敗就不用再試其他日期
    if (ok.length) found = { day, rows: rows.length, valid: ok.length, ms: r.ms, sample: ok[0] };
  }
  results.push({ market, found, attempts });
  console.log(market, found ? `OK ${found.day} ${found.valid}/${found.rows} rows ${found.ms}ms` : "NO DATA / FAIL", JSON.stringify(attempts.at(-1)));
}

const allOk = results.every((r) => r.found);
const anyConn = results.some((r) => r.attempts.some((a) => a.status === 200));
const verdict = allOk ? "成功:5 個市場都拿到資料" : anyConn ? "部分成功:連得到,但有市場沒拿到資料" : "失敗:連不到 API";

let md = `# 連線測試結果\n\n- 執行時間(UTC):${today.toISOString()}\n- 執行環境:${process.env.GITHUB_ACTIONS ? `GitHub Actions(${process.env.RUNNER_OS} / ${process.env.RUNNER_ARCH})` : "本機"}\n- 結論:**${verdict}**\n\n`;
md += `| 市場 | 資料日期 | 有效列 / 全部列 | 回應時間 | 嘗試次數 |\n|---|---|---|---|---|\n`;
for (const r of results) {
  md += `| ${r.market} | ${r.found?.day ?? "—"} | ${r.found ? `${r.found.valid} / ${r.found.rows}` : "—"} | ${r.found ? r.found.ms + " ms" : "—"} | ${r.attempts.length} |\n`;
}
const failed = results.filter((r) => !r.found);
if (failed.length) {
  md += `\n## 失敗細節\n\n`;
  for (const r of failed) md += `- ${r.market}:\`${JSON.stringify(r.attempts.at(-1))}\`\n`;
}
const s = results.find((r) => r.found)?.found.sample;
if (s) md += `\n## 範例列\n\n\`\`\`json\n${JSON.stringify(s, null, 1)}\n\`\`\`\n`;

mkdirSync("results", { recursive: true });
writeFileSync("results/connectivity.md", md);
writeFileSync("results/connectivity.json", JSON.stringify({ ranAt: today.toISOString(), verdict, results }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log("\n" + md);
// 不讓 job 因 API 失敗而變紅,讓結果一定能被 commit 回來;判斷看 results/connectivity.md
