# SPECTRE NEWSROOM — 24/7 AI-Powered Media Publication

> **Paste into Claude Code. This upgrades the Intelligence Hub from a daily research library into a full 24/7 AI newsroom — the automated CoinDesk. Agents run continuously: curating breaking news, writing analysis, tagging sentiment, publishing stories throughout the day. The frontend becomes a media publication people visit as their primary crypto + stocks news source. Everything auto-generates with zero manual intervention.**

---

## READ FIRST

```bash
# Read existing Intelligence Hub code
cat src/pages/Intelligence/index.jsx | head -60
ls src/pages/Intelligence/components/
cat server/agents/scheduler.js | head -40
cat server/agents/dailyBriefAgent.js | head -40
cat server/content/store.js | head -40

# Read the design law
cat .cursor/rules/SPECTRE_DESIGN_LAW.md | head -100

# Check existing RSS and news endpoints
grep -n "api/news\|api/rss\|RSS_FEEDS" server/index.js | head -20

# Check what agents exist
ls server/agents/
```

---

## WHAT THIS CHANGES

The Intelligence Hub currently generates articles once a day at 08:00 UTC. That's a library, not a newsroom.

This upgrade adds:

1. **Continuous news agents** that run every 30 minutes, pulling RSS feeds, detecting breaking stories, and auto-publishing AI-written news briefs throughout the day
2. **Sentiment tagging** on every story (Bullish / Bearish / Neutral) with confidence scores
3. **Breaking news detection** — when a major event happens (ETF approval, hack, Fed decision), an agent picks it up from RSS within minutes and publishes a Spectre brief
4. **Featured stories** — the best/most important stories get auto-promoted to the hero section
5. **Category system** — Bitcoin, Ethereum, Solana, DeFi, NFTs, Regulation, Macro, Stocks, Earnings
6. **Live news timeline** — CoinDesk-style chronological feed with timestamps and sentiment dots
7. **The homepage redesign** — from empty feature page to a full publication layout

The daily brief and deep analysis agents still run daily. But now there are also fast-publishing news agents filling the feed 24/7.

---

## AGENT ARCHITECTURE — THE NEWSROOM

```
SPECTRE NEWSROOM — 5 Agent Types

┌─────────────────────────────────────────────────────────┐
│  NEWS CURATOR AGENT          Runs every 30 min          │
│  - Pulls RSS from CoinDesk, CoinTelegraph, Reuters,    │
│    The Block, Decrypt, DL News                          │
│  - Deduplicates against existing articles               │
│  - Scores newsworthiness (1-10)                         │
│  - Passes top stories to News Writer Agent              │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│  NEWS WRITER AGENT           Triggered by Curator       │
│  - Takes RSS story context + live Spectre data          │
│  - Writes 200-500 word Spectre news brief               │
│  - Adds: sentiment tag, category, related tickers       │
│  - Publishes immediately                                │
│  - Target: 15-30 stories per day                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  DAILY BRIEF AGENT           Runs at 08:00 + 16:00 UTC │
│  - Comprehensive market wrap (existing)                 │
│  - 1200-2000 words, covers everything                   │
│  - Auto-featured at top of page                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  DEEP ANALYSIS AGENT         Runs at 09:00 UTC daily    │
│  - Token analysis (25 crypto) + Stock analysis (27)     │
│  - 800-1500 words each (existing)                       │
│  - Updates analysis pages                               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  BREAKING NEWS AGENT         Runs every 10 min          │
│  - Monitors RSS for high-urgency keywords               │
│  - Keywords: hack, exploit, SEC, ETF approved/denied,   │
│    emergency, crash, surge, record, Fed, FOMC           │
│  - If detected: immediately generates breaking brief    │
│  - Tags as BREAKING with red badge                      │
│  - Pushes to top of feed                                │
└─────────────────────────────────────────────────────────┘
```

---

## NEW CONTENT TYPE: NEWS BRIEF

In addition to the existing article types (daily, crypto, stocks, research), add:

### Type: `news`

