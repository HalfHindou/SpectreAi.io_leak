# SPECTRE INTELLIGENCE HUB — Full Build Prompt

> **Paste into Claude Code. This builds the complete Intelligence Hub: public-facing subpage at /intelligence with full UI/UX, content generation agents, real-time agent activity feed, news articles, RSS views, SEO infrastructure, and AISEO. Everything follows SPECTRE_DESIGN_LAW.md exactly. Read that file FIRST before touching any UI.**

---

## BEFORE YOU WRITE A SINGLE LINE

```bash
# 1. Read the design law (MANDATORY)
cat .cursor/rules/SPECTRE_DESIGN_LAW.md

# 2. Read the design system tokens
cat DESIGN_SYSTEM.md | head -100
cat src/index.css | head -80

# 3. Study the reference component
cat src/components/WelcomePage.jsx | head -100
cat src/components/WelcomePage.css | head -80

# 4. Read the icon system
cat src/icons/spectreIcons.jsx | head -30

# 5. Understand existing structure
ls src/pages/
cat src/constants/pageRoutes.js
cat src/App.jsx | head -60

# 6. Check existing endpoints you'll connect to
grep -n "api/tickers\|api/stocks\|api/news\|api/fear-greed\|api/rss" server/index.js | head -20

# 7. Check existing posting system
cat docs/spectre_posting_skill.md 2>/dev/null | head -40
```

**DO NOT skip this step. If your UI doesn't match WelcomePage.jsx quality and aesthetic, rebuild it.**

---

## WHAT WE'RE BUILDING

An Intelligence Hub subpage at `/intelligence` that serves as Spectre's public-facing research arm. Users land here and see:

1. A premium editorial-style page with today's market brief, latest research articles, and live data
2. Real-time feed showing what Spectre's AI agents are doing right now (generating, updating, publishing)
3. Curated news from RSS sources alongside Spectre's own AI-generated analysis
4. Individual article pages for each daily brief, token analysis, and stock analysis
5. Full SEO infrastructure so every page gets crawled, indexed, and cited

This is NOT a hidden backend tool. This is a user-facing product page that people visit, read, and share.

---

## PAGE ARCHITECTURE

```
/intelligence                        → Hub landing (main page)
/intelligence/daily/:date            → Daily market brief article
/intelligence/crypto/:slug           → Token analysis article
/intelligence/stocks/:symbol         → Stock analysis article
/intelligence/research/:slug         → Thematic deep dive
/intelligence/feed                   → Full agent activity + news feed
```

---

## THE INTELLIGENCE HUB LANDING — `/intelligence`

