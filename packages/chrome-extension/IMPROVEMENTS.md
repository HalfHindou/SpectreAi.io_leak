# Spectre AI Chrome Extension — Improvements Checklist

## Phase 1: Cashtag Hover Popup Improvements
- [x] 1A. Move AI Analysis above the chart (hero section below price)
- [x] 1A. Apply new AI Analysis styling (glassmorphic card, italic serif, purple dot label)
- [x] 1B. Add dominance context line below price row (BTC.D / ETH.D)
- [x] 1C. Add "+ Watchlist" ghost button next to "View in Spectre" CTA
- [x] 1C. Persist watchlist to `spectre_watchlist` in chrome.storage.local
- [x] 1C. Show "✓ Watching" state when token is already in watchlist

## Phase 2: Extension Popup Improvements
- [x] 2A. Make AI Brief the dominant element (14px text, left border accent, more padding)
- [x] 2B. Collapse watchlist by default with toggle (count + chevron)
- [x] 2B. Persist watchlist expanded/collapsed state in storage
- [x] 2C. Tighten popup vertical spacing (featured icons 32px, reduced gaps)

## Phase 3: Sidebar Panel Improvements
- [x] 3A. Add "Mentioned in Feed" section at top of sidebar (after AI Brief)
- [x] 3A. Viewport-scan visible tweets for cashtags every 10 seconds
- [x] 3A. Render clickable pill chips ($BTC ×5) sorted by count, max 10
- [x] 3A. Apply .hot styling to high-count cashtags
- [x] 3B. Restyle "Trending on X" to use same feed tag pill style
- [x] 3C. Ensure sidebar auto-refreshes (market 60s, feed 10s)

## Phase 4: Search Overlay Improvements
- [x] 4A. Add chain filter pills below search input (All, Ethereum, Solana, Base, BSC)
- [x] 4A. Filter results by networkId when chain selected
- [x] 4B. Add section tabs: Recent / Trending / Watchlist
- [x] 4B. Recent tab: last 10 searched tokens from storage
- [x] 4B. Trending tab: top 10 from API, cached 2 min
- [x] 4B. Watchlist tab: saved tokens with live prices
- [x] 4B. Hide tabs when typing, show when input cleared
- [x] 4C. Add "Clear" button for recent searches

## Phase 5: Tweet Enrichment Badge
- [x] 5. Inline sentiment alignment badges (16px circles: ✓ agree, ✗ disagree, ~ neutral)
- [x] 5. Inject badge next to cashtag elements with pending → resolved states
- [x] 5. Tweet sentiment analysis via keyword heuristic (content/tweet-sentiment.js)
- [x] 5. Compute alignment between tweet sentiment and token data (change24 + AI Pulse)
- [x] 5. Glassmorphic tooltip on hover showing tweet sentiment, token change, alignment message
- [x] 5. MutationObserver handles new tweets via existing cashtag-detector.js
- [x] 5. Batch resolve: debounced BATCH_RESOLVE_CASHTAGS for cache-first performance
- [x] 5. Day mode support for badges + tooltip
- [x] 5. User toggle: badgesEnabled in settings + extension popup toggle

## Final Checks
- [ ] Extension loads with no errors in chrome://extensions
- [ ] No console errors on x.com
- [ ] All Shadow DOM isolation working
- [x] Build succeeds with `node build.js`
