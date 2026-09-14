# THE SPECTRE TIMES — Editorial Redesign + Instant Agent Generation

> **Paste into Claude Code. This redesigns the Intelligence Hub from a SaaS feature page into a premium dark editorial publication — "The Spectre Times." It also fixes the agent pipeline so content generates IMMEDIATELY on deploy, not after an 8am cron. The agents must run on startup and populate the page within 2-3 minutes. No empty states. Ever.**

---

## READ FIRST — MANDATORY

```bash
# Read the design law
cat .cursor/rules/SPECTRE_DESIGN_LAW.md

# CRITICAL: Check the cinema font — this is what we're using for headlines
grep -i "cinema\|playfair" .cursor/rules/SPECTRE_DESIGN_LAW.md
grep -i "cinema\|playfair" src/index.css

# Read current Intelligence Hub code
cat src/pages/Intelligence/index.jsx
cat src/pages/Intelligence/Intelligence.css
ls src/pages/Intelligence/components/

# Check agent files
ls server/agents/
cat server/agents/scheduler.js
cat server/agents/newsCuratorAgent.js 2>/dev/null | head -40
cat server/agents/newsWriterAgent.js 2>/dev/null | head -40

# Check content store
cat server/content/store.js | head -60

# Check what articles exist right now
ls server/content/articles/ 2>/dev/null
ls server/content/articles/news/ 2>/dev/null
ls server/content/articles/daily/ 2>/dev/null

# Check existing RSS/news endpoints we can use
grep -n "api/news\|RSS_FEEDS\|parseRss" server/index.js | head -15

# Check existing data endpoints we'll pull from
grep -n "api/tickers\|api/stocks\|fear-greed\|fetchYahoo" server/index.js | head -15
```

---

## PROBLEM 1: THE DESIGN IS WRONG

The current Intelligence Hub looks like a SaaS dashboard with stat counters and empty tab views. That's not what we're building.

We're building **The Spectre Times** — a premium AI-powered financial publication. Think: the New York Times or Financial Times meets Bloomberg, but dark mode and fully automated.

### THE AESTHETIC

**Typography is everything.** This is a publication, not a dashboard.

- Headlines use `var(--font-cinema)` — **Playfair Display**. This is the editorial serif font already in our design system. It has NEVER been used anywhere in the app. This page is where it lives. Playfair Display is the Spectre equivalent of the NYT's Cheltenham or FT's Georgia. Elegant, authoritative, timeless.

- Body text uses `var(--font-body)` — **Inter**. Clean, readable.

- Data/numbers use `var(--font-mono)` — **JetBrains Mono**. Prices, percentages, timestamps.

- Category labels use `var(--font-body)` — **Inter**, uppercase, letter-spaced, small.

**The layout is editorial, not dashboard.** No stat counter hero. No tab bar. The page IS the content. You land on it and immediately see the biggest story, then more stories below, then market data in the sidebar. Exactly like landing on nytimes.com or coindesk.com.

**Dark mode newspaper.** All Spectre design tokens apply. Deep blacks, glass cards, controlled opacities. But the layout and typography rhythm is editorial — generous whitespace, clear hierarchy, stories that breathe.

---