### Layout (top to bottom):

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER BAR                                                      │
│ ← Back to Spectre    INTELLIGENCE HUB    [RSS] [Subscribe]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ HERO SECTION                                                    │
│ ┌─────────────────────────────────────────────────────────┐    │
│ │  SPECTRE INTELLIGENCE                                    │    │
│ │  "AI-powered market research, published daily"           │    │
│ │                                                          │    │
│ │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │    │
│ │  │ 53       │ │ 24/7     │ │ 19,345   │ │ LIVE      │  │    │
│ │  │ Articles │ │ Coverage │ │ Total    │ │ Agents    │  │    │
│ │  │ /day     │ │          │ │ Articles │ │ Active    │  │    │
│ │  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │    │
│ └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│ TAB BAR                                                         │
│ [Overview] [Daily Briefs] [Crypto] [Stocks] [Feed] [RSS]      │
│                                                                 │
│ ═══════════════════════════════════════════════════════════════ │
│                                                                 │
│ OVERVIEW TAB (default):                                         │
│                                                                 │
│ ┌─── TODAY'S BRIEF ──────────────────────────────────────────┐ │
│ │ FEBRUARY 19, 2026                                          │ │
│ │ "BTC Holds $98K as ETF Inflows Surge;                     │ │
│ │  NVDA Rallies on AI Spending Estimates"                    │ │
│ │                                                            │ │
│ │ First 3-4 paragraphs of today's brief...                  │ │
│ │                                                            │ │
│ │ [Read Full Brief →]                                        │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─── LATEST CRYPTO RESEARCH ─────┐ ┌─── LATEST STOCK ────────┐│
│ │                                 │ │    RESEARCH              ││
│ │  ┌───────────────────────────┐  │ │ ┌────────────────────┐  ││
│ │  │ BTC  $98,421  +2.3%      │  │ │ │ NVDA  $142  +3.8%  │  ││
│ │  │ Updated 2h ago           │  │ │ │ Updated 3h ago     │  ││
│ │  └───────────────────────────┘  │ │ └────────────────────┘  ││
│ │  ┌───────────────────────────┐  │ │ ┌────────────────────┐  ││
│ │  │ ETH  $3,245  -1.1%       │  │ │ │ AAPL  $265  +3.1%  │  ││
│ │  └───────────────────────────┘  │ │ └────────────────────┘  ││
│ │  ┌───────────────────────────┐  │ │ ┌────────────────────┐  ││
│ │  │ SOL  $178  +5.2%         │  │ │ │ PLTR  $133  +5.3%  │  ││
│ │  └───────────────────────────┘  │ │ └────────────────────┘  ││
│ │                                 │ │                          ││
│ │  [View All Crypto Research →]   │ │ [View All Stock →]      ││
│ └─────────────────────────────────┘ └──────────────────────────┘│
│                                                                 │
│ ┌─── AGENT ACTIVITY (LIVE) ──────────────────────────────────┐ │
│ │  ● LIVE                                                     │ │
│ │                                                             │ │
│ │  ┌ 2 min ago ─────────────────────────────────────────────┐│ │
│ │  │ 📊 Market Brief Agent published daily brief            ││ │
│ │  │    "Crypto & Stock Market Brief — Feb 19, 2026"        ││ │
│ │  └────────────────────────────────────────────────────────┘│ │
│ │  ┌ 14 min ago ────────────────────────────────────────────┐│ │
│ │  │ 🔄 Token Agent updated analysis for SOL                ││ │
│ │  │    Price: $178.42 (+5.2%) | 1,247 words | 8 sources    ││ │
│ │  └────────────────────────────────────────────────────────┘│ │
│ │  ┌ 22 min ago ────────────────────────────────────────────┐│ │
│ │  │ 📈 Stock Agent updated analysis for NVDA               ││ │
│ │  │    Price: $142.30 (+3.8%) | 1,102 words | 6 sources    ││ │
│ │  └────────────────────────────────────────────────────────┘│ │
│ │                                                             │ │
│ │  [View Full Activity Feed →]                                │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─── NEWS WIRE ──────────────────────────────────────────────┐ │
│ │  Live from CoinDesk, CoinTelegraph, and more               │ │
│ │                                                             │ │
│ │  ┌──────┐ Bitcoin ETF Sees Record $1.2B Inflow             │ │
│ │  │ img  │ CoinDesk · 45 min ago                            │ │
│ │  └──────┘                                                   │ │
│ │  ┌──────┐ Fed Minutes Show Rate Cuts On Hold               │ │
│ │  │ img  │ Reuters · 2h ago                                 │ │
│ │  └──────┘                                                   │ │
│ │                                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ FOOTER                                                          │
│ RSS Feeds: [All] [Daily] [Crypto] [Stocks]                     │
│ "Published by Spectre AI agents. Updated continuously."        │
└─────────────────────────────────────────────────────────────────┘
```

### Tab Views:

**Overview** — Default. Today's brief preview + latest research cards + agent activity + news wire.

**Daily Briefs** — Chronological list of all daily briefs. Each card shows date, headline, market summary, BTC price at time. Click to read full article.

**Crypto** — Grid of token analysis cards sorted by market cap. Each card: token logo, name, symbol, price, 24h change, last updated time. Click for full analysis. Filter by category (L1, DeFi, Meme, AI, etc).

**Stocks** — Grid of stock analysis cards sorted by market cap. Each card: company logo (Clearbit), name, symbol, price, change, sector badge. Click for full analysis. Filter by sector.

**Feed** — Full real-time agent activity log. Every generation event: which agent, what it produced, when, word count, sources cited, generation time. This is the "engine room" view — users see Spectre's agents working in real time.

**RSS** — Display of incoming RSS feeds from CoinDesk, CoinTelegraph, and other sources. Also shows links to Spectre's own RSS feeds for subscription. Display as a clean feed reader UI.

---

## FRONTEND BUILD — COMPONENT STRUCTURE

```
src/pages/Intelligence/
├── index.jsx                    — Main page, tab routing, data fetching
├── Intelligence.css              — All styles (FOLLOW DESIGN LAW)
├── components/
│   ├── IntelligenceHeader.jsx    — Top bar with back button, title, RSS/subscribe
│   ├── HeroStats.jsx             — 4 stat counters (articles/day, coverage, total, agents)
│   ├── TabBar.jsx                — Overview | Daily | Crypto | Stocks | Feed | RSS
│   │
│   ├── OverviewTab.jsx           — Default view combining all sections
│   ├── TodaysBrief.jsx           — Today's daily brief preview card
│   ├── LatestResearchGrid.jsx    — Two-column grid: crypto left, stocks right
│   ├── ResearchCard.jsx          — Individual article card (reused everywhere)
│   ├── AgentActivityFeed.jsx     — Live agent activity section
│   ├── AgentActivityItem.jsx     — Single activity log entry
│   ├── NewsWire.jsx              — RSS news feed section
│   ├── NewsItem.jsx              — Single news article row
│   │
│   ├── DailyBriefsTab.jsx        — Full list of daily briefs
│   ├── CryptoTab.jsx             — Grid of crypto analyses with filters
│   ├── StocksTab.jsx             — Grid of stock analyses with filters
│   ├── FeedTab.jsx               — Full agent activity feed
│   ├── RSSTab.jsx                — RSS reader + Spectre feed links
│   │
│   ├── ArticlePage.jsx           — Full article reader view
│   ├── ArticleSkeleton.jsx       — Loading state for articles
│   └── CategoryBadge.jsx         — Sector/category pill badge
```

### CRITICAL DESIGN RULES

Read from SPECTRE_DESIGN_LAW.md. Apply these EXACTLY:

**Page background:** `var(--bg-base)` (#0c0c0e)

**Cards:** Use the Glass Card pattern:
```css
background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
backdrop-filter: blur(20px);
border: 1px solid var(--border-default);
border-radius: var(--radius-lg);
box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 16px rgba(0,0,0,0.5);
```
On hover: `border-color: var(--border-strong)`, `transform: translateY(-2px)`

**Today's Brief card:** Use the premium Welcome Widget container pattern (the big glass card with multiple inset box-shadows). This is the hero content.

**Section labels:** `var(--font-body)`, 11px, weight 600, `letter-spacing: 0.1em`, uppercase, `var(--text-muted)`. Example: "LATEST CRYPTO RESEARCH", "AGENT ACTIVITY", "NEWS WIRE"

**Prices:** Always `var(--font-mono)`, weight 700. Green for positive, red for negative.

**Timestamps:** `var(--font-mono)`, `var(--text-tertiary)`, 12px

**Tab bar:** Ghost button style for inactive tabs. Active tab gets `var(--accent)` text + subtle accent border-bottom or background.

**Research cards:** Inner card pattern: `background: linear-gradient(180deg, #0c0c10 0%, #08080c 100%)`

**Agent activity items:** Subtle left border-accent on the latest entry. Time-relative labels ("2 min ago", "14 min ago"). Status dots: green (live/completed), yellow (generating), gray (scheduled).

**News wire items:** Image thumbnail on left (48x48, rounded), title, source, time on right. Subtle separator between items.

**Loading:** Skeleton shimmer everywhere. NEVER spinners.

**Icons:** Use only icons from `src/icons/spectreIcons.jsx`. Check what's available first. If you need an icon that doesn't exist, create an SVG that matches the existing style.

**Fonts:**
- Page title "SPECTRE INTELLIGENCE": `var(--font-display)` (Space Grotesk)
- Article headlines: `var(--font-display)`, weight 600
- Body text / descriptions: `var(--font-body)` (Inter)
- Prices, numbers, dates, stats: `var(--font-mono)` (JetBrains Mono)
- Section labels: `var(--font-body)`, uppercase

**No emojis in the UI.** The agent activity items use Spectre icons, not emojis. The layout mock above uses emojis for readability — replace with proper icons.

---

## ARTICLE PAGE — `/intelligence/:type/:slug`

When a user clicks any research card, they land on a full article page:

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back to Intelligence Hub                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CRYPTO ANALYSIS                       Updated 2 hours ago     │
│                                                                 │
│  ┌─ LIVE DATA CARD ──────────────────────────────────────────┐ │
│  │  BTC   Bitcoin                                  $98,421   │ │
│  │  ████████████████████ (sparkline)          +2.3% (24h)    │ │
│  │                                                            │ │
│  │  Mkt Cap: $1.94T  │  Vol: $48.2B  │  Rank: #1            │ │
│  │  52W: $42,100 - $108,200  │  ATH: $108,200 (-9.1%)       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ ARTICLE ─────────────────────────────────────────────────┐ │
│  │                                                            │ │
│  │  Bitcoin (BTC) Analysis — Price, Fundamentals              │ │
│  │  & Outlook                                                 │ │
│  │                                                            │ │
│  │  Published Feb 19, 2026 · 1,247 words · 8 sources         │ │
│  │                                                            │ │
│  │  ## Overview                                               │ │
│  │  Bitcoin continues to hold above the $98,000 level...      │ │
│  │                                                            │ │
│  │  ## Price Analysis                                         │ │
│  │  ...                                                       │ │
│  │                                                            │ │
│  │  ## Spectre Verdict                                        │ │
│  │  ...                                                       │ │
│  │                                                            │ │
│  │  ─────────────────────────────────                         │ │
│  │  Sources: [1] [2] [3] [4] [5] [6] [7] [8]                │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ RELATED RESEARCH ────────────────────────────────────────┐ │
│  │  ETH Analysis    SOL Analysis    BTC vs ETH               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ CTA ─────────────────────────────────────────────────────┐ │
│  │  Get real-time intelligence on any asset.                  │ │
│  │  [Open Spectre AI →]        [Open in Research Zone →]     │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Article page components:**
- **Category badge** at top left ("CRYPTO ANALYSIS", "DAILY BRIEF", "EQUITY RESEARCH") — use section label styling with subtle accent background
- **Live Data Card** — pulls real-time price from Spectre's backend (NOT the article's stale snapshot). Shows sparkline chart, key metrics. Uses Inner Card pattern.
- **Article body** — Markdown rendered to styled HTML. Headings in Space Grotesk, body in Inter, all $TICKER references highlighted in monospace with subtle purple background. Generous line-height (1.7+).
- **Sources** — Citation pills at bottom, each showing domain favicon + number. Click opens source.
- **Related research** — 3 cards linking to related analyses.
- **CTA** — Glass card linking to the full Spectre app or directly to Research Zone for that ticker.

