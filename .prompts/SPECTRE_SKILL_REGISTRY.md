# SPECTRE AI — MASTER SKILL REGISTRY
## Every skill the platform needs to operate at full intelligence capacity

> A "skill" is a self-contained instruction set that any agent (Claude Code, automation, background worker) reads before executing a task in that domain. Skills are not code — they are operating manuals. Each one defines: what the skill does, what inputs it takes, what rules govern its output, what it should never do, and how to handle failure. Every skill file lives in `skills/{category}/{skill-name}/SKILL.md`.

---

## SKILL ARCHITECTURE

```
skills/
├── data/              ← Market data, on-chain, social feeds
├── intelligence/      ← Analysis, thesis, TA, sentiment
├── publishing/        ← Articles, SEO, images, social posts
├── design/            ← UI, motion, brand, visual systems
├── security/          ← Contract scanning, risk, monitoring
├── operations/        ← Documentation, error handling, scheduling
└── creative/          ← Video, motion, storytelling, campaigns
```

Each skill file contains:
```
## WHAT THIS SKILL DOES
## INPUTS
## OUTPUTS  
## RULES (what it must always do)
## NEVER (what it must never do)
## FAILURE HANDLING
## EXAMPLE OUTPUT
```

---

## TIER 1 — DATA LAYER
*The raw feeds. Everything intelligence is built on.*

---

### `data/crypto-price/`
**Status:** ✅ Exists  
**Purpose:** Live OHLCV, bid/ask, volume, market cap for any crypto asset.  
**Sources:** Binance, CoinGecko, CryptoCompare, Spectre backend `/api/tickers`  
**Outputs:** `{ price, change24h, change7d, volume24h, marketCap, ohlcv[], bid, ask }`  
**Key rules:** Always return timestamp with data. If primary source fails, cascade to fallback. Never return stale data older than 60s without flagging it.

---

### `data/stock-price/`
**Status:** ✅ Exists (via Yahoo/Finnhub)  
**Purpose:** Live quotes, OHLCV, pre/after-hours for equities.  
**Sources:** Yahoo Finance v8, Finnhub, Spectre backend `/api/stocks/quotes`  
**Outputs:** `{ price, change, changePercent, volume, marketCap, pe, eps, week52High, week52Low, marketStatus }`  
**Key rules:** Always include market status (OPEN/PRE/AFTER/CLOSED). Circuit breaker if Yahoo blocks — fall to Finnhub instantly.

---

### `data/coingecko-deep/`
**Status:** ❌ Missing (only basic calls exist)  
**Purpose:** Full token intelligence — supply schedule, contract flags, exchange listings, team links, GitHub URL, blog URL, community sizes.  
**Sources:** CoinGecko `/coins/{id}` with all fields enabled  
**Outputs:** `{ supplyRatio, athDrawdown, exchanges[], contractFlags, githubUrl, blogUrl, twitterFollowers, telegramUsers, categories[], description }`  
**Key rules:** Cache 1 hour. Always extract `repos_url.github` and `links.homepage` for downstream GitHub and blog skills. Flag GoPlus warnings if present.

---

### `data/defillama/`
**Status:** ✅ Exists  
**Purpose:** TVL, protocol revenue, fee data, chain breakdown for DeFi protocols.  
**Sources:** `api.llama.fi/protocols`, `api.llama.fi/protocol/{slug}`, `yields.llama.fi/pools`  
**Outputs:** `{ tvl, tvl7dChange, tvl30dChange, revenue24h, fees24h, chains[], yieldPools[] }`  
**Key rules:** Return `{ available: false }` cleanly if protocol not found — never fabricate TVL. Cache 15 minutes.

---

### `data/dexscreener/`
**Status:** ✅ Exists  
**Purpose:** DEX pair data — liquidity depth, buy/sell pressure, new pair detection.  
**Sources:** DexScreener API  
**Outputs:** `{ pairAddress, liquidity, volume24h, priceImpact, buys24h, sells24h, newPairs[] }`  
**Key rules:** Flag pairs with liquidity under $50K as high-risk. Flag pairs under 24h old as unverified.

---

### `data/codex/`
**Status:** ✅ Exists  
**Purpose:** Advanced on-chain analytics — wallet flows, whale tracking, holder distribution.  
**Sources:** Codex API  
**Outputs:** `{ holderCount, top10HoldersPercent, netFlow24h, whaleActivity[], newHolders24h }`

---

