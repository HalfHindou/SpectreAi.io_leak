#!/bin/bash
# Spectre stack — cross-surface smoke test
#
# Exits 0 if all critical endpoints are healthy, 1 otherwise.
# Non-critical failures print a yellow [WARN] but don't fail the script.
#
# Usage:
#   bash scripts/smoke-test.sh                  # all surfaces
#   bash scripts/smoke-test.sh --no-app         # skip app.spectreai.io
#   bash scripts/smoke-test.sh --quiet          # only print failures
#
# Designed to be runnable from CI (GitHub Actions, Vercel deploy hooks) or cron.
# Set SPECTRE_API_KEY + X_DASH_API_KEY in env to skip auth-degraded probes.

set -uo pipefail

# ───────────────────────────────────────────────────────────────
# Config
# ───────────────────────────────────────────────────────────────

SPECTRE_API="${SPECTRE_API_ORIGIN:-http://204.168.244.18:3850}"
SPECTRE_KEY="${SPECTRE_API_KEY:-${SPECTRE_DATA_API_KEY:-}}"
XDASH_API="${X_DASH_API_BASE:-http://5.78.199.87:8092}"
XDASH_KEY="${X_DASH_API_KEY:-${DASHBOARD_API_KEY:-}}"
SRV="https://srv.spectreai.io"
APP="https://app.spectreai.io"

TIMEOUT="${SMOKE_TIMEOUT:-15}"
QUIET=0
SKIP_APP=0

for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    --no-app) SKIP_APP=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
  esac
done

# ───────────────────────────────────────────────────────────────
# Probe runner
# ───────────────────────────────────────────────────────────────

PASS=0
FAIL=0
WARN=0
FAILED_LINES=()

GREEN=$'\033[32m'
RED=$'\033[31m'
YELLOW=$'\033[33m'
DIM=$'\033[2m'
RESET=$'\033[0m'

