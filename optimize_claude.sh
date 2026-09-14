#!/bin/bash
# ============================================================
# SPECTRE AI — Claude Code Context Optimizer
# Run from your Spectre project root: bash optimize_claude.sh
# ============================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}  SPECTRE AI — Context Optimizer${NC}"
echo -e "  ─────────────────────────────────"
echo ""

# ── 1. ARCHIVE OLD TRANSCRIPTS ────────────────────────────────
echo -e "${CYAN}[1/5]${NC} Archiving old transcripts..."

TRANSCRIPT_DIR=".claude/transcripts"
ARCHIVE_DIR=".claude/transcripts/archive"
CUTOFF_DAYS=7

if [ -d "$TRANSCRIPT_DIR" ]; then
  mkdir -p "$ARCHIVE_DIR"
  ARCHIVED=0
  for f in "$TRANSCRIPT_DIR"/*.txt "$TRANSCRIPT_DIR"/*.json; do
    [ -f "$f" ] || continue
    filename=$(basename "$f")
    # skip journal and already-archived files
    [[ "$filename" == "journal.txt" ]] && continue
    # check if older than cutoff
    if [ $(find "$f" -mtime +$CUTOFF_DAYS 2>/dev/null | wc -l) -gt 0 ]; then
      mv "$f" "$ARCHIVE_DIR/$filename"
      ARCHIVED=$((ARCHIVED + 1))
      echo -e "   ${YELLOW}→${NC} archived: $filename"
    fi
  done
  echo -e "   ${GREEN}✓${NC} $ARCHIVED transcript(s) archived (older than ${CUTOFF_DAYS}d)"
else
  echo -e "   ${YELLOW}⚠${NC}  $TRANSCRIPT_DIR not found — skipping"
fi

# ── 2. MEASURE CONTEXT SIZE ───────────────────────────────────
echo ""
echo -e "${CYAN}[2/5]${NC} Measuring active context..."

ACTIVE_SIZE=0
if [ -d "$TRANSCRIPT_DIR" ]; then
  ACTIVE_SIZE=$(du -sk "$TRANSCRIPT_DIR" --exclude="$ARCHIVE_DIR" 2>/dev/null | awk '{print $1}')
fi
PROJECT_SIZE=$(du -sk ".claude" 2>/dev/null | awk '{print $1}')

echo -e "   Active transcripts: ${BOLD}${ACTIVE_SIZE}KB${NC}"
echo -e "   Total .claude dir:  ${BOLD}${PROJECT_SIZE}KB${NC}"

if [ "$ACTIVE_SIZE" -gt 500 ]; then
  echo -e "   ${RED}⚠  Still heavy. Consider archiving more aggressively.${NC}"
else
  echo -e "   ${GREEN}✓${NC} Context weight looks good"
fi

# ── 3. DETECT DEAD CSS ────────────────────────────────────────
echo ""
echo -e "${CYAN}[3/5]${NC} Scanning for dead CSS candidates..."

CSS_FILES=$(find src -name "*.css" 2>/dev/null | wc -l)
LARGE_CSS=$(find src -name "*.css" -size +50k 2>/dev/null)

echo -e "   Total CSS files: ${BOLD}${CSS_FILES}${NC}"
if [ -n "$LARGE_CSS" ]; then
  echo -e "   ${YELLOW}Large CSS files (>50KB) — audit for dead styles:${NC}"
  echo "$LARGE_CSS" | while read f; do
    SIZE=$(du -sh "$f" | awk '{print $1}')
    echo -e "   ${YELLOW}→${NC} $f ($SIZE)"
  done
else
  echo -e "   ${GREEN}✓${NC} No oversized CSS files found"
fi

# ── 4. DETECT MISSING CODE SPLITTING ─────────────────────────
echo ""
echo -e "${CYAN}[4/5]${NC} Checking for code splitting..."

LAZY_COUNT=$(grep -r "React.lazy\|import('" src --include="*.jsx" --include="*.tsx" 2>/dev/null | wc -l)
DIRECT_IMPORTS=$(grep -r "^import.*from.*pages\/" src/App.tsx src/App.jsx src/main.tsx src/main.jsx 2>/dev/null | wc -l)

if [ "$LAZY_COUNT" -eq 0 ] && [ "$DIRECT_IMPORTS" -gt 0 ]; then
  echo -e "   ${RED}⚠  No React.lazy() found — all pages likely load on startup${NC}"
  echo -e "   ${YELLOW}   Fix: wrap page imports with React.lazy() + Suspense${NC}"
  echo ""
  echo -e "   Example:"
  echo -e "   ${YELLOW}   // Before${NC}"
  echo -e "   import CreativeStudio from './pages/CreativeStudio/CreativeStudio'"
  echo -e "   ${GREEN}   // After${NC}"
  echo -e "   const CreativeStudio = React.lazy(() => import('./pages/CreativeStudio/CreativeStudio'))"
elif [ "$LAZY_COUNT" -gt 0 ]; then
  echo -e "   ${GREEN}✓${NC} ${LAZY_COUNT} lazy import(s) found"
else
  echo -e "   ${YELLOW}⚠${NC}  Could not detect — check App.tsx manually"
fi

# ── 5. WEBSOCKET SCOPE CHECK ──────────────────────────────────
echo ""
echo -e "${CYAN}[5/5]${NC} Checking WebSocket scope..."

WS_IN_MAIN=$(grep -r "new WebSocket\|useWebSocket\|binanceWS\|wss://" src/App.tsx src/App.jsx src/main.tsx src/main.jsx src/contexts/ 2>/dev/null | wc -l)
WS_IN_PAGES=$(grep -r "new WebSocket\|wss://" src/pages/ 2>/dev/null | wc -l)

if [ "$WS_IN_MAIN" -gt 0 ]; then
  echo -e "   ${YELLOW}⚠  WebSocket likely opened at app level — runs on every page${NC}"
  echo -e "   ${YELLOW}   Scope it to a context provider that only connects on relevant routes${NC}"
else
  echo -e "   ${GREEN}✓${NC} WebSocket not detected at app root"
fi

if [ "$WS_IN_PAGES" -gt 0 ]; then
  echo -e "   ${GREEN}✓${NC} WebSocket calls found in $WS_IN_PAGES page(s) — likely scoped correctly"
fi

# ── SUMMARY + RECOMMENDATIONS ─────────────────────────────────
echo ""
echo -e "  ─────────────────────────────────"
echo -e "${BOLD}  Summary & next steps${NC}"
echo ""
echo -e "  ${GREEN}1.${NC} Copy SPECTRE_SESSION_STARTER.md into your project root"
echo -e "     Start every Claude Code session by saying:"
echo -e "     ${YELLOW}\"Read SPECTRE_SESSION_STARTER.md then SPECTRE_DESIGN_LAW.md\"${NC}"
echo ""
echo -e "  ${GREEN}2.${NC} One conversation per feature. Close it when done."
echo -e "     Don't iterate more than ~80 turns in one thread."
echo ""
echo -e "  ${GREEN}3.${NC} Add to your .claude/CLAUDE.md (or cursor rules):"
echo ""
cat << 'EOF'
  ┌──────────────────────────────────────────────────────────────┐
  │  # Spectre AI — Claude Code Rules                           │
  │                                                              │
  │  ## Always do first                                          │
  │  1. Read SPECTRE_SESSION_STARTER.md                          │
  │  2. Read SPECTRE_DESIGN_LAW.md                               │
  │  3. Read src/index.css (CSS variables)                       │
  │  4. Read src/icons/spectreIcons.jsx before using any icon    │
  │                                                              │
  │  ## Never do                                                 │
  │  - Use external icon libraries                               │
  │  - Use Tailwind default colors                               │
  │  - Put numbers in non-monospace font                         │
  │  - Label anything "AI" or "Powered by AI"                    │
  │  - Skip day mode on new components                           │
  │  - Start coding before reading existing component            │
  └──────────────────────────────────────────────────────────────┘
EOF

echo ""
echo -e "  ${GREEN}4.${NC} For large features (Studio rebuild, new pages):"
echo -e "     Split into sub-tasks across separate conversations:"
echo -e "     ${YELLOW}Session A:${NC} Component structure + data layer"
echo -e "     ${YELLOW}Session B:${NC} Styling + animations"  
echo -e "     ${YELLOW}Session C:${NC} Polish + day mode + edge cases"
echo ""
echo -e "  ${GREEN}5.${NC} Bundle analysis — run once to find the real culprit:"
echo -e "     ${YELLOW}npx vite-bundle-visualizer${NC}  (if using Vite)"
echo -e "     ${YELLOW}npx source-map-explorer dist/assets/*.js${NC}  (any bundler)"
echo ""
echo -e "  ─────────────────────────────────"
echo -e "  ${GREEN}Done.${NC} Context optimized."
echo ""

# ── BONUS: INSTALL HUMANIZER SKILL ───────────────────────────
echo ""
echo -e "${CYAN}[+]${NC} Humanizer skill..."

HUMANIZER_PATH="$HOME/.claude/skills/humanizer"
if [ -d "$HUMANIZER_PATH" ]; then
  echo -e "   ${GREEN}✓${NC} Already installed at $HUMANIZER_PATH"
  echo -e "   Usage in Claude Code: ${YELLOW}/humanizer [paste copy here]${NC}"
else
  echo -e "   ${YELLOW}Not installed.${NC} Run this to install:"
  echo -e "   ${YELLOW}git clone https://github.com/blader/humanizer.git ~/.claude/skills/humanizer${NC}"
  echo -e "   Then in Claude Code: ${YELLOW}/humanizer [paste copy here]${NC}"
fi
echo ""
