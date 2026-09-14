# Theme / scrollbar audit tooling

Four classes of visual bug, four scanners. Written while building the PRO Theme
Studio; each one caught defects that eyeballing missed. Full context:
`.claude/rules/pro-themes-and-scrollbars-handoff.md`.

Requires the dev server running. Target defaults to `http://localhost:5190`,
override with `SPECTRE_URL`. Uses the repo's existing puppeteer/playwright.

```bash
node scripts/theme-audit/ghost-scan.cjs      # panels that VANISH over a backdrop
node scripts/theme-audit/text-audit.cjs      # text floating with no plane behind it
node scripts/theme-audit/perf-audit.cjs      # backdrop-filter census + frame timing
node scripts/theme-audit/ff-headed.cjs       # scrollbars in REAL (headed) Firefox
```

| Script | Finds | Threshold |
|---|---|---|
| `audit-lib.cjs` | shared: dark-slab scan, tour dismissal, tab-clicker, per-page runner | opaque a≥0.72 & luminance<55, z≤90 |
| `ghost-scan.cjs` | card-like containers with effective bg alpha <0.15 and no frost in 3 ancestors | <0.15 |
| `text-audit.cjs` | leaf text with <0.3 ancestor coverage, no frost, no text-shadow | ≥2 occurrences |
| `perf-audit.cjs` | `backdrop-filter` count + **filtered megapixels**, rAF frame deltas | — |
| `tdt-perf.cjs` | frame timing on the REAL scrollers (page + inner table) + partial-row detection | >32ms frames |
| `clip-probe.cjs` | text-shadow node counts, scroller/row geometry | — |
| `ff-headed.cjs` | scrollbar computed values in **headed** Firefox | — |
| `chrome-trap.cjs` | elements where standard scrollbar props disable `::-webkit-scrollbar` | Chrome 121+ |
| `supports-test.cjs` | proves the `@supports not selector(::-webkit-scrollbar)` guard per engine | — |
| `sb-control.cjs` | **proves who creates the Chrome gutter** — same page, unstyled vs `::-webkit-scrollbar` applied | 0px → 14px |
| `sb-probe.cjs` | per-engine headed sweep: reserved gutter, `scrollbar-width/color`, right-edge PNGs at rest / scrolling / after | — |
| `sb-reveal.cjs` | elements reserving a gutter that **never get revealed** = permanently empty channels | gutter ≥10px |

## Three rules learned the hard way

1. **Filtered megapixels — not headless FPS — is the honest scroll-perf metric.**
   Headless cannot reproduce retina GPU compositing cost, so it will happily
   report a smooth 60fps on a page that stutters badly on a real display.
2. **Headless browsers cannot see scrollbars at all.** Both engines force
   overlay scrollbars headlessly, and headless Firefox reports
   `scrollbar-width: none` for every element — a lie. Any scrollbar work must
   be verified with `headless: false`.
3. **Start your own dev server on a free port with `--strictPort`, and point
   probes at `127.0.0.1:<port>`.** On 2026-08-02 `:5180` had TWO servers bound
   at once (`spectre-app-risk-wt` and the main tree, one IPv4 one IPv6), so
   `curl` and Playwright measured DIFFERENT TREES in the same session and two
   probe runs were wasted on stale CSS. Fingerprint the tree before trusting a
   number — and pick a fingerprint that actually discriminates (checking for the
   `@supports` guard did not; it predates the fix being looked for).

## mobile-audit.cjs — the phone counterpart

`SPECTRE_URL=http://localhost:5183 node scripts/theme-audit/mobile-audit.cjs`

Runs at a true 390x844 over 12 routes and reports seven defect classes, each one
this repo has shipped before: horizontal overflow, sub-38px touch targets,
invisible text, **covered interactive elements**, blur load (filtered
megapixels), paint-driven infinite animations, page errors. Uses playwright
(the other scanners here use puppeteer).

Two things it taught us, so nobody re-learns them:

- 🪤 **`getBoundingClientRect()` is not the tap area.** `i-btn` is a 16px circle
  that already expands to 40px with `::after { inset: -12px }` — invisible to the
  rect, so a box-based scan reports a false positive. Probe outward with
  `elementFromPoint` to measure what a finger actually hits.
- 🪤 **The app's scroller is `.app`, not the document.** `documentElement.scrollHeight`
  equals the viewport, so `window.scrollTo` does nothing and every "content is
  stuck under the nav" finding reads as permanent. Scroll `.app`, then re-probe:
  most such overlaps free themselves and are NOT defects.
