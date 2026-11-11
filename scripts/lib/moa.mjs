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

// 排除休市佔位列與 0 值(蔬菜與海鮮共用)
export const isValid = (r) =>
  r.CropName && r.CropName !== "休市" && r.CropCode !== "-" && Number(r.Trans_Quantity) > 0 && Number(r.Avg_Price) > 0;

// ---- 海鮮:漁產品交易行情 ----
// 跟蔬菜不同:日期參數沒有點(1151108),欄位是 SeafoodProdName / SeafoodProdCode
export const FISH_API = "https://data.moa.gov.tw/api/v1/FisheryProductsTransType/";
export const FISH_MARKETS = ["台北", "三重", "基隆", "桃園", "新竹"];
export const toRocCompact = (d) => toRoc(d).replaceAll(".", "");
const compactToIso = (s) => {
  const t = String(s);
  return `${Number(t.slice(0, -4)) + 1911}-${t.slice(-4, -2)}-${t.slice(-2)}`;
};

export async function fetchFishWindow(market, start, end, { retries = 5, timeoutMs = 60_000 } = {}) {
  const url = FISH_API + "?" + new URLSearchParams({ Start_time: toRocCompact(start), End_time: toRocCompact(end), MarketName: market });
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    if (i) await sleep(Math.min(2000 * 2 ** (i - 1), 30_000));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      const data = JSON.parse(text).Data ?? [];
      // 防呆:若 API 忽略了市場篩選,會混進其他市場,而且可能被 1000 列上限截掉
      const other = data.find((r) => r.MarketName !== market);
      if (other) throw new Error(`市場篩選無效(要 ${market},拿到 ${other.MarketName}),停止以免資料不完整`);
      return data;
    } catch (e) {
      lastErr = e;
      if (String(e.message).includes("市場篩選無效")) break;
    }
  }
  throw new Error(`${market} ${toRocCompact(start)}–${toRocCompact(end)} 失敗:${lastErr?.message}`);
}

// 漁產 API 列 → 與蔬菜相同格式(之後用同一套合併與寫入)
export const fishToCommon = (r) => ({
  TransDate: toRoc(new Date(compactToIso(r.TransDate) + "T00:00:00Z")),
  CropName: r.SeafoodProdName, CropCode: r.SeafoodProdCode, MarketName: r.MarketName,
  Avg_Price: r.Avg_Price, Upper_Price: r.Upper_Price, Middle_Price: r.Middle_Price, Lower_Price: r.Lower_Price,
  Trans_Quantity: r.Trans_Quantity,
});

// API 列 → raw_prices 列。同一 (日期, 市場, 品名) 出現多次時以交易量加權合併
// rename:品名改寫(海鮮品名若與蔬菜品名相同,加註「(海鮮)」避免衝突)
export function toRawRows(apiRows, { category = "蔬菜", rename = (n) => n } = {}) {
  const m = new Map();
  for (const r of apiRows.filter(isValid)) {
    const row = {
      date: rocToIso(r.TransDate),
      market: r.MarketName,
      category,
      crop_name: rename(r.CropName), // 保留原字串(含尾端空白),才能跟對照表比對
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
