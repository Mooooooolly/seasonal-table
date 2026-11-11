#!/usr/bin/env bash
# 重算(第 6 節)並產出前台 JSON。需要環境變數 SUPABASE_DB_URL。
set -euo pipefail
mkdir -p results public/data
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -At -c "select recompute_stats()" > results/compute-run.json
cat results/compute-run.json
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -At -c "select export_groups_json()"  | jq . > public/data/groups.json.tmp
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -At -c "select export_recipes_json()" | jq . > public/data/recipes.json.tmp
# 防呆:資料量異常(群組或食譜是 0)就不覆蓋前台檔案
g=$(jq '.groups | length' public/data/groups.json.tmp); r=$(jq '.recipes | length' public/data/recipes.json.tmp)
echo "groups=$g recipes=$r"
if [ "$g" -lt "${MIN_GROUPS:-10}" ] || [ "$r" -lt 1 ]; then
  echo "::error::產出的資料量異常(groups=$g, recipes=$r),保留舊檔"; rm -f public/data/*.tmp; exit 1
fi
mv public/data/groups.json.tmp public/data/groups.json
mv public/data/recipes.json.tmp public/data/recipes.json
