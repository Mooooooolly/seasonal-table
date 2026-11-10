// 用 Supabase REST(PostgREST)寫入,不需要額外套件
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function assertEnv() {
  if (!URL_) throw new Error("缺少 SUPABASE_URL");
  if (!KEY) throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY(請到 GitHub repo → Settings → Secrets 設定)");
}

function headers(extra = {}) {
  const h = { apikey: KEY, "Content-Type": "application/json", ...extra };
  if (KEY.startsWith("eyJ")) h.Authorization = `Bearer ${KEY}`; // 舊版 JWT 金鑰;新版 sb_secret_ 只放 apikey
  return h;
}

export async function upsert(table, rows, onConflict, { chunk = 500 } = {}) {
  for (let i = 0; i < rows.length; i += chunk) {
    const body = JSON.stringify(rows.slice(i, i + chunk));
    let lastErr;
    for (let t = 0; t < 4; t++) {
      if (t) await new Promise((r) => setTimeout(r, 1000 * 2 ** t));
      const res = await fetch(`${URL_}/rest/v1/${table}?on_conflict=${onConflict}`, {
        method: "POST",
        headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body,
      });
      if (res.ok) { lastErr = null; break; }
      lastErr = new Error(`upsert ${table} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      if (res.status < 500 && res.status !== 429) break; // 4xx 不重試
    }
    if (lastErr) throw lastErr;
  }
}

export async function count(table, query = "") {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=*${query ? "&" + query : ""}`, {
    method: "HEAD",
    headers: headers({ Prefer: "count=exact", Range: "0-0" }),
  });
  if (!res.ok && res.status !== 206) throw new Error(`count ${table} HTTP ${res.status}`);
  return Number((res.headers.get("content-range") || "").split("/")[1]);
}

export async function select(table, query) {
  const res = await fetch(`${URL_}/rest/v1/${table}?${query}`, { headers: headers() });
  if (!res.ok) throw new Error(`select ${table} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