## THE LAYOUT — TOP TO BOTTOM

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   THE SPECTRE TIMES                                                     │
│   ─────────────────                                                     │
│   Thursday, February 19, 2026                AI-Powered Intelligence    │
│                                                                         │
│   [All] [Bitcoin] [Ethereum] [DeFi] [Stocks] [Macro] [Regulation]      │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─ BREAKING (conditional) ───────────────────────────────────────┐   │
│   │  ● BREAKING  SEC Files Emergency Motion Against Binance — BNB  │   │
│   │              drops 12% in after-hours trading         2 min ago │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   HERO STORY (biggest story of the day — full width)                    │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                                                                 │  │
│   │          ■ MARKETS                                              │  │
│   │                                                                 │  │
│   │          Bitcoin Holds Above $98,000                            │  │
│   │          as Institutional Inflows Hit                           │  │
│   │          Record Levels                                          │  │
│   │                                                                 │  │
│   │          Spot ETFs recorded $1.2 billion in net inflows,        │  │
│   │          the largest single-day figure since launch.            │  │
│   │          BTC dominance climbs to 58.4%.                         │  │
│   │                                                                 │  │
│   │          12:45 PM · Spectre Intelligence                        │  │
│   │                                                                 │  │
│   │          BTC $98,421 (+2.3%)  ·  ETH $3,245 (-1.1%)           │  │
│   │                                                                 │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   THREE-COLUMN SECTION                                                  │
│                                                                         │
│   ┌────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐ │
│   │ LATEST         │ │ ANALYSIS             │ │ MARKET PULSE         │ │
│   │                │ │                      │ │                      │ │
│   │ 12:30 PM       │ │ ■ CRYPTO RESEARCH    │ │ BTC   $98,421       │ │
│   │ ● Neutral      │ │                      │ │       +2.3%         │ │
│   │ Bitcoin, ether │ │ Bitcoin (BTC)        │ │ ETH   $3,245        │ │
│   │ rise as alt-   │ │ Our analysis shows   │ │       -1.1%         │ │
│   │ coins lag      │ │ continued strength   │ │ SOL   $178.42       │ │
│   │                │ │ above $95K support...│ │       +5.2%         │ │
│   │ ────────────── │ │                      │ │                      │ │
│   │                │ │ [Read Analysis →]    │ │ ──────────────────── │ │
│   │ 12:26 PM       │ │                      │ │                      │ │
│   │ ● Bullish      │ │ ────────────────     │ │ Fear & Greed: 72    │ │
│   │ Stablecoin     │ │                      │ │ ■■■■■■■□□□ Greed    │ │
│   │ adoption hits  │ │ ■ EQUITY RESEARCH    │ │                      │ │
│   │ new milestone  │ │                      │ │ ──────────────────── │ │
│   │                │ │ NVIDIA (NVDA)        │ │                      │ │
│   │ ────────────── │ │ AI spending ests     │ │ S&P 500    6,129    │ │
│   │                │ │ revised higher...    │ │            +0.4%    │ │
│   │ 8:25 AM        │ │                      │ │ NASDAQ    19,891    │ │
│   │ ● Bullish      │ │ [Read Analysis →]    │ │            +0.6%    │ │
│   │ Ledn raises    │ │                      │ │                      │ │
│   │ $188m in first │ │ ────────────────     │ │ ──────────────────── │ │
│   │ BTC-backed     │ │                      │ │                      │ │
│   │ bond offering  │ │ ■ CRYPTO RESEARCH    │ │ ● AGENTS ACTIVE     │ │
│   │                │ │                      │ │ Curator  4m ago     │ │
│   │ ────────────── │ │ Solana (SOL)         │ │ Writer   12m ago    │ │
│   │                │ │ DeFi TVL reaches     │ │ Analyst  2h ago     │ │
│   │ 8:25 AM        │ │ new ATH as...        │ │                      │ │
│   │ ● Neutral      │ │                      │ │ 23 stories today    │ │
│   │ ETF outflows   │ │ [Read Analysis →]    │ │                      │ │
│   │ continue...    │ │                      │ │                      │ │
│   │                │ │                      │ │                      │ │
│   │ VIEW ALL →     │ │ VIEW ALL RESEARCH →  │ │ [RSS Feeds]         │ │
│   └────────────────┘ └──────────────────────┘ └──────────────────────┘ │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   MORE STORIES (2x3 grid of story cards)                                │
│                                                                         │
│   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐      │
│   │ ■ DEFI           │ │ ■ REGULATION     │ │ ■ STOCKS         │      │
│   │                  │ │                  │ │                  │      │
│   │ Uniswap V4       │ │ EU MiCA Rules    │ │ PLTR Surges 5%   │      │
│   │ Launch Drives    │ │ Take Effect      │ │ on Defense        │      │
│   │ 40% Surge in     │ │ Next Month       │ │ Contract Win      │      │
│   │ UNI              │ │                  │ │                  │      │
│   │                  │ │ 8h ago           │ │ 3h ago           │      │
│   │ 6h ago           │ │                  │ │                  │      │
│   └──────────────────┘ └──────────────────┘ └──────────────────┘      │
│   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐      │
│   │ ■ BITCOIN        │ │ ■ MACRO          │ │ ■ ETHEREUM       │      │
│   │                  │ │                  │ │                  │      │
│   │ Mining Diffi-    │ │ Fed Minutes      │ │ Ethereum L2      │      │
│   │ culty Reaches    │ │ Signal Cau-      │ │ Revenue Tops     │      │
│   │ New ATH          │ │ tious Approach   │ │ $100M Monthly    │      │
│   │                  │ │                  │ │                  │      │
│   │ 10h ago          │ │ 5h ago           │ │ 7h ago           │      │
│   └──────────────────┘ └──────────────────┘ └──────────────────┘      │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   TODAY'S DAILY BRIEF (full-width card)                                 │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  DAILY MARKET BRIEF · FEBRUARY 19, 2026                        │  │
│   │                                                                 │  │
│   │  Markets showed resilience today as institutional capital       │  │
│   │  continued flowing into crypto ETFs while equity indices        │  │
│   │  pushed higher on revised AI spending estimates...              │  │
│   │                                                                 │  │
│   │  [Read Full Brief →]                                            │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   THE SPECTRE TIMES · Published by Spectre AI Agents                   │
│   RSS: All · News · Crypto · Stocks                                    │
│   © 2026 Spectre AI · Not financial advice                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## DESIGN SPECIFICS

