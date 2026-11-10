// 用 Supabase REST(PostgREST)寫入,不需要額外套件
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function assertEnv() {
  if (!URL_) throw new Error("缺少 SUPABASE_URL");
  if (!KEY) throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY(請到 GitHub repo → Settings → Secrets 設定)");
  const wrong = "SUPABASE_SERVICE_ROLE_KEY 放的是公開金鑰,寫不進資料庫。請改放 Supabase → Project Settings → API Keys 裡的 secret key(sb_secret_ 開頭)或 service_role 金鑰";
  if (KEY.startsWith("sb_publishable_")) throw new Error(wrong + "(目前是 sb_publishable_ 開頭)");
  if (KEY.startsWith("eyJ")) {
    let role;
    try { role = JSON.parse(Buffer.from(KEY.split(".")[1], "base64url").toString()).role; } catch {}
    if (role && role !== "service_role") throw new Error(`${wrong}(目前金鑰的角色是 ${role})`);
  }
}

// 開工前先試寫一筆再刪掉,確認金鑰真的有寫入權限,避免跑完整批才發現
export async function assertWritable() {
  const probe = { date: "1900-01-01", market: "__probe__", rows: 0 };
  const res = await fetch(`${URL_}/rest/v1/fetch_log?on_conflict=date,market`, {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify([probe]),
  });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 300);
    if (t.includes("row-level security")) throw new Error("金鑰沒有寫入權限(被 RLS 擋下):GitHub Secret 放的應該是公開金鑰,請改放 secret key / service_role 金鑰");
    if (t.includes("does not exist") || res.status === 404) throw new Error(`資料表不存在,請先在 SQL Editor 執行 supabase/migrations/001_init.sql:${t}`);
    throw new Error(`試寫失敗 HTTP ${res.status}:${t}`);
  }
  await fetch(`${URL_}/rest/v1/fetch_log?market=eq.__probe__`, { method: "DELETE", headers: headers() });
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