---

## AGENT ACTIVITY SYSTEM

This is the "engine room" that makes Spectre feel alive. Users see AI agents working in real time.

### Activity Log Schema

```javascript
// server/agents/activityLog.js

// In-memory activity log (last 200 events)
const activityLog = [];
const MAX_LOG_SIZE = 200;

function logAgentActivity(event) {
  const entry = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    agent: event.agent,       // "market-brief" | "token-analysis" | "stock-analysis" | "thematic"
    action: event.action,     // "started" | "completed" | "failed" | "updated" | "scheduled"
    target: event.target,     // "BTC" | "NVDA" | "2026-02-19" | etc
    targetType: event.targetType, // "crypto" | "stock" | "daily" | "research"
    details: {
      title: event.title || null,
      wordCount: event.wordCount || null,
      sourceCount: event.sourceCount || null,
      generationTimeMs: event.generationTimeMs || null,
      price: event.price || null,
      change: event.change || null,
      slug: event.slug || null,
    },
  };

  activityLog.unshift(entry);
  if (activityLog.length > MAX_LOG_SIZE) activityLog.pop();
  return entry;
}

function getActivityLog(limit = 20) {
  return activityLog.slice(0, limit);
}

module.exports = { logAgentActivity, getActivityLog };
```

### Integrate Into Agents