### Masthead — "THE SPECTRE TIMES"

```css
.masthead-title {
  font-family: var(--font-cinema); /* Playfair Display */
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.04em;
  text-align: center;
}

.masthead-date {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-tertiary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.masthead-divider {
  width: 100%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255,255,255,0.12) 20%,
    rgba(255,255,255,0.12) 80%,
    transparent 100%
  );
  margin: var(--sp-4) 0;
}

/* Double-line newspaper divider (use between major sections) */
.section-divider {
  width: 100%;
  border: none;
  border-top: 2px solid rgba(255,255,255,0.10);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  height: 5px;
  margin: var(--sp-8) 0;
}
```

### Story Headlines

```css
.hero-headline {
  font-family: var(--font-cinema); /* Playfair Display */
  font-size: 2.75rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.15;
  letter-spacing: -0.01em;
}

.story-headline {
  font-family: var(--font-cinema);
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.story-summary {
  font-family: var(--font-body);
  font-size: 0.95rem;
  color: var(--text-secondary);
  line-height: 1.6;
}
```

### Category Badge

```css
.category-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 0.6875rem; /* 11px */
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.category-badge::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 2px;
  /* Color varies by category: */
}

/* Category colors */
.category-badge--bitcoin::before   { background: #F7931A; }
.category-badge--ethereum::before  { background: #627EEA; }
.category-badge--solana::before    { background: #9945FF; }
.category-badge--defi::before      { background: #10B981; }
.category-badge--stocks::before    { background: #3B82F6; }
.category-badge--macro::before     { background: #EAB308; }
.category-badge--regulation::before { background: #EF4444; }
.category-badge--nfts::before      { background: #EC4899; }

.category-badge span {
  color: var(--text-tertiary);
}
```

### Hero Story Card

```css
.hero-story {
  /* Use the premium Welcome Widget container pattern */
  background: linear-gradient(168deg, #07060a 0%, #09080d 35%, #040306 70%, #020103 100%);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-xl); /* 24px */
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.08),
    inset 0 1px 0 rgba(255,255,255,0.14),
    0 4px 12px rgba(0,0,0,0.4),
    0 8px 24px rgba(0,0,0,0.3);
  padding: var(--sp-10) var(--sp-8); /* 40px 32px */
}
```