### `data/github-reader/`
**Status:** ❌ Missing  
**Purpose:** Developer activity, code health, repo legitimacy check for any project.  
**Sources:** GitHub REST API v3 (`api.github.com`)  
**Inputs:** `symbol`, `projectName`, optional `repoUrl`  
**Outputs:** `{ activityStatus, daysSinceLastCommit, contributorCount, stars, latestRelease, recentCommits[], isAbandoned }`  
**Key rules:** Resolve repo URL from CoinGecko links first, then GitHub search. Classify activity as: `very_active` (<7d) / `active` (<30d) / `slowing` (<90d) / `dormant` (<180d) / `abandoned` (>180d). Add `GITHUB_TOKEN` env var for 5000 req/hour vs 60 unauthenticated.

---

### `data/reddit-reader/`
**Status:** ❌ Missing  
**Purpose:** Community sentiment, red flag detection, organic discussion tracking.  
**Sources:** Reddit JSON API (free, no key) — `reddit.com/r/{sub}/search.json`, `reddit.com/search.json`  
**Inputs:** `symbol`, `projectName`  
**Outputs:** `{ posts[], redFlagCount, redFlagTitles[], sentiment, communitySubreddit, topDDPosts[] }`  
**Key rules:** Filter posts with score < 5 (noise). Auto-detect: rug/scam/honeypot/exploit/abandoned keywords. Return top 3 DD posts separately from news posts. Rate limit: 1 request/2 seconds to avoid 429.

---

### `data/youtube-monitor/`
**Status:** ❌ Missing  
**Purpose:** Track founder video updates, major crypto channel coverage, project explainers.  
**Sources:** YouTube Data API v3 (free tier: 10K units/day)  
**Inputs:** `symbol`, `projectName`, optional `channelIds[]`  
**Outputs:** `{ recentVideos[], founderVideos[], mentionedInVideos[], transcriptSnippets[] }`  
**Key rules:** Search for project name in last 30 days. Prioritize channels with >50K subscribers. Extract transcript snippets if available via YouTube captions API. Flag if founder posted video in last 7 days — this is a high-signal event. Never return videos under 100 views.

---

### `data/telegram-monitor/`
**Status:** ❌ Missing  
**Purpose:** Project announcement channels, community chat sentiment.  
**Sources:** Telegram Bot API (read-only), MTProto API via Telethon (Python) for public channels  
**Inputs:** `channelUsername` or `symbol` (resolve from CoinGecko telegram field)  
**Outputs:** `{ recentMessages[], pinned[], adminActivity, memberCount, sentiment, lastAdminPost }`  
**Key rules:** Public channels only — never attempt private group access. Resolve channel from CoinGecko `community_data.telegram_channel_user_count` and `links.telegram_channel_identifier`. If channel not found, return `{ available: false }`. Flag: if last admin post is >7 days ago, mark team as potentially inactive.  
**Note:** Telethon requires a Telegram API ID and hash — add `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` to env. Alternatively, use Perplexity to search Telegram public content as a fallback.

---

### `data/x-scraper/`
**Status:** ⚠️ Partial (exists as twitter/ skill but needs expansion)  
**Purpose:** Real-time X posts, founder tracking, KOL mentions, sentiment signals.  
**Sources:** X API v2 (with Bearer token), or Perplexity as proxy if no API access  
**Inputs:** `symbol`, `founderHandles[]`, `kols[]` (optional KOL list to check)  
**Outputs:** `{ recentPosts[], founderPosts[], kolMentions[], sentiment, engagementScore, viralPosts[] }`  
**Key rules:** Search both `$SYMBOL` and `#SYMBOL` and project name. Separate founder posts from community posts — these are not the same signal. Flag viral posts (>500 engagements for microcap, >5K for majors). Detect tone shift: if founder goes quiet after >30 days of activity, flag it.  
**Founder resolution:** Check `FOUNDER_MAP` first, then CoinGecko team field, then Perplexity search.

---

### `data/rss-aggregator/`
**Status:** ⚠️ Partial (CoinDesk + CoinTelegraph only)  
**Purpose:** Ingest news from all major crypto and finance sources in real time.  
**Sources:**
```
Crypto:    CoinDesk, CoinTelegraph, The Block, Decrypt, Blockworks, Bitcoin Magazine
Finance:   Reuters Markets, Bloomberg Crypto, FT Markets, WSJ Markets
DeFi:      DeFi Pulse, Bankless, The Defiant
Stocks:    Seeking Alpha, Motley Fool, Barron's
Regulation: SEC.gov press releases, CFTC announcements
```
**Outputs:** `{ items[], breakingItems[], itemsByCategory{} }`  
**Key rules:** Deduplicate by headline similarity (>60% word overlap = same story). Tag each item: `isCrypto`, `isStock`, `isRegulation`, `isMacro`, `mentionedTickers[]`. Cache 5 minutes.

---