Every agent logs activity at start and completion:

```javascript
// In generateDailyBrief():
logAgentActivity({
  agent: 'market-brief',
  action: 'started',
  target: today,
  targetType: 'daily',
  title: `Generating daily brief for ${today}`,
});

// ... after generation completes:
logAgentActivity({
  agent: 'market-brief',
  action: 'completed',
  target: today,
  targetType: 'daily',
  title: article.headline,
  wordCount: content.split(/\s+/).length,
  sourceCount: citations.length,
  generationTimeMs: Date.now() - startTime,
  slug: article.slug,
});
```

Same pattern for token and stock agents — log "started" and "completed" with metrics.

### Activity API Endpoint

```javascript
app.get('/api/intelligence/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const log = getActivityLog(limit);
  res.setHeader('Cache-Control', 'public, max-age=30'); // 30s cache
  res.json({ count: log.length, events: log });
});
```

### Frontend Activity Display

The `AgentActivityFeed` component:
- Polls `/api/intelligence/activity` every 30 seconds
- Each item shows: agent icon, action description, target (with ticker link), relative time
- "completed" events show: word count, source count, generation time
- "started" events show a subtle pulsing dot animation (agent is working)
- "failed" events show in `var(--bear)` red with error message
- Newest entries slide in from the top with a subtle animation

