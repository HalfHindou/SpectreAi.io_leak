---
description: Run the per-page quality sweep (Web Vitals, console, day-mode, mobile, i18n, polling) that catches the bug classes the team ships fixes for. Static scans + a live browser pass.
allowed-tools: Agent, Bash, Glob, Grep, Read, Edit, TodoWrite, AskUserQuestion
---

Run a disciplined per-route quality pass on the research app. This is the codified version of the recurring bug classes the team fixes: CLS/LCP, console warnings, day-mode gaps, mobile breakage, i18n placeholder leaks, and unguarded polling. The goal is to FIND real, fixable issues - not to manufacture churn. Report findings with evidence; only fix what is clearly broken.

Scope: if the user named a page (e.g. `/audit research-zone`), audit just that route. Otherwise run the static scans repo-wide, then sweep the highest-traffic routes live.

## Part A - Static scans (fast, repo-wide, no server)

Run from the repo root.

### A1. i18n interpolation leaks (the `{{count}}` bug class, PR #854)
```bash
node .claude/scripts/i18n-leak-scan.mjs
```
Flags `t('key')` calls whose locale value contains `{{var}}` but pass no interpolation object -> renders the placeholder literally. Exit 1 = leaks found. Verify each candidate by reading the call site (the scan is high-precision but confirm before fixing).

### A2. Unguarded polling (background fetch waste)
```bash
# setInterval files with NO visibility guard anywhere in the file:
grep -rln "setInterval" apps/research/src --include="*.js" --include="*.jsx" | while read f; do
  grep -q "document.hidden\|visibilitychange\|visibilityState\|useVisibilit\|useAdaptivePolling" "$f" || echo "  $f"
done
```
Then for each hit, check whether the interval does a DATA FETCH (`grep -A6 "setInterval(" "$f"`). Clocks/animations are fine - only flag data polls. Fix: inline guard `setInterval(() => { if (!document.hidden) fetchFn() }, ms)` (matches `coding-standards.md`).

### A3. i18next missing-key warnings (locale parity)
```bash
# keys present in en/en-rest but missing in a target locale fall back to English (cosmetic, not broken):
for f in en en-rest es ru ja zh tr ar hi; do printf "%-8s %s keys\n" "$f" "$(grep -c ':' apps/research/src/i18n/locales/$f.json)"; done
```
A locale frozen far below en+en-rest is missing recent strings. Report as a translation gap, not a bug.

### A4. Images without dimensions (CLS source)
```bash
grep -rn "<img " apps/research/src --include="*.jsx" | grep -v "width=\|height=\|aspect-ratio\|className" | head -30
```
`<img loading="lazy">` with no reserved box reflows the page as it loads. Fix via fixed dims or an `aspect-ratio` wrapper with `object-fit: cover` (see `.rz-tw__media`, PR #847).

## Part B - Live browser pass (per route)

Start the research dev server (`preview_start research`) OR audit prod (`https://app.spectreai.io`) when local data endpoints 401. For each target route: navigate, wait ~6s for data, then run the harness below. Local renders layout/CSS faithfully even when data 401s; judge data-states on prod.

### B1. Web Vitals + long tasks (paste into preview_eval / browser_evaluate)
```js
() => new Promise((resolve) => {
  let cls = 0; const shifts = {}; const longTasks = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) { if (e.hadRecentInput || e.value < 0.005) continue; cls += e.value; for (const s of (e.sources||[])) { const n = s.node; if (!n) continue; const id = (n.nodeName||'?') + (n.className && typeof n.className==='string' ? '.'+n.className.trim().split(/\s+/).slice(0,2).join('.') : ''); shifts[id] = +((shifts[id]||0)+e.value).toFixed(4); } } }).observe({ type:'layout-shift', buffered:true }); } catch(_){}
  let lcp = 0; try { new PerformanceObserver(l => { const es = l.getEntries(); lcp = es[es.length-1]?.startTime||lcp; }).observe({ type:'largest-contentful-paint', buffered:true }); } catch(_){}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) longTasks.push(Math.round(e.duration)); }).observe({ type:'longtask', buffered:true }); } catch(_){}
  setTimeout(() => {
    const fcp = performance.getEntriesByType('paint').find(p => p.name==='first-contentful-paint');
    resolve({
      fcp: Math.round(fcp?.startTime||0), lcp: Math.round(lcp), cls: +cls.toFixed(4),
      estTBTms: longTasks.reduce((s,t) => s+Math.max(0,t-50), 0),
      topShiftSources: Object.entries(shifts).sort((a,b)=>b[1]-a[1]).slice(0,6),
    });
  }, 8000);
})
```
Thresholds: CLS > 0.1 = fix (read `topShiftSources` for the culprit nodes); LCP > 2500ms or TBT > 200ms = investigate. Good baselines observed: home CLS 0.02 / TBT 27ms, calendar 0 / 20ms.

### B2. i18n placeholder leaks in the live DOM
```js
() => { const t = document.body.innerText||''; return { placeholderLeaks: [...new Set((t.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g)||[]))].slice(0,10) }; }
```
Any hit is a real, user-visible leak (this is how PR #854 was caught).

### B3. Console warnings
Use `preview_console_logs level:'warn'` (or read the navigate console log). Watch for: `i18next::translator: missingKey`, React `Warning:` (hooks order, keys), failed resource loads, deprecations.

### B4. Day mode + mobile
- Toggle day mode (`preview_resize colorScheme:'light'` or the in-app toggle). Look for unstyled dark-on-light elements, especially portaled overlays / modals / dropdowns - the most common day-mode miss.
- `preview_resize preset:'mobile'` (and 1024px). Look for horizontal overflow, collapsed/overlapping chrome, dead space.

## Part C - Report + fix

1. Summarize findings as a table: route | class | evidence (number / node / screenshot) | severity.
2. Distinguish REAL bugs from cosmetic gaps (translation fallbacks, intentional design) - be honest, don't pad.
3. Fix the clear-cut ones with the minimal correct pattern; verify each (build + re-measure / re-screenshot). Leave subjective design calls to the owner.
4. One concern per PR, branched fresh from `origin/main`. Reference the bug class in the title.

Reference fixes: PR #846 (request coalescing), #847 (CLS via aspect-ratio), #854 (i18n leak), dossier-panel polling guards. Guardrails: `.claude/agent-memory` / project memory - API handlers use the direct Hetzner origin; never commit `agent-state.json`.