### News Timeline Items (Left Column)

```css
.timeline-item {
  padding: var(--sp-4) 0;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background 0.2s ease;
}

.timeline-item:hover {
  background: rgba(255,255,255,0.02);
}

.timeline-time {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-muted);
}

.sentiment-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 6px;
}
.sentiment-dot--bullish  { background: var(--bull); }
.sentiment-dot--bearish  { background: var(--bear); }
.sentiment-dot--neutral  { background: rgba(255,255,255,0.32); }

.timeline-headline {
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  margin-top: 4px;
}
```

### Story Grid Cards

```css
.story-card {
  /* Standard glass card */
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--sp-6);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 16px rgba(0,0,0,0.5);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
}

.story-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.6);
}

.story-card .headline {
  font-family: var(--font-cinema);
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.story-card .timestamp {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: var(--sp-3);
}
```

### Breaking News Banner

```css
.breaking-banner {
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.18);
  border-left: 3px solid var(--bear);
  border-radius: var(--radius-md);
  padding: var(--sp-4) var(--sp-6);
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  animation: breakingPulse 3s ease-in-out infinite;
}

@keyframes breakingPulse {
  0%, 100% { border-left-color: var(--bear); }
  50% { border-left-color: rgba(239, 68, 68, 0.4); }
}

.breaking-label {
  font-family: var(--font-body);
  font-size: 0.6875rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--bear);
  white-space: nowrap;
}

.breaking-headline {
  font-family: var(--font-cinema);
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}
```

---

## PROBLEM 2: AGENTS AREN'T GENERATING CONTENT

The agents need to produce content THE MOMENT the server starts. Here's the exact startup sequence:

### Startup Sequence — `server/agents/scheduler.js`

```javascript
async function startNewsroom() {
  console.log('[newsroom] Starting Spectre Newsroom...');
  
  // ═══ IMMEDIATE: Run on startup ═══
  
  // 1. News Curator — runs FIRST, within 3 seconds of server start
  //    Pulls RSS, finds stories, passes to writer
  setTimeout(async () => {
    console.log('[newsroom] Running initial news curator...');
    try {
      await runNewsCuratorCycle();
    } catch (e) {
      console.error('[newsroom] Initial curator failed:', e.message);
    }
  }, 3000);

  // 2. Daily Brief — runs 30 seconds after start
  //    Check if today's brief exists. If not, generate it.
  setTimeout(async () => {
    const today = new Date().toISOString().split('T')[0];
    const existing = loadArticle('daily', today);
    if (!existing) {
      console.log('[newsroom] No daily brief for today, generating...');
      try {
        await generateDailyBrief();
      } catch (e) {
        console.error('[newsroom] Daily brief failed:', e.message);
      }
    }
  }, 30000);

  // 3. Deep Analysis — runs 2 minutes after start
  //    Check if we have at least BTC, ETH, SOL analyses from today
  //    If not, generate the top 5 most important ones
  setTimeout(async () => {
    const priority = ['BTC', 'ETH', 'SOL', 'NVDA', 'AAPL'];
    for (const symbol of priority) {
      const type = ['NVDA', 'AAPL'].includes(symbol) ? 'stocks' : 'crypto';
      const slug = type === 'crypto' 
        ? CRYPTO_SLUG_MAP[symbol] || symbol.toLowerCase()
        : symbol;
      const existing = loadArticle(type, slug);
      // If no article or article is > 24h old, regenerate
      if (!existing || isStale(existing)) {
        try {
          if (type === 'crypto') {
            await generateTokenAnalysis(symbol, CRYPTO_ID_MAP[symbol]);
          } else {
            await generateStockAnalysis(symbol);
          }
          await sleep(3000); // Respect rate limits
        } catch (e) {
          console.error(`[newsroom] Analysis for ${symbol} failed:`, e.message);
        }
      }
    }
  }, 120000);

  // ═══ RECURRING: Set intervals ═══

  // News Curator — every 30 minutes
  setInterval(() => {
    runNewsCuratorCycle().catch(e => console.error('[curator]', e.message));
  }, 30 * 60 * 1000);

  // Breaking News Monitor — every 10 minutes
  setInterval(() => {
    runBreakingMonitor().catch(e => console.error('[breaking]', e.message));
  }, 10 * 60 * 1000);

  // Daily Brief — 08:00 and 16:00 UTC
  scheduleDailyAt(8, 0, () => generateDailyBrief());
  scheduleDailyAt(16, 0, () => generateDailyBrief());

  // Full analysis cycle — 09:00 UTC
  scheduleDailyAt(9, 0, () => runFullAnalysisCycle());

  console.log('[newsroom] All agents scheduled. Content incoming in ~3 seconds.');
}

// Helper: check if article is stale (>24h old)
function isStale(article) {
  if (!article.publishedAt) return true;
  const age = Date.now() - new Date(article.publishedAt).getTime();
  return age > 24 * 60 * 60 * 1000;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
```