Agent icons (use Spectre icons or create matching SVGs):
- Market Brief Agent → newspaper/document icon
- Token Analysis Agent → chart/trending icon  
- Stock Analysis Agent → bar chart icon
- Thematic Agent → lightbulb/research icon

---

## RSS TAB

The RSS tab has two sections:

### Section 1: Subscribe to Spectre

Show Spectre's own RSS feed URLs in a clean card:

```
┌─ SUBSCRIBE TO SPECTRE INTELLIGENCE ──────────────────────────┐
│                                                               │
│  Add these feeds to your RSS reader:                          │
│                                                               │
│  All Research       /api/rss              [Copy URL]          │
│  Daily Briefs       /api/rss/daily        [Copy URL]          │
│  Crypto Analysis    /api/rss/crypto       [Copy URL]          │
│  Stock Analysis     /api/rss/stocks       [Copy URL]          │
│                                                               │
│  Also available: /llms.txt for AI models                      │
└───────────────────────────────────────────────────────────────┘
```

### Section 2: News Reader

Display aggregated RSS feeds from external sources (using your existing `/api/news/rss` endpoint):

```
┌─ MARKET NEWS ────────────────────────────────────────────────┐
│  Sources: CoinDesk · CoinTelegraph                           │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ [img]  Bitcoin ETF Sees Record Inflow as...              ││
│  │        CoinDesk · 45 min ago                    [Open →] ││
│  ├──────────────────────────────────────────────────────────┤│
│  │ [img]  Fed Minutes Show Rate Cuts Delayed...             ││
│  │        CoinTelegraph · 2h ago                   [Open →] ││
│  ├──────────────────────────────────────────────────────────┤│
│  │ [img]  Solana DeFi TVL Reaches New ATH...                ││
│  │        CoinDesk · 3h ago                        [Open →] ││
│  └──────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

- Pull from existing `/api/news/rss` endpoint
- Show image, title, source, relative time
- "Open" links to original source in new tab
- Filter tabs: All | Bitcoin | Ethereum | Solana | Markets
- Auto-refresh every 2 minutes

---

## BACKEND — CONTENT GENERATION AGENTS

### Storage: `server/content/store.js`
JSON file store. Functions: `saveArticle()`, `loadArticle(type, slug)`, `listArticles(type, {limit})`, `listAllPublished()`. After every save, regenerate sitemap + RSS. Directory: `server/content/articles/{type}/{slug}.json`.

Article schema fields: slug, type, title, headline, summary, content (markdown), tickers[], categories[], tags[], canonicalUrl, ogImage, jsonLd{}, dataSnapshot{}, status, publishedAt, updatedAt, expiresAt, version, model, generationTimeMs, sourcesCited[].

### Agent 1: Daily Brief — `server/agents/dailyBriefAgent.js`
Gathers data from existing endpoints: `/api/tickers`, `/api/stocks/movers`, `/api/stocks/indices`, `/api/fear-greed`, `fetchYahooChartPrice('BTC-USD')`. Builds data context string. Sends to Perplexity sonar-pro with specialized system prompt (hedge fund tone, structured sections: Market Overview, Crypto Markets, Stock Markets, Cross-Market Signals, What We're Watching). 1200-2000 words. Logs activity.

### Agent 2: Token Analysis — `server/agents/tokenAnalysisAgent.js`
Takes symbol + coinGeckoId. Fetches from Binance + CoinGecko. Sends to Perplexity sonar-pro (sections: Overview, Price Analysis, Fundamentals, Ecosystem, Risk Assessment, Spectre Verdict). 800-1500 words. Handles microcaps and meme tokens with explicit risk warnings. Logs activity.

### Agent 3: Stock Analysis — `server/agents/stockAnalysisAgent.js`
Takes symbol. Fetches from fetchYahooQuotes + fetchStockFundamentals. Sends to Perplexity sonar-pro (sections: Company Overview, Financial Analysis, Valuation, Growth Catalysts, Risk Factors, Spectre Verdict). 800-1500 words. Logs activity.

### Scheduler — `server/agents/scheduler.js`
Runs at 08:00 UTC daily. Generates: 1 daily brief, 25 crypto tokens (BTC through BONK including memes), 27 stocks (AAPL through ARM). Staggered 3s between each to respect Perplexity rate limits. Total runtime ~5-8 min. Logs all activity.

**Perplexity settings for all agents:**
- Model: `sonar-pro`
- Temperature: 0.2 (factual, not creative)
- search_context_size: `high` for daily brief, `medium` for token/stock
- return_citations: true
- max_tokens: 3000-4000
- Timeout: 45-60s

### System Prompt Requirements
All agent prompts must:
- Write as Spectre AI ("we assess", "our analysis")
- Use professional hedge fund tone, not blog/casual
- Include specific numbers everywhere
- Be honest about risks — if something looks bad, say it
- For microcaps/memes: explicitly flag risk level, check for rug indicators
- End with "Spectre Verdict" section — an opinionated conclusion
- Reference latest available data (earnings, filings, events)

---

## API ROUTES

```
GET  /api/intelligence                          → all published articles
GET  /api/intelligence/:type                    → articles by type
GET  /api/intelligence/:type/:slug              → single article JSON
GET  /api/intelligence/activity                 → agent activity log
GET  /api/intelligence/stats                    → hub stats (total articles, agents active, etc.)
POST /api/intelligence/generate                 → trigger full generation (admin)
POST /api/intelligence/generate/:type/:symbol   → trigger single article (admin)
```

Stats endpoint returns:
```json
{
  "articlesPerDay": 53,
  "totalArticles": 1247,
  "lastGeneration": "2026-02-19T08:12:34Z",
  "agentsActive": true,
  "coverage": { "crypto": 25, "stocks": 27, "daily": 1 }
}
```

---

## SEO INFRASTRUCTURE

### sitemap.xml
Route: `GET /sitemap.xml`. Lists homepage, /intelligence hub, and every published article URL with lastmod, changefreq, priority. Cache: 1 hour.

### robots.txt
```
User-agent: *
Allow: /intelligence/
Allow: /sitemap.xml
Disallow: /api/
Sitemap: https://app.spectreai.io/sitemap.xml
```

### RSS Feeds
- `GET /api/rss` — all content
- `GET /api/rss/daily` — daily briefs
- `GET /api/rss/crypto` — crypto analyses
- `GET /api/rss/stocks` — stock analyses
Standard RSS 2.0 with Atom. Max 50 items. Cache: 30 min.

### llms.txt (AISEO)
`GET /llms.txt` — tells AI crawlers what Spectre publishes, content types, URL patterns, update schedule, feed URLs.
`GET /llms-full.txt` — full content index with every article title, URL, date, summary, tickers.

### Server-Side HTML Rendering
`GET /intelligence/:type/:slug` — serves full HTML for crawlers AND users.

Every page includes:
- `<title>` with SEO title
- `<meta name="description">` (155 char summary)
- `<link rel="canonical">`
- Open Graph tags (og:type article, og:title, og:description, og:url, og:image)
- Twitter Card tags (summary_large_image)
- JSON-LD Article structured data (author Spectre AI, datePublished, keywords, about)
- RSS feed discovery `<link rel="alternate" type="application/rss+xml">`

Styling for HTML pages follows Spectre aesthetic: #07070d background, white text at controlled opacities, Space Grotesk headings, Inter body, JetBrains Mono for tickers/numbers, purple accent links.

---

## ROUTING SETUP

Add to `src/constants/pageRoutes.js`:
```javascript
intelligence: '/intelligence',
intelligenceArticle: '/intelligence/:type/:slug',
```

Add to router in `App.jsx`:
```javascript
import IntelligencePage from './pages/Intelligence';
import ArticlePage from './pages/Intelligence/components/ArticlePage';