```javascript
// New article type in the schema
{
  slug: 'bitcoin-etf-record-inflow-feb-19',   // auto-generated from headline
  type: 'news',                                 // NEW type
  title: 'Bitcoin ETF Sees Record $1.2B Single-Day Inflow | Spectre AI',
  headline: 'Bitcoin ETF Sees Record $1.2B Single-Day Inflow',
  summary: 'Spot Bitcoin ETFs recorded their largest daily net inflow...',
  content: '...',                               // 200-500 words (shorter than analysis)
  
  // NEW fields for news
  sentiment: 'bullish',                         // "bullish" | "bearish" | "neutral"
  sentimentScore: 0.82,                         // 0-1 confidence
  category: 'bitcoin',                          // primary category
  categories: ['bitcoin', 'etf', 'institutional'],
  isBreaking: false,                            // true for breaking news
  isFeatured: false,                            // true for hero placement
  sourceArticle: {                              // the original RSS source
    title: 'Bitcoin ETFs See Record...',
    url: 'https://coindesk.com/...',
    source: 'CoinDesk',
    publishedAt: '2026-02-19T12:30:00Z',
  },
  
  // existing fields continue...
  tickers: ['BTC'],
  publishedAt: '2026-02-19T12:45:00Z',
  expiresAt: '2026-02-21T12:45:00Z',           // 48h for news
}
```

---

## AGENT 1: NEWS CURATOR — `server/agents/newsCuratorAgent.js`

Runs every 30 minutes. Pulls RSS feeds, scores stories, passes them to the writer.

```
RSS SOURCES (expand the existing RSS_FEEDS array):
- CoinDesk: https://www.coindesk.com/arc/outboundfeeds/rss/
- CoinTelegraph: https://cointelegraph.com/rss
- The Block: https://www.theblock.co/rss.xml
- Decrypt: https://decrypt.co/feed
- DL News: https://www.dlnews.com/rss/
- Bitcoin Magazine: https://bitcoinmagazine.com/feed
- Reuters Crypto: https://www.reuters.com/technology/rss (filter for crypto)
```

**Logic:**
1. Fetch all RSS feeds in parallel (existing `parseRssXml` function works)
2. Combine and sort by publishedAt descending
3. Deduplicate: check each story title against last 100 published Spectre articles (fuzzy match — if >70% word overlap with existing headline, skip)
4. Score newsworthiness 1-10 based on:
   - Contains trending tickers ($BTC, $ETH, $SOL) → +2
   - Contains high-impact keywords (ETF, SEC, hack, billion, record, surge, crash) → +3
   - From tier-1 source (CoinDesk, Reuters, Bloomberg) → +1
   - Less than 2 hours old → +2
   - Has specific numbers/data → +1
5. Take top 3-5 stories scoring 5+ and pass to News Writer Agent
6. Log all activity to agent activity feed

**Deduplication is critical.** Without it you'll publish the same story 10 times from different sources. Dedupe by:
- Normalize headline: lowercase, remove punctuation, remove common words (the, a, an, in, on, at, for)
- Compare normalized words against last 100 articles
- If >60% word overlap → same story, skip
- Also dedupe by ticker+topic: if you already published a BTC ETF story in the last 4 hours, skip similar ones

**Rate limiting:** Max 5 stories per 30-minute cycle. Max 30 stories per day. This prevents runaway publishing.

---

## AGENT 2: NEWS WRITER — `server/agents/newsWriterAgent.js`

Triggered by the Curator with a source article context. Writes a Spectre-branded news brief.

**Input:** Source article title, URL, summary, source name, detected tickers

**Data enrichment:** Before writing, pull live Spectre data for detected tickers:
- Crypto: price + 24h change from Binance/CoinGecko
- Stocks: price + change from Yahoo

**System prompt:**
```
You are a senior financial journalist at Spectre AI. Write a concise news brief about this developing story.

RULES:
- 200-500 words. Concise. Every sentence has information.
- Write as Spectre AI ("we", "our analysis")
- Lead with the most important fact (inverted pyramid)
- Include specific numbers: prices, percentages, dollar amounts
- Add Spectre's analytical context (not just restating the source)
- Tag sentiment: state whether this is bullish, bearish, or neutral for the assets involved, and why
- Reference the source but DON'T copy their text
- Include current price context for mentioned assets using the live data provided
- Professional tone. Not hype. Not doom. Just clear analysis.
- End with one sentence on what to watch next

STRUCTURE:
[Headline — factual, specific, includes key number]

[Lead paragraph — the core news in 2-3 sentences]

[Context paragraph — why this matters, historical context]

[Market impact — current prices, how markets are reacting]

[What to watch — one sentence forward-looking]

---
*Spectre AI News · {timestamp}*
```