### `data/linkedin-reader/`
**Status:** ❌ Missing  
**Purpose:** Fetch structured team and founder data from LinkedIn profiles found on project websites.  
**Resolution order:**
1. Crawl the project's official website first — extract any LinkedIn URLs in the page HTML
2. Check common paths: `/about`, `/team`, `/about-us`, `/#team` if not on homepage
3. Fetch each LinkedIn profile found using RapidAPI LinkedIn scraper or Perplexity fallback
4. For known projects (Spectre and others), hardcode verified LinkedIn URLs in `SPECTRE_IDENTITIES` / `PROJECT_IDENTITIES` so the crawl step is only needed once  

**Sources:** RapidAPI LinkedIn scraper (`RAPIDAPI_KEY` env var), Perplexity as fallback  
**Inputs:** `projectWebsiteUrl` or `linkedinProfileUrl[]`  
**Outputs:** `{ profiles: [{ name, role, xHandle, previousRoles[], education[], bio }] }`  
**Key rules:** Never say "team info unavailable" without first crawling the website. The LinkedIn link is almost always there. Cache profiles for 24 hours — team data changes slowly. Never fabricate a LinkedIn profile or infer team members from web search results — only return data from actual profile pages.  
**NEVER:** Say the founder is unknown or unverifiable when a LinkedIn profile exists on the website. This is a data retrieval failure, not a data absence.

---

### `data/web-scraper/`
**Status:** ✅ Exists  
**Purpose:** Crawl any public URL — project websites, docs, Medium, Substack, announcements.  
**Key rules:** 8 second timeout. Strip nav, footer, cookie banners — return main content only. Never crawl pages requiring auth. Respect robots.txt.

---

### `data/macro-feeds/`
**Status:** ❌ Missing  
**Purpose:** Economic data — Fed statements, CPI, PCE, jobs reports, yield curves.  
**Sources:** FRED API (free), Federal Reserve press releases RSS, BLS.gov, US Treasury yields  
**Outputs:** `{ fedFundsRate, cpi, pce, unemploymentRate, yieldCurve{2y,10y,30y}, nextFOMCDate }`  
**Key rules:** Cache 4 hours for economic data (changes slowly). FOMC dates must be exact — source from Fed calendar directly.

---

## TIER 2 — INTELLIGENCE LAYER
*Raw data becomes insight here.*

---

### `intelligence/ta-analyst/`
**Status:** ❌ Missing (biggest gap)  
**Purpose:** Technical analysis on any asset — structure, key levels, indicators, trade setups.  
**Inputs:** `ohlcv[]`, `symbol`, `timeframe`  
**Outputs:**
```json
{
  "trend": "bullish|bearish|ranging",
  "structure": { "type": "HH/HL|LH/LL", "lastSwingHigh": 0, "lastSwingLow": 0 },
  "keyLevels": { "support": [], "resistance": [], "method": "pivot|volume|structure" },
  "indicators": { "rsi": 0, "macd": {}, "ema20": 0, "ema50": 0, "ema200": 0, "vwap": 0 },
  "setup": { "type": "breakout|pullback|reversal|none", "entry": 0, "stop": 0, "targets": [] },
  "narrative": "Two-sentence plain English summary of current structure"
}
```
**Key rules:** Never give price targets as guarantees — frame as "IF price holds X THEN Y becomes possible." Always define the stop before the target. Multi-timeframe: always check daily context when analyzing 4H or below. Detect manipulation patterns: fakeout above resistance, liquidity sweep below support.

---

### `intelligence/thesis-analyst/`
**Status:** ❌ Missing  
**Purpose:** Full trader research pipeline — the 9-step dossier. Powers the Search Engine Deep Thesis tab.  
**Inputs:** `query`, `symbol`, `queryType` (TOKEN_RESEARCH | THESIS_RESEARCH | COMPARISON | DEFI_RESEARCH)  
**Outputs:** Full structured thesis JSON with sections, keyVoices, comparisonTable, riskFlags, sourcesUsed  
**Key rules:** Run source priority logic first. Quick context pass before heavy fetching. Journalism rules apply throughout. Max 5 sources returned. No em-dashes. No AI filler phrases. Pull quotes mandatory per section.  
**See:** Full pipeline spec in `SPECTRE_SEARCH_INTELLIGENCE_UPGRADE.md`

---

