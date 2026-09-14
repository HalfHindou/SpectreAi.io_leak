#!/usr/bin/env bash
# Spectre pre-deploy safety check
# Run BEFORE every push to main. Catches the 5 most common deploy blockers we've hit.
# Exit 0 = safe to push. Exit 1 = something needs fixing.

set +e
cd "$(dirname "$0")/.."

PASS=0
FAIL=0
WARN=0

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; WARN=$((WARN+1)); }

echo
echo "=== Spectre pre-deploy check ==="
echo

# 1. Git author email (Vercel deploy gate)
EMAIL=$(git config user.email)
if [[ "$EMAIL" == *"spectreaibot"* || "$EMAIL" == *"users.noreply.github.com"* ]]; then
  ok "Git email recognized by GitHub: $EMAIL"
else
  fail "Git email '$EMAIL' won't pass Vercel deploy gate"
  echo "    Fix: git config user.email '149329666+spectreaibot@users.noreply.github.com'"
fi

# 2. No conflict markers
CONFLICTS=$(grep -rE "^<<<<<<< HEAD|^>>>>>>> " apps/research/src apps/trading/src 2>/dev/null | wc -l | tr -d ' ')
if [ "$CONFLICTS" = "0" ]; then
  ok "No unresolved merge conflict markers"
else
  fail "$CONFLICTS lines with conflict markers — resolve before pushing"
  grep -rln "^<<<<<<< HEAD" apps/research/src apps/trading/src 2>/dev/null | head -5
fi

# 3. No accidentally-staged secrets — check filenames AND payload patterns.
# 2026-05-09: caught .env.check (Vercel CLI artifact) which the old regex missed
# because it required \.env$. Now matches .env, .env.X, .env.X.Y, *.key, etc.
SECRET_FILES=$(git diff --cached --name-only 2>/dev/null | grep -iE "(^|/)\.env($|\.)|secret|credential|\.key$|password|api[-_]?key" | head -5)
SECRET_PAYLOADS=$(git diff --cached 2>/dev/null | grep -E "(API_KEY|SECRET|PRIVATE_KEY|sk_(live|int|test|prod)_|gsk_|GROQ_API_KEY|CODEX_API_KEY)\s*=\s*[\"']\?[A-Za-z0-9_-]{20,}" | head -5)
if [ -z "$SECRET_FILES" ] && [ -z "$SECRET_PAYLOADS" ]; then
  ok "No secrets in staged files"
else
  fail "Possible secrets staged:"
  [ -n "$SECRET_FILES" ] && echo "    files:" && echo "$SECRET_FILES" | sed 's/^/      /'
  [ -n "$SECRET_PAYLOADS" ] && echo "    payloads:" && echo "$SECRET_PAYLOADS" | sed 's/^/      /' | head -3
fi

# 4. Builds pass
echo
echo "Running build:research..."
if npm run build:research > /tmp/predeploy-research.log 2>&1; then
  ok "Research app builds clean"
else
  fail "Research build failed — see /tmp/predeploy-research.log"
fi

echo "Running build:trading..."
if npm run build:trading > /tmp/predeploy-trading.log 2>&1; then
  ok "Trading app builds clean"
else
  fail "Trading build failed — see /tmp/predeploy-trading.log"
fi

# 5. Locale parity (i18n)
if [ -f "apps/research/src/i18n/locales/en.json" ]; then
  EN_KEYS=$(python3 -c "import json
def keys(d,p=''):
  ks=set()
  for k,v in d.items():
    kp=f'{p}.{k}' if p else k
    if isinstance(v,dict): ks|=keys(v,kp)
    else: ks.add(kp)
  return ks
print(len(keys(json.load(open('apps/research/src/i18n/locales/en.json')))))" 2>/dev/null)
  MISSING=0
  for L in ar es fr hi nl pt ru zh ko ja vi id de tl th pl tr uk it; do
    LK=$(python3 -c "import json
def keys(d,p=''):
  ks=set()
  for k,v in d.items():
    kp=f'{p}.{k}' if p else k
    if isinstance(v,dict): ks|=keys(v,kp)
    else: ks.add(kp)
  return ks
print(len(keys(json.load(open('apps/research/src/i18n/locales/$L.json')))))" 2>/dev/null)
    if [ "$LK" != "$EN_KEYS" ]; then
      MISSING=$((MISSING+1))
    fi
  done
  if [ "$MISSING" = "0" ]; then
    ok "All 19 non-en locales at parity ($EN_KEYS keys)"
  else
    warn "$MISSING locales out of parity with en ($EN_KEYS keys) — translation drift"
  fi
fi

# 6. Bars-pipeline parity (research <-> trading shared _lib modules)
#    + research-internal twins (server api/_lib <-> browser src/ copies)
echo
if node scripts/check-bars-parity.mjs > /tmp/predeploy-bars-parity.log 2>&1; then
  ok "Bars cascade modules + research twins in parity"
else
  fail "Bars/twin module parity drifted — see /tmp/predeploy-bars-parity.log"
  tail -14 /tmp/predeploy-bars-parity.log | sed 's/^/    /'
fi

# 7. Branch sanity
BRANCH=$(git branch --show-current)
if [ "$BRANCH" = "sunny" ]; then
  ok "On sunny branch (correct working branch)"
elif [ "$BRANCH" = "main" ]; then
  warn "On main directly — workflow rule says use sunny → main via PR/FF"
else
  warn "On $BRANCH — confirm this is intentional"
fi

# Summary
echo
echo "=== Summary ==="
echo "  Pass:  $PASS"
echo "  Warn:  $WARN"
echo "  Fail:  $FAIL"
echo

if [ "$FAIL" = "0" ]; then
  echo "Safe to push. After push: verify Vercel deployment at"
  echo "  https://vercel.com/spectre-ai/spectre-app-research/deployments"
  exit 0
else
  echo "Fix the $FAIL failure(s) above before pushing."
  exit 1
fi