<Route path="/intelligence" element={<IntelligencePage />} />
<Route path="/intelligence/:type/:slug" element={<ArticlePage />} />
```

Add Intelligence to the navigation sidebar with appropriate icon.

---

## ENVIRONMENT VARIABLES

Add to `.env`:
```
PERPLEXITY_API_KEY=pplx-xxxxxxxxxxxx
ADMIN_KEY=your-secret-admin-key
```

Zero new npm dependencies. Perplexity uses standard fetch with OpenAI-compatible format.

---

## VERIFICATION

```bash
# 1. Generate content
curl -X POST http://localhost:3001/api/intelligence/generate \
  -H "X-Admin-Key: your-admin-key"

# 2. Check articles exist
curl http://localhost:3001/api/intelligence/daily | jq '.count'
curl http://localhost:3001/api/intelligence/crypto | jq '.count'
curl http://localhost:3001/api/intelligence/stocks | jq '.count'

# 3. Read single article
curl http://localhost:3001/api/intelligence/crypto/bitcoin | jq '.title'

# 4. Check agent activity
curl http://localhost:3001/api/intelligence/activity | jq '.events[0]'

# 5. Check stats
curl http://localhost:3001/api/intelligence/stats | jq '.'

# 6. Check HTML rendering (what Google sees)
curl http://localhost:3001/intelligence/crypto/bitcoin | head -50
# Must have: <title>, og: tags, JSON-LD, full content

