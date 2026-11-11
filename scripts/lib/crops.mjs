// 找出 raw_prices 裡有、crops 表沒有的品名:新增為未歸類(不屬於任何群組),並各產生一則 new_crop 提醒
import { selectAll, upsert, insert } from "./supabase.mjs";

export async function detectNewCrops({ known } = {}) {
  const seen = await selectAll("crop_seen");
  const existing = known ?? new Set((await selectAll("crops", "select=crop_name")).map((c) => c.crop_name));
  const fresh = seen.filter((s) => !existing.has(s.crop_name)).sort((a, b) => b.qty_kg - a.qty_kg);
  if (!fresh.length) return [];
  await upsert(
    "crops",
    fresh.map((s) => ({ crop_name: s.crop_name, crop_code: s.crop_code, status: "unmapped", first_seen: s.first_seen })),
    "crop_name",
    { ignore: true },
  );
  await insert(
    "alerts",
    fresh.map((s) => ({
      type: "new_crop",
      payload: { crop_name: s.crop_name, crop_code: s.crop_code, first_seen: s.first_seen, trade_days: s.trade_days, qty_kg: s.qty_kg },
    })),
  );
  return fresh;
}
