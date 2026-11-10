// 農業部農產品交易行情 API 的共用函式
export const API = "https://data.moa.gov.tw/api/v1/AgriProductsTransType/";
export const MARKETS = ["台北一", "台北二", "板橋區", "三重區", "桃農"];
export const ROW_CAP = 1000; // 單次最多回 1000 列,分頁無效

const pad = (n) => String(n).padStart(2, "0");
// Date(UTC 當地日期)→ 民國 "115.11.07"
export const toRoc = (d) => `${d.getUTCFullYear() - 1911}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
// 民國 "115.11.07" → ISO "2026-11-07"
export const rocToIso = (s) => {
  const [y, m, d] = s.split(".").map(Number);
  return `${y + 1911}-${pad(m)}-${pad(d)}`;
};
export const addDays = (d, n) => new Date(d.getTime() + n * 86400_000);
export const isoDay = (d) => d.toISOString().slice(0, 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 呼叫一次;網路錯誤、5xx、非 JSON 會重試(指數退避)
export async function fetchWindow(market, start, end, { retries = 5, timeoutMs = 60_000 } = {}) {
  const url = API + "?" + new URLSearchParams({ Start_time: toRoc(start), End_time: toRoc(end), TcType: "N04", MarketName: market });
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    if (i) await sleep(Math.min(2000 * 2 ** (i - 1), 30_000));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      const json = JSON.parse(text);
      return json.Data ?? [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`${market} ${toRoc(start)}–${toRoc(end)} 失敗:${lastErr?.message}`);
}

// 排除休市佔位列與 0 值
export const isValid = (r) =>
  r.CropName && r.CropName !== "休市" && r.CropCode !== "-" && Number(r.Trans_Quantity) > 0 && Number(r.Avg_Price) > 0;

// API 列 → raw_prices 列。同一 (日期, 市場, 品名) 出現多次時以交易量加權合併
export function toRawRows(apiRows) {
  const m = new Map();
  for (const r of apiRows.filter(isValid)) {
    const row = {
      date: rocToIso(r.TransDate),
      market: r.MarketName,
      crop_name: r.CropName, // 保留原字串(含尾端空白),才能跟對照表比對
      crop_code: r.CropCode,
      avg_price: Number(r.Avg_Price),
      upper_price: Number(r.Upper_Price),
      middle_price: Number(r.Middle_Price),
      lower_price: Number(r.Lower_Price),
      qty_kg: Number(r.Trans_Quantity),
    };
    const k = `${row.date}|${row.market}|${row.crop_name}`;
    const p = m.get(k);
    if (!p) { m.set(k, row); continue; }
    const q = p.qty_kg + row.qty_kg;
    p.avg_price = (p.avg_price * p.qty_kg + row.avg_price * row.qty_kg) / q;
    p.upper_price = Math.max(p.upper_price, row.upper_price);
    p.lower_price = Math.min(p.lower_price, row.lower_price);
    p.middle_price = (p.middle_price * p.qty_kg + row.middle_price * row.qty_kg) / q;
    p.qty_kg = q;
  }
  return [...m.values()];
}
