#!/usr/bin/env bash
# Offline full historical AI factor backfill (v5.6.00)
# Requires: DATABASE_URL, PREDICTION_SERVICE_URL (or --ai-base-url), optional AI_API_KEY
set -euo pipefail
cd "$(dirname "$0")/.."
export TZ=Asia/Hong_Kong
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Starting full AI factor backfill"
python3 python/backfill_ai_factor_historical.py \
  --full \
  --start "${BACKFILL_START:-2014-12-01}" \
  --end "${BACKFILL_END:-}" \
  --rate-limit "${BACKFILL_RATE_LIMIT:-3}" \
  --source "${BACKFILL_SOURCE:-archive}" \
  "$@"