**Sentiment classification:** After content generation, classify sentiment:
- If content contains: "surge", "record inflow", "approval", "bullish", "rally", "ATH", "growth" → bullish
- If content contains: "crash", "hack", "exploit", "decline", "bearish", "sell-off", "ban", "loss" → bearish
- Otherwise → neutral
- Set sentimentScore as confidence (0.5-1.0 range)
- Better: include sentiment classification in the Perplexity prompt and ask the model to return it in a structured format at the end of its response

**Category classification:** Based on tickers and keywords:
- BTC/Bitcoin → 'bitcoin'
- ETH/Ethereum → 'ethereum'  
- SOL/Solana → 'solana'
- DeFi/DEX/TVL/yield → 'defi'
- NFT/mint/collection → 'nfts'
- SEC/regulation/ban/compliance → 'regulation'
- Fed/rates/CPI/GDP/inflation → 'macro'
- Stock tickers / earnings / revenue → 'stocks'
- Multiple categories possible, first = primary

**Slug generation:** From headline, lowercased, hyphenated, appended with date:
`bitcoin-etf-record-inflow-feb-19-2026`

**Auto-feature logic:** If newsworthiness score >= 8 AND is from last 4 hours → set `isFeatured: true`

---

## AGENT 3: BREAKING NEWS AGENT — `server/agents/breakingNewsAgent.js`

Runs every 10 minutes. Monitors RSS for high-urgency events.

**Breaking keywords (case-insensitive):**
```
TIER 1 (immediate): hack, exploit, hacked, rug pull, emergency, halted, 
  SEC charges, ETF approved, ETF denied, FOMC, rate cut, rate hike

TIER 2 (high urgency): record, billion, crash, -10%, +10%, surge, plunge,
  all-time high, ATH, delisted, banned, subpoena, lawsuit, arrested
```

**Logic:**
1. Pull RSS feeds (same as curator)
2. Scan titles and summaries for Tier 1 keywords
3. If Tier 1 match found AND story is < 1 hour old AND not already covered:
   - Generate breaking brief immediately (same as news writer but with BREAKING tag)
   - Set `isBreaking: true`
   - Skip normal curator queue
4. If Tier 2 match AND score >= 7 AND < 2 hours old:
   - Fast-track to news writer with priority flag
5. Rate limit: max 3 breaking stories per day (to prevent alert fatigue)

---

## SCHEDULER UPGRADE — `server/agents/scheduler.js`

Replace the single daily cron with a multi-schedule system:

```javascript
function startNewsroom() {
  console.log('[newsroom] Starting Spectre Newsroom agents...');

  // Breaking News Agent — every 10 minutes
  setInterval(async () => {
    try {
      await runBreakingNewsAgent();
    } catch (e) {
      console.error('[newsroom:breaking] Error:', e.message);
    }
  }, 10 * 60 * 1000);

  // News Curator Agent — every 30 minutes
  setInterval(async () => {
    try {
      await runNewsCuratorAgent();
    } catch (e) {
      console.error('[newsroom:curator] Error:', e.message);
    }
  }, 30 * 60 * 1000);

  // Daily Brief — 08:00 and 16:00 UTC
  scheduleDailyAt(8, 0, generateDailyBrief);
  scheduleDailyAt(16, 0, generateDailyBrief); // afternoon update

  // Deep Analysis — 09:00 UTC
  scheduleDailyAt(9, 0, runDeepAnalysisCycle);

  // Run curator immediately on startup so there's content right away
  setTimeout(() => runNewsCuratorAgent(), 5000);
  
  console.log('[newsroom] All agents scheduled.');
}

// Helper: schedule a function to run at specific UTC hour/minute daily
function scheduleDailyAt(hour, minute, fn) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  
  const msUntil = next - now;
  console.log(`[newsroom] Scheduled ${fn.name} in ${(msUntil / 60000).toFixed(0)} min`);
  
  setTimeout(() => {
    fn().catch(e => console.error(`[newsroom] ${fn.name} failed:`, e.message));
    setInterval(() => {
      fn().catch(e => console.error(`[newsroom] ${fn.name} failed:`, e.message));
    }, 24 * 60 * 60 * 1000);
  }, msUntil);
}
```

