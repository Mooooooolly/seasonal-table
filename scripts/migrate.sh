#!/usr/bin/env bash
# 依序執行 supabase/migrations 裡全部的 SQL。每個檔案都寫成可重複執行。需要 SUPABASE_DB_URL。
set -euo pipefail
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "::error::缺少 SUPABASE_DB_URL。請到 repo → Settings → Secrets → Actions 新增(Supabase → Connect → Session pooler 的連線字串)"
  exit 1
fi
for f in supabase/migrations/*.sql; do
  echo "== $f"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
