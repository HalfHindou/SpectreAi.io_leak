#!/bin/bash
# Credential liveness check — which keys in .env are actually still alive?
#
# WHY THIS EXISTS (2026-08-25): rotating GROQ_API_KEY turned up four credentials
# that had died silently — nothing errors loudly when a key 401s deep inside a
# provider fallback chain, it just quietly degrades. One of them (VERCEL_TOKEN)
# had been dead long enough that an operator trusted it through a whole rotation
# before discovering it. A dead key in a fallback chain is worse than an absent
# one: the gateway spends a round trip failing before moving on.
#
#   bash scripts/credential-check.sh
#
# Read-only probes only. NEVER prints a key — only the variable name and status.
# EMPTY is not necessarily a fault: several providers are optional fallbacks.
set -u
ENV_FILE="${ENV_FILE:-$(cd "$(dirname "$0")/.." && pwd)/.env}"
[ -f "$ENV_FILE" ] || { echo "no .env at $ENV_FILE"; exit 1; }
get(){ awk -F= -v k="^$1=" '$0 ~ k {sub(/^[^=]*=/,""); print; exit}' "$ENV_FILE"; }
row(){ printf "  %-26s %-7s %s\n" "$1" "$2" "${3:-}"; }
DEAD=0
probe(){ # name, curl-expression (uses $K)
  local n="$1" K; K=$(get "$n")
  if [ -z "$K" ]; then row "$n" "EMPTY" "not set"; return; fi
  local code; code=$(eval "$2" 2>/dev/null)
  case "$code" in
    200|201|204) row "$n" "OK" "HTTP $code" ;;
    429)         row "$n" "OK" "rate-limited, key valid" ;;
    401|403)     row "$n" "DEAD" "HTTP $code  <-- rotate"; DEAD=$((DEAD+1)) ;;
    000|"")      row "$n" "?" "no response" ;;
    *)           row "$n" "?" "HTTP $code" ;;
  esac
}
echo "Credential check against $ENV_FILE"
K=$(get GROQ_API_KEY);         probe GROQ_API_KEY         'curl -s -m 20 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $K" https://api.groq.com/openai/v1/models'
K=$(get CEREBRAS_API_KEY);     probe CEREBRAS_API_KEY     'curl -s -m 20 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $K" https://api.cerebras.ai/v1/models'
K=$(get OPENROUTER_API_KEY);   probe OPENROUTER_API_KEY   'curl -s -m 20 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $K" https://openrouter.ai/api/v1/key'
K=$(get OPENAI_API_KEY);       probe OPENAI_API_KEY       'curl -s -m 20 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $K" https://api.openai.com/v1/models'
K=$(get ANTHROPIC_API_KEY);    probe ANTHROPIC_API_KEY    'curl -s -m 20 -o /dev/null -w "%{http_code}" -H "x-api-key: $K" -H "anthropic-version: 2023-06-01" https://api.anthropic.com/v1/models'
K=$(get GEMINI_API_KEY);       probe GEMINI_API_KEY       'curl -s -m 20 -o /dev/null -w "%{http_code}" "https://generativelanguage.googleapis.com/v1beta/models?key=$K"'
K=$(get LENS_GEMINI_API_KEY);  probe LENS_GEMINI_API_KEY  'curl -s -m 20 -o /dev/null -w "%{http_code}" "https://generativelanguage.googleapis.com/v1beta/models?key=$K"'
K=$(get COINGECKO_API_KEY);    probe COINGECKO_API_KEY    'curl -s -m 20 -o /dev/null -w "%{http_code}" -H "x-cg-pro-api-key: $K" https://pro-api.coingecko.com/api/v3/ping'
K=$(get FINNHUB_API_KEY);      probe FINNHUB_API_KEY      'curl -s -m 20 -o /dev/null -w "%{http_code}" "https://finnhub.io/api/v1/quote?symbol=AAPL&token=$K"'
K=$(get ELEVENLABS_API_KEY);   probe ELEVENLABS_API_KEY   'curl -s -m 20 -o /dev/null -w "%{http_code}" -H "xi-api-key: $K" https://api.elevenlabs.io/v1/user'
K=$(get GITHUB_TOKEN);         probe GITHUB_TOKEN         'curl -s -m 20 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $K" https://api.github.com/user'
K=$(get TELEGRAM_BOT_TOKEN);   probe TELEGRAM_BOT_TOKEN   'curl -s -m 20 -o /dev/null -w "%{http_code}" "https://api.telegram.org/bot$K/getMe"'
K=$(get SPECTRE_API_KEY);      probe SPECTRE_API_KEY      'curl -s -m 20 -o /dev/null -w "%{http_code}" -H "X-API-Key: $K" http://204.168.244.18:3850/v1/market/global'
K=$(get KV_REST_API_TOKEN); U=$(get KV_REST_API_URL); probe KV_REST_API_TOKEN 'curl -s -m 20 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $K" "$U/ping"'
echo
[ "$DEAD" -eq 0 ] && echo "  no dead credentials" || echo "  $DEAD dead credential(s) above need rotating"
echo
echo "🪤 Rotating a key means FIVE places, not one:"
echo "   1. every local worktree .env (there are ~15; a stale one 401s silently)"
echo "   2. the box: /opt/*/.env  THEN restart the consuming pm2 procs (env is read at boot)"
echo "   3. both Vercel projects, all three environments"
echo "   4. a NEW Vercel deployment — env binds at deploy time, and a same-commit"
echo "      redeploy is skipped by scripts/vercel-ignore-build.sh (shows as CANCELED)"
echo "   5. revoke the old key, then delete any backup files holding it"