**Key change:** The curator runs on startup with a 5-second delay. This means the moment you deploy, stories start appearing within minutes. No waiting until 08:00 UTC.

---

## FRONTEND REDESIGN — THE PUBLICATION

The current Intelligence Hub layout is a feature page. This redesign makes it a media publication. Reference CoinDesk's layout: live news timeline on the left, featured stories center, sidebar on the right.

### NEW LAYOUT — `/intelligence`

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Spectre AI        SPECTRE INTELLIGENCE         [Subscribe] [RSS]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─ BREAKING ──────────────────────────────────────────────────────┐   │
│  │  🔴 BREAKING: SEC Approves Spot Solana ETF — SOL +18%          │   │
│  │  2 min ago · Read →                                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  (only visible when isBreaking article exists from last 4 hours)       │
│                                                                         │
│  FILTER: [All] [Bitcoin] [Ethereum] [Solana] [DeFi] [Stocks] [Macro]  │
│                                                                         │
│  ┌──────────────┐ ┌────────────────────────────────┐ ┌──────────────┐ │
│  │ LATEST NEWS  │ │ FEATURED                       │ │ MARKET DATA  │ │
│  │              │ │                                │ │              │ │
│  │ 12:30 PM     │ │ ┌────────────────────────────┐ │ │ BTC          │ │
│  │ ● Neutral    │ │ │  TODAY'S BRIEF              │ │ │ $98,421      │ │
│  │ Bitcoin,     │ │ │                              │ │ │ +2.3%        │ │
│  │ ether rise   │ │ │  BTC Holds $98K as ETF      │ │ │              │ │
│  │ as altcoins  │ │ │  Inflows Surge; NVDA        │ │ │ ETH          │ │
│  │ lag in low-  │ │ │  Rallies on AI Spending     │ │ │ $3,245       │ │
│  │ volatility   │ │ │                              │ │ │ -1.1%        │ │
│  │ trade        │ │ │  Markets showed resilience   │ │ │              │ │
│  │              │ │ │  today as institutional...   │ │ │ SOL          │ │
│  │ ─────────── │ │ │                              │ │ │ $178.42      │ │
│  │              │ │ │  [Read Full Brief →]         │ │ │ +5.2%        │ │
│  │ 12:26 PM     │ │ └────────────────────────────┘ │ │              │ │
│  │ ● Bullish    │ │                                │ │ ─────────── │ │
│  │ Stablecoin   │ │ ┌─────────────┐┌────────────┐ │ │              │ │
│  │ users: 77%   │ │ │ WLFI surges ││ Coinbase   │ │ │ F&G: 72     │ │
│  │ would open   │ │ │ 10% after   ││ lets XRP   │ │ │ Greed        │ │
│  │ bank wallet  │ │ │ Apex deal   ││ holders    │ │ │              │ │
│  │              │ │ │             ││ borrow     │ │ │ S&P 500      │ │
│  │ ─────────── │ │ │  8h ago     ││ $100K      │ │ │ 6,129        │ │
│  │              │ │ └─────────────┘└────────────┘ │ │ +0.4%        │ │
│  │ 8:25 AM      │ │                                │ │              │ │
│  │ ● Bullish    │ │ ┌─────────────┐┌────────────┐ │ │ NASDAQ       │ │
│  │ Ledn raises  │ │ │ BTC ETF     ││ Ether, XRP │ │ │ 19,891       │ │
│  │ $188m with   │ │ │ record      ││ slide in   │ │ │ +0.6%        │ │
│  │ first bitcoin│ │ │ inflow      ││ crypto     │ │ │              │ │
│  │ backed bond  │ │ │             ││ retreat    │ │ │ ─────────── │ │
│  │              │ │ └─────────────┘└────────────┘ │ │              │ │
│  │ ─────────── │ │                                │ │ AGENT STATUS │ │
│  │              │ │ VIEW ALL STORIES →             │ │ ● Curator    │ │
│  │ 8:25 AM      │ │                                │ │   ran 4m ago │ │
│  │ ● Neutral    │ │                                │ │ ● Writer     │ │
│  │ BTC, ETH     │ │                                │ │   idle       │ │
│  │ ETFs bleed   │ │                                │ │ ● Analyst    │ │
│  │ while SOL    │ │                                │ │   ran 2h ago │ │
│  │ bucks trend  │ │                                │ │              │ │
│  │              │ │                                │ │ 47 articles  │ │
│  │ VIEW ALL →   │ │                                │ │ today        │ │
│  └──────────────┘ └────────────────────────────────┘ └──────────────┘ │
│                                                                         │
│  ┌─ RESEARCH ──────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │   │
│  │  │ BTC      │ │ ETH      │ │ NVDA     │ │ PLTR     │   →      │   │
│  │  │ $98,421  │ │ $3,245   │ │ $142.30  │ │ $133.20  │          │   │
│  │  │ +2.3%    │ │ -1.1%    │ │ +3.8%    │ │ +5.3%    │          │   │
│  │  │ Analysis │ │ Analysis │ │ Analysis │ │ Analysis │          │   │
│  │  │ Updated  │ │ Updated  │ │ Updated  │ │ Updated  │          │   │
│  │  │ 2h ago   │ │ 2h ago   │ │ 3h ago   │ │ 3h ago   │          │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │   │
│  │                                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  FOOTER: RSS Feeds · About · Disclaimer                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### THREE-COLUMN LAYOUT