### News Curator Cycle — The Core Loop

This is the function that runs every 30 minutes AND on startup. It's the heartbeat of the newsroom.

```
CURATOR CYCLE:
1. Fetch all RSS feeds in parallel (6 sources, 8s timeout each)
2. Combine all items, sort by date descending
3. Take items from last 6 hours only
4. Deduplicate against existing published articles:
   - Normalize both headlines (lowercase, strip punctuation/stopwords)
   - If >60% word overlap with any article from last 24h → SKIP
5. Score remaining items (1-10):
   - Trending tickers ($BTC, $ETH, $SOL, $NVDA) → +2
   - High-impact keywords (ETF, SEC, hack, billion, record, surge, crash, Fed) → +3
   - Tier-1 source (CoinDesk, Reuters, Bloomberg) → +1
   - Less than 2 hours old → +2
   - Has specific numbers in title → +1
6. Take top 3-5 scoring 5+
7. For each: call News Writer Agent to generate Spectre brief
8. Rate limit: max 5 per cycle, max 30 per day
9. Log every action to activity feed
```

### News Writer Agent — Generates the Brief

For each story the curator passes:

1. **Detect tickers** mentioned in the source title/summary
2. **Fetch live data** for those tickers from Spectre's existing endpoints:
   - Crypto → `/api/tickers` or direct Binance call
   - Stocks → `fetchYahooQuotes([symbol])`