probe() {
  # probe <severity> <expected_min_bytes> <name> <url> [auth_header]
  local severity="$1"
  local min_bytes="$2"
  local name="$3"
  local url="$4"
  local auth="${5:-}"

  local tmp; tmp=$(mktemp)
  local start_ms; start_ms=$(date +%s%N 2>/dev/null || echo "0")
  local code
  if [[ -n "$auth" ]]; then
    code=$(curl -sS --max-time "$TIMEOUT" -o "$tmp" -w "%{http_code}" -H "$auth" "$url" 2>/dev/null || echo "000")
  else
    code=$(curl -sS --max-time "$TIMEOUT" -o "$tmp" -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  fi
  local end_ms; end_ms=$(date +%s%N 2>/dev/null || echo "0")
  local elapsed=$(( (end_ms - start_ms) / 1000000 ))
  local bytes; bytes=$(wc -c < "$tmp" | tr -d ' ')
  rm -f "$tmp"

  local ok=0
  if [[ "$code" =~ ^2 ]] && [[ "$bytes" -ge "$min_bytes" ]]; then
    ok=1
  fi

  local label
  if [[ $ok -eq 1 ]]; then
    PASS=$((PASS + 1))
    label="${GREEN}[ OK ]${RESET}"
    [[ $QUIET -eq 1 ]] || printf '%b %s %s %s%s ms %s%db%s  %s\n' "$label" "$code" "$name" "$DIM" "$elapsed" "$DIM" "$bytes" "$RESET" "$url"
  else
    if [[ "$severity" == "critical" ]]; then
      FAIL=$((FAIL + 1))
      label="${RED}[FAIL]${RESET}"
      FAILED_LINES+=("$code  $name  $url")
    else
      WARN=$((WARN + 1))
      label="${YELLOW}[WARN]${RESET}"
    fi
    printf '%b %s %s %s%s ms %s%db%s  %s\n' "$label" "$code" "$name" "$DIM" "$elapsed" "$DIM" "$bytes" "$RESET" "$url"
  fi
}

section() { [[ $QUIET -eq 1 ]] || printf '\n%b━━━ %s%b\n' "$DIM" "$1" "$RESET"; }

# ───────────────────────────────────────────────────────────────
# 1. Spectre Data API (Hetzner direct origin)
# ───────────────────────────────────────────────────────────────

section "Spectre Data API — $SPECTRE_API"

probe critical 50    "health"                  "$SPECTRE_API/v1/health"
probe critical 200   "openapi"                 "$SPECTRE_API/openapi.json"

if [[ -n "$SPECTRE_KEY" ]]; then
  AUTH="x-api-key: $SPECTRE_KEY"
  probe critical 1000  "brain"                   "$SPECTRE_API/v1/brain" "$AUTH"
  probe critical 1000  "calendar"                "$SPECTRE_API/v1/calendar" "$AUTH"
  probe critical 1000  "categories"              "$SPECTRE_API/v1/categories" "$AUTH"
  probe critical 500   "trending"                "$SPECTRE_API/v1/trending" "$AUTH"
  probe critical 500   "intelligence/mindshare"  "$SPECTRE_API/v1/intelligence/mindshare" "$AUTH"
  probe critical 500   "social/mindshare"        "$SPECTRE_API/v1/social/mindshare" "$AUTH"
  probe critical 200   "search?q=BTC"            "$SPECTRE_API/v1/search?q=BTC" "$AUTH"
  probe critical 1000  "coins/bitcoin"           "$SPECTRE_API/v1/coins/bitcoin" "$AUTH"
  probe critical 1000  "social/search?q=bitcoin" "$SPECTRE_API/v1/social/search?q=bitcoin" "$AUTH"
  # Sentiment may legitimately return {"data":null, "status":"degraded"} (~150 bytes) when no
  # sentiment has been collected yet. Threshold 100 catches actual upstream errors.
  probe critical 100   "intelligence/sentiment/bitcoin" "$SPECTRE_API/v1/intelligence/sentiment/bitcoin" "$AUTH"
  probe critical 1000  "derivatives/composite/heatmap" "$SPECTRE_API/v1/derivatives/composite/heatmap?asset=BTC" "$AUTH"
  probe critical 500   "market/fear-greed"       "$SPECTRE_API/v1/market/fear-greed" "$AUTH"
else
  echo "${YELLOW}[WARN]${RESET} SPECTRE_API_KEY not set — skipping auth-required probes"
  WARN=$((WARN + 12))
fi

# ───────────────────────────────────────────────────────────────
# 2. X Dash (Hetzner)
# ───────────────────────────────────────────────────────────────

section "X Dash — $XDASH_API"

XAUTH="x-api-key: $XDASH_KEY"
probe critical 1000  "bootstrap"               "$XDASH_API/api/bootstrap" "$XAUTH"
probe critical 1000  "search?q=eth"            "$XDASH_API/api/search?q=eth" "$XAUTH"
probe critical 1000  "token/bitcoin"           "$XDASH_API/api/token/bitcoin" "$XAUTH"

# ───────────────────────────────────────────────────────────────
# 3. srv.spectreai.io (OVH Express monorepo)
# ───────────────────────────────────────────────────────────────

section "srv.spectreai.io"

probe critical 30    "health"                  "$SRV/api/health"
probe critical 100   "intelligence"            "$SRV/api/intelligence"
probe critical 1000  "news/rss"                "$SRV/api/news/rss"
probe critical 1000  "tokens/trending"         "$SRV/api/tokens/trending"
probe critical 1000  "coingecko/top"           "$SRV/api/coingecko/top?limit=10"
# Calendar can legitimately return {"events":[],"total":0,"source":"empty"} (~40 bytes) on
# quiet days. Lower threshold detects only true upstream errors.
probe critical 30    "calendar/economic"       "$SRV/api/calendar/economic"
probe critical 100   "calendar/analysis"       "$SRV/api/calendar/analysis"
probe critical 100   "market/fear-greed"       "$SRV/api/market/fear-greed"
probe critical 100   "convert-ids?cgid=bitcoin" "$SRV/api/convert-ids?cgid=bitcoin"
probe critical 100   "tradingview/udf/history (SPX)" "$SRV/api/tradingview/udf/history?symbol=SPX&resolution=D&from=$(($(date +%s)-2592000))&to=$(date +%s)"

# Endpoints that depend on env-var fixes still rolling out — promote to critical
# once the next OVH deploy ships. For now, warn-only so the script doesn't fail
# while the deploy is in flight.
probe warn 50        "brain"                   "$SRV/api/brain"
probe warn 100       "market/sectors"          "$SRV/api/market/sectors"
probe warn 100       "market/sectors/top-movers" "$SRV/api/market/sectors/top-movers"
probe warn 100       "x-dash/token/bitcoin"    "$SRV/api/x-dash/token/bitcoin"
probe warn 100       "x-dash/kols?timeframe=24h&sort=activity" "$SRV/api/x-dash/kols?timeframe=24h&sort=activity"
probe warn 100       "x-dash/narrative-tokens?narrative=AI%20Agents" "$SRV/api/x-dash/narrative-tokens?narrative=AI%20Agents"

# ───────────────────────────────────────────────────────────────
# 4. app.spectreai.io (research SPA)
# ───────────────────────────────────────────────────────────────

if [[ $SKIP_APP -eq 0 ]]; then
  section "app.spectreai.io"
  probe critical 1000  "index.html"            "$APP/"
fi

# ───────────────────────────────────────────────────────────────
# Summary
# ───────────────────────────────────────────────────────────────

printf '\n'
printf '%bSummary:%b %bPASS=%d%b  %bWARN=%d%b  %bFAIL=%d%b\n' \
  "$DIM" "$RESET" \
  "$GREEN" "$PASS" "$RESET" \
  "$YELLOW" "$WARN" "$RESET" \
  "$RED" "$FAIL" "$RESET"

if [[ $FAIL -gt 0 ]]; then
  printf '\n%bFailed critical endpoints:%b\n' "$RED" "$RESET"
  printf '  %s\n' "${FAILED_LINES[@]}"
  exit 1
fi
exit 0