**Left column (~250px): Live News Timeline**
- Chronological feed of ALL published news briefs
- Each entry: timestamp (monospace), sentiment dot (green/red/gray), headline (2-3 lines), preview text
- Subtle divider between entries
- Sentiment dots: green (#10B981) = bullish, red (#EF4444) = bearish, gray (rgba(255,255,255,0.32)) = neutral
- Clicking any entry opens the full article
- "View All →" at bottom links to full feed page
- Auto-refreshes every 60 seconds via polling
- Shows last 10-15 stories in the sidebar

**Center column (~flex 1): Featured Content**
- Top: Today's daily brief in a premium glass card (Welcome Widget pattern)
- Below: 2x2 grid of featured/recent stories with headlines and timestamps
- Below: "View All Stories →" link
- Stories with `isFeatured: true` get promoted here
- If no featured stories, show most recent 4 with highest newsworthiness scores

**Right column (~220px): Market Data + Agent Status**
- Live prices for BTC, ETH, SOL (pulling from existing `/api/tickers`)
- Fear & Greed index (from existing `/api/fear-greed`)
- S&P 500, NASDAQ (from existing `/api/stocks/indices`)
- All prices in monospace, green/red for changes
- Divider
- Agent Status section: shows last run time for each agent type (curator, writer, analyst)
- "X articles today" counter

### CATEGORY FILTER BAR

Horizontal scrollable pills below the header:
`[All] [Bitcoin] [Ethereum] [Solana] [DeFi] [Regulation] [Macro] [Stocks]`

- Active filter uses accent background `rgba(139,92,246,0.15)` with accent border
- Inactive filters use ghost button style
- Filtering affects BOTH the left timeline AND center featured stories
- "All" selected by default

### BREAKING NEWS BANNER

Only visible when an article with `isBreaking: true` exists from the last 4 hours:
- Full-width banner at top of content area
- Red (#EF4444) accent left border or pulsing red dot
- Bold headline, relative time, "Read →" link
- Background: `rgba(239,68,68,0.06)` with `border: 1px solid rgba(239,68,68,0.15)`
- Dismiss button (X) hides it for current session
- Auto-disappears after 4 hours

---

## UPDATED COMPONENT STRUCTURE

```
src/pages/Intelligence/
├── index.jsx                         — Main layout, three-column grid
├── Intelligence.css                   — All styles
├── components/
│   ├── IntelligenceHeader.jsx         — Top bar
│   ├── BreakingBanner.jsx             — Breaking news alert bar
│   ├── CategoryFilter.jsx             — Horizontal filter pills
│   │
│   ├── NewsTimeline.jsx               — Left column: live news feed
│   ├── NewsTimelineItem.jsx           — Single timeline entry
│   ├── SentimentDot.jsx               — Green/red/gray dot component
│   │
│   ├── FeaturedSection.jsx            — Center column container
│   ├── DailyBriefCard.jsx             — Hero card for today's brief
│   ├── FeaturedStoryCard.jsx          — Story card in 2x2 grid
│   │
│   ├── MarketSidebar.jsx              — Right column: prices + agent status
│   ├── PriceTicker.jsx                — Single price display row
│   ├── AgentStatusWidget.jsx          — Agent last-run times
│   │
│   ├── ResearchRow.jsx                — Horizontal scroll of analysis cards
│   ├── ResearchCard.jsx               — Single analysis card (BTC, ETH, NVDA...)
│   │
│   ├── ArticlePage.jsx                — Full article reader (existing, keep)
│   ├── ArticleSkeleton.jsx            — Loading state
│   └── CategoryBadge.jsx              — Category/sentiment pill
```

### RESPONSIVE BEHAVIOR

- **Desktop (>1200px):** Three columns as shown
- **Tablet (768-1200px):** Two columns — news timeline collapses, featured + sidebar
- **Mobile (<768px):** Single column — breaking banner → featured → news timeline → sidebar stacks below

---

## DATA FETCHING

The main Intelligence page needs these API calls on mount:

```javascript
// Parallel fetch on page load
const [
  newsArticles,    // GET /api/intelligence/news?limit=15
  featuredArticles,// GET /api/intelligence/featured?limit=5
  dailyBrief,     // GET /api/intelligence/daily/latest
  activity,        // GET /api/intelligence/activity?limit=5
  stats,           // GET /api/intelligence/stats
] = await Promise.all([...]);

// Separate live data (refresh independently)
const prices = await fetch('/api/tickers');       // existing endpoint
const indices = await fetch('/api/stocks/indices'); // existing endpoint
const fearGreed = await fetch('/api/fear-greed');   // existing endpoint
```

**Polling intervals:**
- News timeline: every 60 seconds
- Prices/indices: every 30 seconds
- Activity/stats: every 60 seconds
- Featured: every 5 minutes

### NEW API ENDPOINTS

```
GET /api/intelligence/news?limit=15&category=bitcoin
  → Returns news-type articles, sorted by publishedAt desc
  → Supports category filter

GET /api/intelligence/featured?limit=5
  → Returns articles with isFeatured=true OR highest newsworthiness
  → Falls back to most recent if no featured exist

GET /api/intelligence/daily/latest
  → Returns the most recent daily brief article

GET /api/intelligence/breaking
  → Returns breaking articles from last 4 hours (if any)

GET /api/intelligence/stats
  → Returns: { totalToday, totalAll, lastCuratorRun, lastWriterRun, 
              lastAnalystRun, agentsActive, articlesByCategory }
```

---

## UPDATED STORE — `server/content/store.js`

Add these functions to the existing store:

```javascript
// List news articles with optional category filter
function listNews(options = {}) {
  let articles = listArticles('news', { limit: options.limit || 20 });
  if (options.category && options.category !== 'all') {
    articles = articles.filter(a =>
      a.categories?.includes(options.category) ||
      a.category === options.category
    );
  }
  return articles;
}

// Get featured articles
function getFeatured(limit = 5) {
  const all = listAllPublished();
  const featured = all.filter(a => a.isFeatured);
  if (featured.length >= limit) return featured.slice(0, limit);
  // Backfill with recent non-featured articles
  const recent = all.filter(a => !a.isFeatured).slice(0, limit - featured.length);
  return [...featured, ...recent].slice(0, limit);
}

// Get breaking news (last 4 hours)
function getBreaking() {
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const all = listArticles('news', { limit: 10 });
  return all.filter(a => a.isBreaking && a.publishedAt > cutoff);
}

// Get latest daily brief
function getLatestDailyBrief() {
  const briefs = listArticles('daily', { limit: 1 });
  return briefs[0] || null;
}

// Get stats
function getStats() {
  const types = ['daily', 'crypto', 'stocks', 'research', 'news'];
  let totalAll = 0;
  let totalToday = 0;
  const today = new Date().toISOString().split('T')[0];
  const byCategory = {};

  types.forEach(type => {
    const articles = listArticles(type);
    totalAll += articles.length;
    articles.forEach(a => {
      if (a.publishedAt?.startsWith(today)) totalToday++;
      (a.categories || []).forEach(c => {
        byCategory[c] = (byCategory[c] || 0) + 1;
      });
    });
  });

  return { totalAll, totalToday, articlesByCategory: byCategory };
}
```

Update the `ensureContentDirs()` function to include the `news` directory:
```javascript
const types = ['daily', 'crypto', 'stocks', 'research', 'data', 'news'];
```

---

## SEO UPDATES

### Update sitemap.xml
Add news articles. News articles get `priority: 0.6` and `changefreq: daily`.

### Update RSS feeds
Add a news-specific feed:
```
GET /api/rss/news → RSS feed of news briefs only
```

### Update llms.txt
Add news section:
```
- News Briefs: /intelligence/news/{slug} — AI-written market news published continuously throughout the day
- News RSS: /api/rss/news
```

### Update robots.txt
No changes needed — `/intelligence/` is already allowed.

---

## PERPLEXITY COST UPDATE

With continuous news publishing:
- Daily brief: 2× per day = ~$0.03
- Deep analysis: 52 articles = ~$0.52
- News briefs: ~20-30 per day × ~$0.005 each (shorter, less context) = ~$0.15
- Breaking: ~2-3 per day = ~$0.03
- **Total: ~$0.73/day → ~$22/month**

Still negligible. And now you're publishing 70-80+ pieces of content per day.

---

## BUILD ORDER

1. **Update store** — add `news` type, new query functions (listNews, getFeatured, getBreaking, getLatestDailyBrief, getStats)
2. **News Curator Agent** — RSS fetching, deduplication, scoring
3. **News Writer Agent** — Perplexity-powered brief generation with sentiment
4. **Breaking News Agent** — keyword monitoring, urgent publishing
5. **Update scheduler** — multi-interval system, run curator on startup
6. **New API endpoints** — /news, /featured, /breaking, /daily/latest, /stats
7. **Update SEO** — add news to sitemap, RSS, llms.txt
8. **Frontend redesign** — three-column layout, news timeline, featured section, market sidebar
9. **Breaking banner** — conditional display component
10. **Category filters** — horizontal pills with filtering logic
11. **Research row** — horizontal scroll of analysis cards at bottom
12. **Responsive** — tablet and mobile layouts
13. **Test** — verify agents run on startup, news appears within 5 minutes of deploy

---

## VERIFICATION

```bash
# 1. Start server — curator should run within 5 seconds
npm run dev
# Watch logs for: [newsroom] Starting Spectre Newsroom agents...
# Then: [curator] Found X new stories, passing to writer...

# 2. Check news articles generated
sleep 120 && curl http://localhost:3001/api/intelligence/news | jq '.count'
# Should show 3-5 articles within first few minutes

# 3. Check featured
curl http://localhost:3001/api/intelligence/featured | jq '.[0].headline'

# 4. Check breaking (may be empty if no breaking news)
curl http://localhost:3001/api/intelligence/breaking | jq '.'

# 5. Check stats
curl http://localhost:3001/api/intelligence/stats | jq '.'

# 6. Check activity log shows agent runs
curl http://localhost:3001/api/intelligence/activity | jq '.events[:3]'

# 7. Verify news articles have sentiment
curl http://localhost:3001/api/intelligence/news | jq '.articles[0].sentiment'

# 8. Check news RSS feed
curl http://localhost:3001/api/rss/news | head -30

# 9. Open in browser
# http://localhost:3000/intelligence
# Should see: breaking banner (if applicable), news timeline populating,
# featured stories, market data sidebar, agent status showing recent runs

# 10. Wait 30 minutes, check again — new stories should appear
```