### `intelligence/sentiment-engine/`
**Status:** ❌ Missing  
**Purpose:** Unified sentiment score across all available signals for any asset.  
**Inputs:** `symbol`, available data from `x-scraper`, `reddit-reader`, `telegram-monitor`, `rss-aggregator`  
**Outputs:**
```json
{
  "score": 0.73,          // 0.0 = max fear, 1.0 = max greed
  "label": "bullish",     // bearish | neutral | bullish | euphoric | panic
  "breakdown": {
    "xSentiment": 0.8,
    "redditSentiment": 0.6,
    "newsSentiment": 0.7,
    "telegramSentiment": 0.65,
    "priceAction": 0.9    // RSI, momentum as a sentiment proxy
  },
  "signals": [
    "Founder posted 3 times in last 24h — active team signal",
    "Reddit: 2 high-score posts discussing accumulation",
    "Price +12% on 3x average volume — smart money signal"
  ],
  "redFlags": [],
  "dataAge": "2026-02-21T13:00:00Z"
}
```
**Key rules:** Weighted average — price action (30%), X (25%), Reddit (20%), news (15%), Telegram (10%). Adjust weights based on asset type: microcaps weight X and Telegram higher (community-driven). Major caps weight news and price action higher. Never output a sentiment score without listing the signals that drove it.

---

### `intelligence/on-chain-analyst/`
**Status:** ⚠️ Partial (Codex exists)  
**Purpose:** Read whale behavior, smart money flows, exchange inflows/outflows, holder trends.  
**Inputs:** `symbol`, `contractAddress`, `chain`  
**Outputs:**
```json
{
  "whaleSignal": "accumulating|distributing|neutral",
  "exchangeFlow": { "netFlow24h": -2400000, "direction": "outflow" },
  "holderTrend": "growing|shrinking|stable",
  "smartMoneyWallets": [],
  "unusualActivity": "Large wallet moved 2.4M tokens to cold storage 6h ago"
}
```
**Key rules:** Exchange outflow (withdrawal from CEX) = bullish signal (moving to cold storage). Exchange inflow = potential sell signal. Flag any single wallet moving >1% of circulating supply. Check if team wallets are selling.

---

### `intelligence/risk-scorer/`
**Status:** ❌ Missing  
**Purpose:** Unified risk assessment combining contract, liquidity, team, and market signals.  
**Inputs:** All available data from the dossier  
**Outputs:**
```json
{
  "riskLevel": "EXTREME|HIGH|MEDIUM|LOW",
  "score": 78,           // 0 = safest, 100 = most dangerous
  "flags": [
    { "severity": "CRITICAL", "flag": "Contract owner can disable sells" },
    { "severity": "HIGH",     "flag": "Volume $23K/day — insufficient exit liquidity" },
    { "severity": "MEDIUM",   "flag": "No commits in 45 days" }
  ],
  "verdict": "One sentence. Is the risk appropriate for the opportunity?"
}
```
**Key rules:** Any CRITICAL flag automatically sets riskLevel to at least HIGH. Two or more CRITICAL flags = EXTREME. GoPlus contract flag = always CRITICAL. Volume < $50K = always HIGH. GitHub abandoned = HIGH.

---

### `intelligence/narrative-tracker/`
**Status:** ❌ Missing  
**Purpose:** Detect which macro narratives are gaining or losing momentum. Which sector is hot?  
**Inputs:** RSS feeds, X trending, CoinGecko category data  
**Outputs:**
```json
{
  "trendingNarratives": [
    { "name": "RWA Tokenization", "momentum": "rising", "topTokens": ["ONDO", "POLYX"] },
    { "name": "AI Agents", "momentum": "peaking", "topTokens": ["VIRTUAL", "AI16Z"] },
    { "name": "Base Ecosystem", "momentum": "rising", "topTokens": ["BRETT", "TOSHI"] }
  ],
  "fadingNarratives": [
    { "name": "NFTs", "momentum": "declining" }
  ],
  "emergingNarratives": [
    { "name": "Real World Gaming", "momentum": "early", "signals": 3 }
  ]
}
```
**Key rules:** A narrative needs at least 3 independent signals to be classified as "trending." Distinguish between price-driven narratives (speculation) and adoption-driven narratives (real usage). Update every 4 hours.

---

### `intelligence/comparison-engine/`
**Status:** ❌ Missing  
**Purpose:** Side-by-side comparison of 2-5 assets across any dimension.  
**Inputs:** `assets[]`, `comparisonType` (market | fundamentals | technicals | risk)  
**Outputs:** Structured comparison table + written analysis  
**Key rules:** All data from the same timestamp — no mixing stale with fresh. Highlight the winner per category. Always present what each asset does better, not just one-sided. Journalism rules apply.

---

### `intelligence/earnings-analyst/`
**Status:** ❌ Missing (stocks only)  
**Purpose:** Earnings analysis — beat/miss, guidance, next quarter setup.  
**Sources:** Finnhub earnings data, SEC EDGAR, Yahoo Finance  
**Outputs:** `{ actualEPS, estimatedEPS, surprise%, revenue, revenueGrowthYoY, guidance, analystReactions[] }`  
**Key rules:** Always compare to consensus estimates, not just prior period. Highlight guidance revision — that's the real signal, not the headline beat/miss.

---

## TIER 3 — PUBLISHING LAYER
*Intelligence becomes content.*

---