# 7. SEO files
curl http://localhost:3001/sitemap.xml | head -20
curl http://localhost:3001/robots.txt
curl http://localhost:3001/llms.txt
curl http://localhost:3001/api/rss | head -30

# 8. Frontend renders
# Open http://localhost:3000/intelligence
# Verify: tabs work, article cards load, activity feed updates, news wire shows
# Click an article — verify article page renders with live data card

# 9. Design check
# Does it look like it belongs next to WelcomePage.jsx?
# Glass cards, dark background, correct fonts, no bright gradients?
# Prices in JetBrains Mono? Green/red for changes?
# Section labels uppercase and muted? Skeleton loading?
# If ANY of this is wrong, fix it before moving on.
```

---

## BUILD ORDER

1. **Storage** — `server/content/store.js` (file operations, schema)
2. **Activity log** — `server/agents/activityLog.js` (in-memory event log)
3. **Agents** — daily brief, token analysis, stock analysis (with activity logging)
4. **Scheduler** — daily cron, manual triggers
5. **API routes** — content serving, activity, stats, generate triggers
6. **SEO** — sitemap, robots.txt, RSS feeds, llms.txt, HTML renderer
7. **Frontend — Hub page** — page layout, tabs, hero stats
8. **Frontend — Overview tab** — today's brief, research grids, activity preview, news wire
9. **Frontend — Article page** — full article reader with live data card
10. **Frontend — Other tabs** — Daily Briefs, Crypto, Stocks, Feed, RSS
11. **Routing** — register pages, add to navigation
12. **Test** — generate content, verify all views, validate SEO

---

## COST

~$0.53/day for 53 articles via Perplexity Sonar Pro. ~$16/month. 19,000+ unique pages per year. The SEO value alone is worth 100x this cost.
