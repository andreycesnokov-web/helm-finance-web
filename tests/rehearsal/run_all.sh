#!/usr/bin/env bash
# CFO AI V2 — clean-install rehearsal, end to end, on a DISPOSABLE local Supabase-equivalent stack (127.0.0.1 only).
# Nothing here touches staging, production, live Supabase or real email: secrets, state, logs and backups live in
# REHEARSAL_HOME (default <tmp>/cfo-rehearsal), outbound network from the app is blocked by netguard.cjs, and email
# goes to the local Mailpit inbox. Usage:  bash tests/rehearsal/run_all.sh            (full run, results in $HOME/final)
#                                           bash tests/rehearsal/run_all.sh --cleanup  (stack down + delete REHEARSAL_HOME)
set -uo pipefail
export MSYS_NO_PATHCONV=1
R="$(cd "$(dirname "$0")" && pwd)"; cd "$R"
RH="$(node env.cjs)"
if [ "${1:-}" = "--cleanup" ]; then bash stack.sh down; rm -rf "$RH"; echo "removed $RH"; exit 0; fi
OUT="$RH/final"; rm -rf "$OUT"; mkdir -p "$OUT"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/run.log"; }
PW=$(node env.cjs db_password); SK=$(node env.cjs service_key)
export DATABASE_URL="postgresql://postgres:$PW@127.0.0.1:55440/postgres"
cleanup() { kill ${APP:-} ${GWP:-} 2>/dev/null; }
trap cleanup EXIT
waitfor() { for i in $(seq 1 60); do curl -s -o /dev/null "$1" && return 0; sleep 1; done; return 1; }
ROOT="$(cd "$R/../.." && pwd)"

log "1 fresh stack"; bash stack.sh down >/dev/null; bash stack.sh up | tee -a "$OUT/run.log"; sleep 6
node gateway.cjs > "$OUT/gateway.log" 2>&1 & GWP=$!; waitfor http://127.0.0.1:55450/auth/v1/health
rm -f "$RH/state.json"

log "2 clean installation (scripts/install-v2.mjs)"
( cd "$ROOT" && node scripts/install-v2.mjs --plan > "$OUT/install-plan.txt" 2>&1; echo "plan exit $?" ) | tee -a "$OUT/run.log"
for r in install1 install2; do
  ( cd "$ROOT" && SUPABASE_URL=http://127.0.0.1:55450 SUPABASE_SECRET_KEY="$SK" node scripts/install-v2.mjs --install > "$OUT/$r.txt" 2>&1; echo "$r exit $?" ) | tee -a "$OUT/run.log"
done
( cd "$ROOT" && SUPABASE_URL=http://127.0.0.1:55450 SUPABASE_SECRET_KEY="$SK" node scripts/install-v2.mjs --verify-empty > "$OUT/verify-empty.txt" 2>&1; echo "verify-empty exit $?" ) | tee -a "$OUT/run.log"
( cd "$ROOT" && node scripts/migrate-v2.mjs --check > "$OUT/migrate-check.txt" 2>&1; echo "migrate --check exit $?" ) | tee -a "$OUT/run.log"

log "3 app (billing ON)"; node -r ./netguard.cjs app.cjs on > "$RH/app.log" 2>&1 & APP=$!; waitfor http://127.0.0.1:55460/api/health; sleep 2
for p in auth_e2e admin onboarding finance docs security; do
  s=$(date +%s); timeout 900 node $p.cjs > "$OUT/$p.txt" 2>&1; log "$p exit $? ($(( $(date +%s)-s ))s): $(grep -E '[0-9]+/[0-9]+ passed' "$OUT/$p.txt" | tail -1)"
  cp "$RH/$p.json" "$OUT/" 2>/dev/null
done
cp "$RH/app.log" "$OUT/app-billing-on.log"; kill $APP; sleep 2

log "4 app (billing OFF = paused)"; node -r ./netguard.cjs app.cjs off > "$RH/app.log" 2>&1 & APP=$!; waitfor http://127.0.0.1:55460/api/health; sleep 2
timeout 300 node billing_off.cjs > "$OUT/billing_off.txt" 2>&1; log "billing_off exit $?: $(grep -E 'passed' "$OUT/billing_off.txt" | tail -1)"; cp "$RH/billing_off.json" "$OUT/" 2>/dev/null
cp "$RH/app.log" "$OUT/app-billing-off.log"; kill $APP; APP=

log "5 backup / restore"; timeout 900 node backup.cjs > "$OUT/backup.txt" 2>&1; log "backup exit $?: $(grep -E 'passed' "$OUT/backup.txt" | tail -1)"; cp "$RH/backup.json" "$OUT/" 2>/dev/null
docker rm -f -v xr-ci-db2 xr-ci-auth2 xr-ci-storage2 >/dev/null 2>&1
grep -h "netguard" "$OUT"/app-billing-*.log | sort | uniq -c > "$OUT/egress-blocked.txt"
log "DONE — results in $OUT"