### `publishing/content-writer/`
**Status:** ✅ Exists (but needs Content Law applied)  
**Purpose:** Article body generation for Intelligence Hub.  
**Key rules to add:**
- No em-dashes
- Max 3 sentences per paragraph
- Pull quotes mandatory per 3+ paragraph sections
- Inline [1][2][3] banned from body text
- Max 5 sources returned
- Banned phrase list enforced

---

### `publishing/breaking-news-handler/`
**Status:** ❌ Missing  
**Purpose:** End-to-end pipeline for breaking events: detect → generate → publish → notify.  
**Inputs:** RSS item or manual trigger  
**Outputs:** Published article + notification pushed to all connected clients  
**Key rules:** Tier 1 events (hacks, ETF approvals, rate decisions) generate within 3 minutes of detection. Tier 2 events generate within 15 minutes. Article must be published before notification fires. Max 3 breaking articles per day to prevent alert fatigue. Deduplication: if same story already published within 4 hours, skip.

---

### `publishing/og-image-gen/`
**Status:** ❌ Missing  
**Purpose:** Generate 1200x630 social preview cards for every Intelligence Hub article.  
**Inputs:** `articleTitle`, `tickers[]`, `priceData`, `articleType`  
**Outputs:** JPG file at `/public/og-images/{slug}.jpg`  
**Template:** Dark background (#07070d), token logo top-left, headline center in Space Grotesk, price + change bottom-right in JetBrains Mono, Spectre wordmark bottom-left. No gradients. No glows. Looks like Bloomberg shared a card.  
**Sources:** Stability AI SDXL (`$0.002/image`) or DALL-E 3 (`$0.04/image`)  
**Key rules:** Generate at article save time, not on demand. Cache — never regenerate if file already exists. Fallback: if generation fails, serve branded template with token logo on dark background.

---

### `publishing/seo-builder/`
**Status:** ❌ Missing  
**Purpose:** Generate all SEO metadata for every article — title tags, meta descriptions, JSON-LD, Open Graph.  
**Inputs:** Article object  
**Outputs:** `{ seoTitle, metaDescription, jsonLd{}, ogTags{}, twitterCardTags{}, canonicalUrl }`  
**Key rules:** Title max 60 chars. Meta description max 155 chars. JSON-LD type: Article for news/briefs, FinancialProduct for token/stock pages. Always include `datePublished`, `dateModified`, `author: "Spectre AI"`. Canonical URL must be the full production URL, not localhost.

---

### `publishing/sitemap-builder/`
**Status:** ❌ Missing  
**Purpose:** Auto-regenerate sitemap.xml after every article publish.  
**Outputs:** Valid XML sitemap with all article URLs, priorities, changefreq  
**Key rules:** Trigger on every `saveArticle()` call. Intelligence Hub articles: priority 0.8, changefreq daily. Homepage: priority 1.0. Static pages: priority 0.5. Never include `/api/` routes.

---

### `publishing/rss-publisher/`
**Status:** ❌ Missing  
**Purpose:** Maintain RSS 2.0 + Atom feeds for all content types.  
**Feeds:** `/api/rss` (all), `/api/rss/crypto`, `/api/rss/stocks`, `/api/rss/daily`, `/api/rss/breaking`  
**Key rules:** Max 50 items per feed. Include full article summary (not just title). Cache 30 minutes. Include `<enclosure>` tag with og-image URL for RSS readers that display images.

---

### `publishing/thread-writer/`
**Status:** ❌ Missing  
**Purpose:** Convert articles and analyses into X thread format.  
**Inputs:** Article object or thesis JSON  
**Outputs:** Thread array — `[{ text, mediaUrl? }, ...]`, max 15 tweets  
**Structure:**
```
Tweet 1: Hook — the single most surprising fact. No fluff.
Tweet 2-3: Context — why this matters in 2 tweets
Tweet 4-8: The core analysis — data, tables if possible
Tweet 9-10: Bull case (condensed)
Tweet 11-12: Bear case (condensed)
Tweet 13: Key levels or what to watch
Tweet 14: Spectre verdict — one sentence
Tweet 15: CTA — link to full article
```
**Key rules:** No em-dashes. No AI filler. Each tweet must stand alone as a piece of information. Numbers always included. Thread must read like a senior analyst wrote it at 1am, not a marketing team at 9am.

---

### `publishing/x-scheduler/`
**Status:** ❌ Missing  
**Purpose:** Queue posts and threads for optimal publishing times.  
**Inputs:** Post or thread, optional schedule time  
**Outputs:** Queued item with `scheduledFor` timestamp  
**Optimal times:** 8:00 AM ET (market open), 12:00 PM ET (lunch peak), 4:00 PM ET (market close), 8:00 PM ET (evening engagement)  
**Key rules:** Breaking news overrides schedule — always immediate. Max 5 posts per day to avoid spam perception. Never post two threads within 3 hours.

---

## TIER 4 — DESIGN LAYER
*Everything users see.*

---

### `design/spectre-design-law/`
**Status:** ❌ Missing as skill (file exists but agents don't read it consistently)  
**Purpose:** Wrap `SPECTRE_DESIGN_LAW.md` as a mandatory skill so every agent producing UI reads it first.  
**Key rules:** This skill reads `.cursor/rules/SPECTRE_DESIGN_LAW.md` and returns the condensed essential rules. Any agent touching JSX, CSS, or HTML must call this skill before writing a single line. The skill fails if it cannot find the design law file.

---

### `design/motion-designer/`
**Status:** ❌ Missing  
**Purpose:** Define and implement micro-animations, transitions, and motion patterns for Spectre UI.  
**Scope:** Page transitions, chart animations, card hover states, loading sequences, notification slide-ins, breaking news banner entrance  
**Key rules:**
- All animations use `cubic-bezier(0.16, 1, 0.3, 1)` — the Apple spring curve
- Duration: 200ms for micro (hover), 300ms for standard (cards), 500ms for dramatic (page transitions)
- Never animate opacity alone — always pair with transform (translateY, scale)
- Reduced motion: respect `prefers-reduced-motion` — skip all animations, keep state changes instant
- No looping animations except: live data pulse dot, loading skeletons, the purple orb
- Chart data updates: morph, never redraw — numbers count up, bars grow, lines draw

---

### `design/ai-motion-designer/`
**Status:** ❌ Missing  
**Purpose:** AI-generated video and motion content for marketing — product demos, feature reveals, social videos.  
**Tools:** Runway Gen-3, Kling AI, HeyGen (for talking head), CapCut API  
**Use cases:**
- 30-second product demo videos for X
- Feature reveal clips (new Intelligence Hub articles animating in)
- Chart animations showing a token's price story
- "Breaking news" urgency clips for viral moments  
**Outputs:** MP4 files, 9:16 for Reels/TikTok, 16:9 for YouTube, 1:1 for X  
**Key rules:** All visuals maintain Spectre dark aesthetic. No stock footage. No voiceover unless using ElevenLabs with the approved Spectre voice. Text overlays in Space Grotesk only.

---

### `design/chart-screenshot/`
**Status:** ❌ Missing  
**Purpose:** Capture clean TradingView chart snapshots for articles, social posts, and OG images.  
**Method:** Puppeteer headless Chrome — navigate to chart URL, wait for render, screenshot  
**Inputs:** `symbol`, `timeframe`, `chartType`, `indicators[]`, optional `annotations`  
**Outputs:** PNG file at `/public/charts/{symbol}-{timeframe}-{timestamp}.png`  
**Key rules:** Always use dark theme. Remove TradingView watermark region if possible. Standard crop: chart area only, no toolbar. Annotate key levels in Spectre colors if `annotations` provided. Use for: article hero images (fallback if AI gen fails), X post chart attachments, OG images.

---

### `design/brand-asset-manager/`
**Status:** ⚠️ Partial (`[project]-brand/` exists)  
**Purpose:** Retrieve and apply brand assets for any project — logos, colors, icons.  
**Sources:** CoinGecko `image` field (logo), project website favicon, manual cache  
**Outputs:** `{ logoUrl, primaryColor, secondaryColor, name, symbol }`  
**Key rules:** Cache all logos locally — never hotlink from CoinGecko in production, they throttle. Fallback: generic dark gradient card with symbol text if no logo found.

---

## TIER 5 — SECURITY LAYER
*Trust nothing. Verify everything.*

---

### `security/contract-scanner/`
**Status:** ❌ Missing  
**Purpose:** Automated smart contract risk assessment before any token appears in Spectre research.  
**Sources:** GoPlus Security API (free), Token Sniffer, Honeypot.is  
**Inputs:** `contractAddress`, `chain`  
**Outputs:**
```json
{
  "safe": false,
  "riskLevel": "HIGH",
  "flags": [
    "Owner can disable sells",
    "Owner can change fees",
    "Mint function exists",
    "Contract not verified on Etherscan"
  ],
  "honeypot": false,
  "buyTax": 5,
  "sellTax": 10,
  "liquidityLocked": true,
  "liquidityLockExpiry": "2026-12-31"
}
```
**Key rules:** Run on every new token before generating any research. NEVER skip this step for unverified tokens. Honeypot = true means the article must open with a SCAM WARNING regardless of what else the research finds. Flags do not block article generation — they must appear in the Risk Assessment section prominently.

---

### `security/alert-monitor/`
**Status:** ❌ Missing  
**Purpose:** Real-time price and condition alerts that trigger notifications.  
**Alert types:**
- Price threshold (above/below)
- RSI overbought/oversold
- Volume spike (>3x 7-day average)
- TVL drop (>10% in 24h)
- GitHub goes dormant
- Whale wallet movement
- Breaking news mention  
**Outputs:** Alert fires → notification pushed → optional X post if public alert  
**Key rules:** Alerts have cooldowns — same alert cannot fire twice within 4 hours. User-set alerts take priority over system alerts. Never fire an alert for a price move that already happened more than 1 hour ago.

---

### `security/rate-limiter/`
**Status:** ❌ Missing  
**Purpose:** Budget and enforce API call limits across all skills to prevent runaway costs or bans.  
**Tracked APIs:** Perplexity, OpenAI, Stability AI, CoinGecko, Finnhub, GitHub, Reddit, YouTube  
**Rules:**
```
Perplexity:    max 100 calls/day, alert at 80
OpenAI:        max $5/day spend, alert at $4
Stability AI:  max 200 images/day
CoinGecko:     max 300 calls/min (free tier limit)
GitHub:        max 5000 calls/hour (authed), 60 unauthenticated
Reddit:        1 request/2 seconds
YouTube:       max 10,000 units/day
```
**Key rules:** If daily limit reached, queue non-critical calls for next day. Critical calls (breaking news, user-triggered searches) bypass queue. Log every call with cost estimate. Weekly report to admin.

---

### `security/exploit-monitor/`
**Status:** ❌ Missing  
**Purpose:** Real-time detection of hacks, exploits, and protocol failures.  
**Sources:** RSS from Rekt News, DeFiLlama hacks endpoint, X monitoring for "exploit" + "hack" keywords  
**Outputs:** Immediate alert + breaking article generation  
**Key rules:** This is Tier 1 breaking news — always immediate. Article must clearly state: what was exploited, how much was lost, which chain, whether funds are at risk. Never speculate on recovery. Recommend users check official channels for updates.

---

## TIER 6 — OPERATIONS LAYER
*The platform runs itself.*

---

### `operations/scheduler/`
**Status:** ⚠️ Exists but broken (156 stories bug)  
**Purpose:** Orchestrate all timed agent runs with deduplication guards.  
**Schedule:**
```
08:00 UTC    Daily Market Brief (1 article)
08:30 UTC    Top 5 crypto analyses (only tokens with significant 24h activity)
09:00 UTC    Top 3 stock analyses (only earnings-adjacent or moving >2%)
10:00 UTC    Narrative tracker refresh
16:00 UTC    Afternoon Pulse (only if markets moved materially)
Every 10min  Breaking news detection
Every 30min  RSS curator
Every 4h     Sentiment engine refresh for watchlist tokens
```
**Key rules:** `shouldGenerate()` guard on every run. Log every execution with duration and output. If the same article was generated in the last 8 hours (daily) or 20 hours (token/stock), skip without error.

---

### `operations/documentation-writer/`
**Status:** ❌ Missing  
**Purpose:** Auto-document what was built, changed, or fixed — so you always have a running changelog without writing it yourself.  
**Triggers:** After every significant Claude Code session, after every deployment  
**Outputs:** Appends to `docs/CHANGELOG.md` — date, what changed, what was fixed, what was added  
**Format:**
```markdown
## 2026-02-21

### Added
- Breaking news pipeline with SSE notifications
- Reddit reader skill
- Source priority logic in thesis agent

### Fixed
- 156 articles/day bug — scheduler now has shouldGenerate() guard

### Changed
- Article content law enforced across all agents
- Citations moved to sources panel, no inline [1][2][3]
```
**Key rules:** Machine-readable format. No narrative fluff. Every line is one concrete thing.

---

### `operations/error-reporter/`
**Status:** ❌ Missing  
**Purpose:** When any agent fails, write a structured error report instead of silently dying.  
**Outputs:** Appends to `logs/errors.log` AND pushes to admin notification  
**Format:**
```json
{
  "timestamp": "2026-02-21T13:00:00Z",
  "skill": "data/github-reader",
  "input": { "symbol": "NEURAL" },
  "error": "GitHub API rate limit exceeded",
  "errorCode": 403,
  "action": "Queued for retry in 60 minutes",
  "impact": "GitHub activity section missing from NEURAL thesis"
}
```
**Key rules:** Every error must include `action` — what will happen next. Errors that affect user-facing output must include `impact`. Never swallow errors silently.

---

### `operations/cost-tracker/`
**Status:** ❌ Missing  
**Purpose:** Track actual API spend daily and monthly. Alert when approaching budget.  
**Tracked:** Perplexity, OpenAI (text + images), Stability AI, ElevenLabs, YouTube API  
**Outputs:** `{ dailySpend, monthlySpend, projectedMonthly, topCostDrivers[], alerts[] }`  
**Key rules:** Update after every paid API call. Alert at 80% of daily budget. Weekly summary to admin. If monthly projection exceeds $500, flag immediately.

---

### `operations/health-checker/`
**Status:** ❌ Missing  
**Purpose:** Verify all external APIs and data sources are responding correctly.  
**Checks every 5 minutes:**
- Spectre backend `/api/health`
- CoinGecko response time < 2s
- Perplexity API reachable
- DeFiLlama API reachable
- RSS feeds returning data
- Breaking news agent last ran < 15 minutes ago
**Outputs:** Status dashboard + alert if any check fails 3 times consecutively  
**Key rules:** Never alert on single failure — only on 3 consecutive failures (avoids false alarms). Recovery is auto-detected and cancels the alert.

---

## MASTER SKILL SUMMARY

### Total Skills: 42

| Tier | Count | Have | Missing |
|------|-------|------|---------|
| Data Layer | 13 | 5 | 8 |
| Intelligence | 8 | 0 | 8 |
| Publishing | 8 | 1 | 7 |
| Design | 5 | 0 (partial) | 5 |
| Security | 4 | 0 | 4 |
| Operations | 5 | 1 (broken) | 4 |
| **Total** | **43** | **7** | **36** |

---

## BUILD PRIORITY ORDER

### Phase 1 — Fix & Foundation (Week 1)
These unblock everything else.
1. `operations/scheduler/` — fix the 156 bug first
2. `security/contract-scanner/` — GoPlus wrapper, runs before all research
3. `data/coingecko-deep/` — extends existing calls, unlocks GitHub/blog/team resolution
4. `publishing/breaking-news-handler/` — real-time pipeline + SSE notifications
5. `design/spectre-design-law/` — wrap as a skill so all UI agents read it automatically

### Phase 2 — Intelligence Core (Week 2)
6. `intelligence/ta-analyst/` — TA engine for chart integration
7. `intelligence/thesis-analyst/` — full trader research pipeline
8. `data/defillama/` — already exists, formalize as skill with proper spec
9. `data/reddit-reader/` — free API, high signal for microcaps
10. `data/github-reader/` — free API, dev activity check

### Phase 3 — Publishing Quality (Week 2-3)
11. `publishing/og-image-gen/` — social card generation
12. `publishing/seo-builder/` — metadata for every article
13. `publishing/thread-writer/` — X thread format
14. `intelligence/sentiment-engine/` — unified score across all sources
15. `data/x-scraper/` — expand existing Twitter skill

### Phase 4 — Coverage Expansion (Week 3-4)
16. `data/telegram-monitor/`
17. `data/youtube-monitor/`
18. `data/rss-aggregator/` — expand beyond 2 sources
19. `data/macro-feeds/` — Fed, CPI, yield curve
20. `intelligence/narrative-tracker/`

### Phase 5 — Operations & Creative (Week 4+)
21. `operations/error-reporter/`
22. `operations/cost-tracker/`
23. `operations/health-checker/`
24. `security/alert-monitor/`
25. `security/rate-limiter/`
26. `design/motion-designer/`
27. `design/ai-motion-designer/`
28. `design/chart-screenshot/`
29. `publishing/x-scheduler/`
30. `intelligence/earnings-analyst/`

---

## HOW TO CREATE A SKILL

Each skill is a folder with one `SKILL.md` file. Claude Code reads this file at the start of any task in that domain.

```bash
mkdir -p skills/data/reddit-reader
cat > skills/data/reddit-reader/SKILL.md << 'EOF'
# Reddit Reader Skill

## WHAT THIS SKILL DOES
Fetches recent Reddit posts about a crypto project to surface community sentiment,
red flags, and organic discussion.

## INPUTS
- symbol: string (e.g. "NEURAL")
- projectName: string (e.g. "NeuralAI")

## OUTPUTS
{ posts[], redFlagCount, sentiment, communitySubreddit }

## RULES
- Filter posts with score < 5
- Auto-detect rug/scam/exploit/abandoned keywords
- Rate limit: 1 request per 2 seconds
- Cache results for 30 minutes

## NEVER
- Access private subreddits
- Trust posts with 0 upvotes as signal
- Fabricate sentiment if data unavailable — return { available: false }

## FAILURE HANDLING
If Reddit returns 429: wait 10 seconds, retry once. If second attempt fails,
return { available: false, error: "rate_limited" } and log to error reporter.

## EXAMPLE OUTPUT
{ posts: [...], redFlagCount: 0, sentiment: "positive", communitySubreddit: null }
EOF
```

---

*Spectre AI — Master Skill Registry*
*Version 1.0 — February 2026*
*Next review: after Phase 2 completion*