3. **Call Perplexity sonar-pro** with:
   - System prompt: "Senior financial journalist at Spectre AI. 200-400 words. Inverted pyramid. Include live prices. Tag sentiment."
   - User prompt: source article context + live price data
   - Temperature: 0.2
   - search_context_size: `low` (news briefs don't need deep research)
   - max_tokens: 1000
   - Timeout: 30s
4. **Parse sentiment** from the response (ask model to return JSON sentiment at the end, or regex detect bullish/bearish/neutral keywords)
5. **Classify category** from tickers and keywords
6. **Auto-feature** if score >= 8 and < 4 hours old
7. **Save** via `saveArticle()` with type `'news'`
8. **Log activity**

### Breaking News Monitor

Runs every 10 minutes. Lighter than the full curator:

1. Fetch RSS feeds (same sources)
2. Only look at items < 1 hour old
3. Scan titles for Tier 1 keywords:
   `hack, exploit, hacked, rug pull, SEC charges, ETF approved, ETF denied, rate cut, rate hike, emergency, halted`
4. If match found AND not already covered → immediately generate brief with `isBreaking: true`
5. Max 3 breaking stories per day

---

## CRITICAL: RSS SOURCE CONFIGURATION

Add these RSS feeds. The existing `RSS_FEEDS` array in `server/index.js` only has CoinDesk and CoinTelegraph. Expand it for the curator:

```javascript
const NEWSROOM_RSS_FEEDS = [
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk', tier: 1 },
  { url: 'https://cointelegraph.com/rss', source: 'CoinTelegraph', tier: 1 },
  { url: 'https://www.theblock.co/rss.xml', source: 'The Block', tier: 1 },
  { url: 'https://decrypt.co/feed', source: 'Decrypt', tier: 2 },
  { url: 'https://www.dlnews.com/rss/', source: 'DL News', tier: 2 },
  { url: 'https://bitcoinmagazine.com/feed', source: 'Bitcoin Magazine', tier: 2 },
];
```

Reuse the existing `parseRssXml()` function from `server/index.js`. If it only handles basic RSS, make sure it also handles Atom feeds (some sources use `<entry>` instead of `<item>`).

---

## FALLBACK: IF PERPLEXITY IS DOWN OR NO API KEY

The page should NEVER be empty. If Perplexity isn't available:

1. **RSS stories display directly** — use the source title and summary as-is, just formatted as Spectre cards. No AI rewrite, but still shows content.
2. **Mark articles as** `model: 'rss-passthrough'` so you know they weren't AI-generated.
3. **When Perplexity comes back**, the next curator cycle will generate proper briefs.

This means even without an API key, the page shows live news from RSS sources formatted in the Spectre editorial style.

---

## FRONTEND COMPONENTS — UPDATED

```
src/pages/Intelligence/
├── index.jsx                          — Main editorial layout
├── Intelligence.css                    — All styles (newspaper aesthetic)
├── components/
│   ├── Masthead.jsx                    — "THE SPECTRE TIMES" + date + dividers
│   ├── CategoryFilter.jsx              — Horizontal category pills
│   ├── BreakingBanner.jsx              — Conditional breaking news bar
│   │
│   ├── HeroStory.jsx                   — Full-width featured story card
│   │
│   ├── NewsTimeline.jsx                — Left column: chronological feed
│   ├── NewsTimelineItem.jsx            — Single item: time, sentiment, headline
│   ├── SentimentDot.jsx                — Colored dot component
│   │
│   ├── AnalysisColumn.jsx              — Center column: latest research
│   ├── AnalysisCard.jsx                — Individual analysis preview
│   │
│   ├── MarketPulse.jsx                 — Right column: live prices + agents
│   ├── PriceRow.jsx                    — Single price display
│   ├── FearGreedMini.jsx               — Compact fear & greed display
│   ├── AgentStatus.jsx                 — Agent last-run indicators
│   │
│   ├── StoryGrid.jsx                   — 2x3 grid of story cards
│   ├── StoryCard.jsx                   — Individual story card
│   │
│   ├── DailyBriefBanner.jsx            — Full-width daily brief preview
│   │
│   ├── ArticlePage.jsx                 — Full article reader (keep existing)
│   └── Footer.jsx                      — RSS links, disclaimer, copyright
```

### Page Data Flow

```javascript
// index.jsx — main page
const [articles, setArticles] = useState({ news: [], featured: null, daily: null, analyses: [], breaking: null });
const [marketData, setMarketData] = useState({ prices: {}, indices: [], fearGreed: null });
const [agentStatus, setAgentStatus] = useState({});
const [activeCategory, setActiveCategory] = useState('all');

// Initial load
useEffect(() => {
  Promise.all([
    fetch('/api/intelligence/news?limit=15').then(r => r.json()),
    fetch('/api/intelligence/featured?limit=1').then(r => r.json()),
    fetch('/api/intelligence/daily/latest').then(r => r.json()),
    fetch('/api/intelligence/crypto?limit=5').then(r => r.json()),
    fetch('/api/intelligence/breaking').then(r => r.json()),
    fetch('/api/intelligence/activity?limit=5').then(r => r.json()),
    fetch('/api/intelligence/stats').then(r => r.json()),
  ]).then(([news, featured, daily, analyses, breaking, activity, stats]) => {
    setArticles({ news: news.articles, featured: featured[0], daily, analyses: analyses.articles, breaking: breaking[0] || null });
    setAgentStatus({ activity: activity.events, stats });
  });
}, []);

// Market data (separate, refreshes faster)
useEffect(() => {
  const fetchMarket = () => {
    Promise.all([
      fetch('/api/tickers').then(r => r.json()),
      fetch('/api/stocks/indices').then(r => r.json()),
      fetch('/api/fear-greed').then(r => r.json()),
    ]).then(([prices, indices, fg]) => {
      setMarketData({ prices, indices, fearGreed: fg });
    });
  };
  fetchMarket();
  const interval = setInterval(fetchMarket, 30000);
  return () => clearInterval(interval);
}, []);

// News polling (every 60s)
useEffect(() => {
  const interval = setInterval(() => {
    fetch(`/api/intelligence/news?limit=15${activeCategory !== 'all' ? `&category=${activeCategory}` : ''}`)
      .then(r => r.json())
      .then(data => setArticles(prev => ({ ...prev, news: data.articles })));
  }, 60000);
  return () => clearInterval(interval);
}, [activeCategory]);
```

### Category Filtering

When user clicks a category pill:
- Updates `activeCategory` state
- Re-fetches news with `?category=bitcoin` filter
- Filters the story grid client-side
- Hero story changes to the best story in that category (or stays as overall best if "All")

---

## VERIFICATION — WHAT SUCCESS LOOKS LIKE

```bash
# 1. Start the server
npm run dev

# 2. Watch logs — within 3 seconds you should see:
# [newsroom] Starting Spectre Newsroom...
# [newsroom] Running initial news curator...
# [curator] Fetching RSS from 6 sources...
# [curator] Found 47 items, 12 new after dedup
# [curator] Scored: top 5 stories above threshold
# [writer] Generating brief for "Bitcoin ETF Sees Record..."
# [writer] Published: bitcoin-etf-record-inflow... (347 words, bullish)
# ... (3-5 more stories)

# 3. Within 2 minutes, check content exists:
curl http://localhost:3001/api/intelligence/news | jq '.count'
# Should be >= 3

# 4. Check featured
curl http://localhost:3001/api/intelligence/featured | jq '.[0].headline'

# 5. Open in browser: http://localhost:3000/intelligence
# Should see:
# - "THE SPECTRE TIMES" masthead with today's date
# - Hero story card with biggest story
# - News timeline on left with timestamped stories
# - Analysis column in center
# - Market data on right with live prices
# - Story cards grid below
# - NO empty states. NO "no content yet" messages.

# 6. Check design:
# - Headlines in Playfair Display (serif)?
# - Category badges with colored squares?
# - Sentiment dots (green/red/gray) on timeline?
# - Dark background with glass cards?
# - Prices in JetBrains Mono?
# - Newspaper-style dividers between sections?
# - Does it look like a PUBLICATION, not a dashboard?

# 7. Wait 30 minutes, refresh — new stories should have appeared
# 8. Check agent activity
curl http://localhost:3001/api/intelligence/activity | jq '.events[:3]'
```

---

## BUILD ORDER

1. **Fix agents first** — update scheduler with startup sequence, build curator and writer
2. **Update store** — add news type, query functions
3. **Add API endpoints** — /news, /featured, /breaking, /daily/latest, /stats
4. **Redesign frontend** — rip out the dashboard layout, build editorial layout
5. **Masthead + categories** — "THE SPECTRE TIMES" with Playfair Display
6. **Hero story** — premium glass card with biggest story
7. **Three-column layout** — news timeline, analysis, market pulse
8. **Story grid** — 2x3 cards below
9. **Breaking banner** — conditional red alert
10. **Daily brief banner** — full-width at bottom
11. **Responsive** — tablet/mobile breakpoints
12. **Test** — verify content generates on startup, no empty states
