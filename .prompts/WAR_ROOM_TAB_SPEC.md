# SPECTRE AI — WAR ROOM TAB
## Claude Code Implementation Prompt

> **Paste this entire document into Claude Code. Build the War Room tab as a new tab inside the Command Center, replacing the Top Coins table area. This is the most important feature addition to Spectre — it transforms the dashboard from a data viewer into an intelligence terminal.**

---

## WHAT WE'RE BUILDING

A new tab called **"War Room"** that sits in the Command Center tab strip alongside Top Coins, On-Chain, Prediction Markets, AI Agents, AI Models.

When selected, the War Room replaces the table area with:
- **Left (65%):** A live intelligence feed of AI-generated market story cards — think Perplexity Finance's market summary but crypto-native, deeper, and real-time
- **Right (35%):** A conversational AI interface that answers market questions using Spectre's own live data as context — NOT a chatbot, a war room analyst

This is the feature that makes Spectre feel like a Bloomberg Terminal + war room combined.

---

## STEP 0: READ BEFORE TOUCHING CODE

```bash
# MANDATORY — read in this order
cat SPECTRE_DESIGN_LAW.md
cat DESIGN_SYSTEM.md | head -150
cat src/index.css | grep -A2 ":root"
cat src/icons/spectreIcons.jsx | head -60
cat src/components/WelcomePage.jsx | head -80
cat src/pages/home/components/WelcomePage.css | head -60

# Find where the Command Center and tabs live
grep -rn "Top Coins\|On-Chain\|Prediction Markets\|War Room\|CommandCenter\|command-center" \
  src/ --include="*.jsx" --include="*.js" -l

# Find the tab switching logic
grep -rn "activeTab\|setActiveTab\|Top Coins" src/ --include="*.jsx" | head -20

# Find the existing tab strip component
grep -rn "AI Brief\|AI Market\|Liquidation\|Mindshare" src/ --include="*.jsx" | head -10
```

Study WelcomePage.jsx and WelcomePage.css — this is the visual north star. Every new component must feel like it belongs on the same page.

---

## ARCHITECTURE

### File Structure
```
src/pages/home/components/
├── WarRoomTab/
│   ├── index.jsx              ← main export, wires left + right
│   ├── WarRoomTab.css         ← all styles
│   ├── IntelFeed.jsx          ← left panel: intelligence story cards
│   ├── IntelCard.jsx          ← individual story card component
│   └── WarRoomChat.jsx        ← right panel: conversational interface
```

### Integration Point
Find the tab content rendering in App.jsx or the Command Center component. Add:
```jsx
// In the tab content switch/conditional:
{activeBottomTab === 'war-room' && <WarRoomTab />}

// In the tab strip:
{ id: 'war-room', label: 'War Room' }
// Insert BEFORE 'top-coins' — War Room is the default/first tab
```

---

## PART 1: THE INTEL FEED (Left Panel — 65% width)

### What It Is
A live, auto-updating feed of 8-12 AI-generated market intelligence cards. Each card is a crisp headline + 2-3 sentence brief + source chips + signal type badge. Think Perplexity's expandable market summary but darker, denser, more crypto-native.

### IntelFeed.jsx

```jsx
// IntelFeed.jsx
// Fetches stories from /api/war-room/intel every 10 minutes
// Shows skeleton shimmer on first load
// Cards animate in with 60ms stagger
// Newest story highlighted at top with a subtle pulse

import { useState, useEffect } from 'react';
import IntelCard from './IntelCard';

const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes

export default function IntelFeed() {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchStories = async () => {
    try {
      const res = await fetch('/api/war-room/intel');
      const data = await res.json();
      setStories(data.stories || []);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Intel feed fetch failed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStories();
    const interval = setInterval(fetchStories, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <IntelFeedSkeleton />;

  return (
    <div className="intel-feed">
      <div className="intel-feed-header">
        <div className="intel-feed-title">
          <span className="live-dot" />
          Intelligence Feed
        </div>
        <span className="intel-feed-updated">
          Updated {lastUpdated ? formatTimeAgo(lastUpdated) : '—'}
        </span>
      </div>

      <div className="intel-cards-list">
        {stories.map((story, i) => (
          <IntelCard
            key={story.id}
            story={story}
            isNewest={i === 0}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}
```

### IntelCard.jsx

Each card has:
- **Signal type badge** (top-left): BULLISH / BEARISH / NEUTRAL / MACRO / ON-CHAIN / WHALE — colored accordingly
- **Headline** (bold, primary text, 15-17px)
- **Brief** (2-3 sentences, secondary text, 13px) — collapsed by default, expands on click
- **Source chips** (bottom): clickable tags like "Binance Netflows · Codex" or "X Sentiment · CryptoCompare"
- **Timestamp** (top-right, muted, monospace)
- **Expand/collapse** — smooth height transition, not jump

```jsx
// IntelCard.jsx
// Story shape:
// {
//   id: string,
//   headline: string,        "BTC Exchange Netflows Turned Negative — Accumulation Signal"
//   brief: string,           "Net outflows from major exchanges reached -42,000 BTC over 48h..."
//   signalType: 'bullish' | 'bearish' | 'neutral' | 'macro' | 'onchain' | 'whale',
//   sources: string[],       ["Binance Netflows", "Codex On-Chain"]
//   tickers: string[],       ["BTC"]
//   timestamp: ISO string,
//   isBreaking?: boolean
// }

export default function IntelCard({ story, isNewest, index }) {
  const [expanded, setExpanded] = useState(isNewest); // newest starts expanded

  return (
    <div
      className={`intel-card ${expanded ? 'intel-card--expanded' : ''} signal-${story.signalType}`}
      style={{ '--stagger-index': index }}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="intel-card-header">
        <div className="intel-card-left">
          <span className={`signal-badge signal-badge--${story.signalType}`}>
            {SIGNAL_LABELS[story.signalType]}
          </span>
          {story.isBreaking && (
            <span className="breaking-badge">BREAKING</span>
          )}
          {story.tickers?.map(t => (
            <span key={t} className="ticker-badge">${t}</span>
          ))}
        </div>
        <span className="intel-card-time">{formatTimeAgo(story.timestamp)}</span>
      </div>

      <h3 className="intel-card-headline">{story.headline}</h3>

      <div className={`intel-card-brief ${expanded ? 'intel-card-brief--visible' : ''}`}>
        <p>{story.brief}</p>
        <div className="intel-card-sources">
          {story.sources?.map(s => (
            <span key={s} className="source-chip">{s}</span>
          ))}
        </div>
      </div>

      <div className="intel-card-expand-hint">
        {expanded ? '↑ Collapse' : '↓ Read brief'}
      </div>
    </div>
  );
}

const SIGNAL_LABELS = {
  bullish: 'BULLISH',
  bearish: 'BEARISH',
  neutral: 'NEUTRAL',
  macro: 'MACRO',
  onchain: 'ON-CHAIN',
  whale: 'WHALE',
};
```

---

## PART 2: THE WAR ROOM CHAT (Right Panel — 35% width)

### What It Is
NOT a chatbot. NOT a conversation history. A single-shot intelligence terminal.

User types a market question. Claude answers in 3-5 sentences using Spectre's live data as context. The answer replaces the previous one — no growing chat history. It's like asking your most informed analyst a question and getting an instant answer.

**The key difference from Perplexity:** Their bar searches the web. Ours uses YOUR data — live prices, netflows, exchange data, sentiment, whale activity, the user's watchlist. That's the moat.

### WarRoomChat.jsx

```jsx
// WarRoomChat.jsx
// Single question → single answer → replaces on next question
// Does NOT maintain conversation history in the UI
// Shows suggested prompts when empty
// Answer streams in word by word (streaming response)

const SUGGESTED_PROMPTS = [
  "Why is SOL outperforming today?",
  "Which majors show accumulation signals?",
  "What's the biggest macro risk this week?",
  "Is BTC netflow bullish or bearish right now?",
  "Which tokens in my watchlist are moving?",
  "What is fear & greed saying about market positioning?",
  "Are whale wallets buying or selling ETH?",
  "What catalysts are coming in the next 7 days?",
];

export default function WarRoomChat({ watchlist, marketData }) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [streamedText, setStreamedText] = useState('');

  const handleSubmit = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setAnswer(null);
    setStreamedText('');

    try {
      const res = await fetch('/api/war-room/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          context: {
            watchlist: watchlist || [],
            btcPrice: marketData?.btcPrice,
            ethPrice: marketData?.ethPrice,
            solPrice: marketData?.solPrice,
            fearGreed: marketData?.fearGreed,
            totalMarketCap: marketData?.totalMarketCap,
            btcDominance: marketData?.btcDominance,
            timestamp: new Date().toISOString(),
          }
        })
      });

      // Stream the response word by word
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        fullText += chunk;
        setStreamedText(fullText);
      }

      setAnswer({ text: fullText, query });
    } catch (e) {
      setAnswer({ text: 'Intelligence feed temporarily unavailable.', query, error: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="war-room-chat">
      {/* Header */}
      <div className="wrc-header">
        <span className="wrc-title">Ask the War Room</span>
        <span className="wrc-subtitle">Powered by your live data</span>
      </div>

      {/* Answer area or suggested prompts */}
      <div className="wrc-answer-area">
        {!answer && !loading && (
          <div className="wrc-suggestions">
            <p className="wrc-suggestions-label">Try asking:</p>
            {SUGGESTED_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                className="wrc-suggestion-pill"
                onClick={() => { setQuery(prompt); }}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="wrc-loading">
            <div className="wrc-loading-dots">
              <span /><span /><span />
            </div>
            <p className="wrc-loading-text">Analyzing live market data...</p>
          </div>
        )}

        {(answer || streamedText) && (
          <div className="wrc-answer">
            <p className="wrc-answer-query">"{answer?.query || query}"</p>
            <div className="wrc-answer-text">
              {streamedText || answer?.text}
              {loading && <span className="wrc-cursor">|</span>}
            </div>
            <div className="wrc-answer-footer">
              <span className="wrc-data-sources">
                Live data: Spectre Netflows · CoinGecko · Codex
              </span>
              <button
                className="wrc-new-question"
                onClick={() => { setAnswer(null); setStreamedText(''); setQuery(''); }}
              >
                New question
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="wrc-input-wrap">
        <input
          className="wrc-input"
          placeholder="Ask anything about the market..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          disabled={loading}
        />
        <button
          className={`wrc-send-btn ${loading ? 'wrc-send-btn--loading' : ''}`}
          onClick={handleSubmit}
          disabled={loading || !query.trim()}
        >
          →
        </button>
      </div>
    </div>
  );
}
```

---

## PART 3: BACKEND ENDPOINTS

Add these two endpoints to `server/index.js`:

### POST /api/war-room/ask
```javascript
// War Room — conversational market intelligence
// Uses live Spectre data as context for Claude
app.post('/api/war-room/ask', async (req, res) => {
  const { query, context } = req.body;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query required' });
  }

  // Build rich context from what we have
  const contextBlock = `
LIVE MARKET DATA (as of ${context.timestamp}):
- BTC: $${context.btcPrice?.toLocaleString() || 'N/A'}
- ETH: $${context.ethPrice?.toLocaleString() || 'N/A'}
- SOL: $${context.solPrice?.toLocaleString() || 'N/A'}
- Total Market Cap: ${context.totalMarketCap || 'N/A'}
- BTC Dominance: ${context.btcDominance || 'N/A'}%
- Fear & Greed: ${context.fearGreed || 'N/A'}/100
- User Watchlist: ${context.watchlist?.join(', ') || 'None set'}
  `.trim();

  const systemPrompt = `You are Spectre AI's War Room analyst. You answer questions about crypto markets with precision and brevity.

Rules:
- 3-5 sentences MAXIMUM. No lists. No headers. Just sharp prose.
- Use ONLY the live data provided as context. Never fabricate numbers.
- Be direct. Say what the data suggests. Flag uncertainty with "signals suggest" or "data points to".
- Never say "I" or "As an AI". Speak as the terminal itself.
- Never say "great question" or any filler.
- If you don't have enough data to answer, say "Insufficient data in current feed — check Research Zone for deeper analysis."

${contextBlock}`;

  try {
    // Stream response from Anthropic
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // Fast, cheap for single-shot answers
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: query }],
        stream: true,
      }),
    });

    // Stream chunks back to client
    const reader = anthropicRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);

      // Parse SSE events from Anthropic
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'content_block_delta' && data.delta?.text) {
              res.write(data.delta.text);
            }
          } catch {}
        }
      }
    }

    res.end();
  } catch (err) {
    console.error('War Room ask error:', err);
    res.status(500).json({ error: 'Analysis unavailable' });
  }
});
```

### GET /api/war-room/intel
```javascript
// War Room — Intelligence Feed
// Generates 8-10 market story cards using live data + Claude
// Cached for 10 minutes — do not regenerate on every request

const warRoomIntelCache = { data: null, expires: 0 };

app.get('/api/war-room/intel', async (req, res) => {
  // Serve from cache if still fresh
  if (warRoomIntelCache.data && Date.now() < warRoomIntelCache.expires) {
    return res.json(warRoomIntelCache.data);
  }

  try {
    // Fetch live data to ground the stories
    const [cgMarkets, fearGreed] = await Promise.allSettled([
      fetch(`${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana&order=market_cap_desc&per_page=3&sparkline=false&price_change_percentage=24h,7d`)
        .then(r => r.json()),
      fetch('https://api.alternative.me/fng/?limit=1').then(r => r.json()),
    ]);

    const markets = cgMarkets.status === 'fulfilled' ? cgMarkets.value : [];
    const fng = fearGreed.status === 'fulfilled' ? fearGreed.value?.data?.[0] : null;

    const contextData = markets.map(c => ({
      symbol: c.symbol?.toUpperCase(),
      price: c.current_price,
      change24h: c.price_change_percentage_24h?.toFixed(2),
      change7d: c.price_change_percentage_7d_in_currency?.toFixed(2),
      marketCap: c.market_cap,
      volume24h: c.total_volume,
    }));

    const prompt = `Generate exactly 8 crypto market intelligence story cards for the Spectre AI War Room feed. 
Current data: ${JSON.stringify(contextData)}
Fear & Greed: ${fng?.value}/100 (${fng?.value_classification})

Return ONLY valid JSON — no markdown, no explanation:
{
  "stories": [
    {
      "id": "unique-id-string",
      "headline": "Punchy headline under 80 chars — specific, data-driven, market-moving",
      "brief": "2-3 sentence elaboration. Specific. What it means for traders. What to watch.",
      "signalType": "bullish" | "bearish" | "neutral" | "macro" | "onchain" | "whale",
      "sources": ["Source name 1", "Source name 2"],
      "tickers": ["BTC"],
      "timestamp": "ISO timestamp",
      "isBreaking": false
    }
  ]
}

Story mix should be:
- 2-3 price/market movement stories (BTC, ETH, SOL)
- 2 on-chain or netflow stories
- 1 macro/sentiment story
- 1 sector story (DeFi, AI tokens, memes)
- 1 watch/risk story

Headlines must be specific: "BTC Exchange Netflows Negative 48h — Classic Accumulation Pattern" NOT "Bitcoin Shows Interesting Movement"`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiRes.json();
    const text = aiData.content?.[0]?.text || '';

    let stories;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      stories = JSON.parse(match[0]);
    } catch {
      stories = { stories: getFallbackStories() };
    }

    // Add server timestamp to each story
    stories.stories = stories.stories.map((s, i) => ({
      ...s,
      id: `intel-${Date.now()}-${i}`,
      timestamp: new Date(Date.now() - i * 8 * 60 * 1000).toISOString(), // stagger times
    }));

    // Cache for 10 minutes
    warRoomIntelCache.data = stories;
    warRoomIntelCache.expires = Date.now() + 10 * 60 * 1000;

    res.json(stories);
  } catch (err) {
    console.error('War Room intel error:', err);
    // Return cached data if available even if expired
    if (warRoomIntelCache.data) return res.json(warRoomIntelCache.data);
    res.json({ stories: getFallbackStories() });
  }
});

function getFallbackStories() {
  return [
    {
      id: 'fallback-1',
      headline: 'Intelligence Feed Refreshing...',
      brief: 'Live market data is being processed. Stories will appear shortly.',
      signalType: 'neutral',
      sources: ['Spectre AI'],
      tickers: [],
      timestamp: new Date().toISOString(),
      isBreaking: false,
    }
  ];
}
```

---

## PART 4: CSS — WAR ROOM STYLES

Create `src/pages/home/components/WarRoomTab/WarRoomTab.css`. Follow DESIGN LAW exactly.

### Layout
```css
/* ─── WAR ROOM CONTAINER ────────────────────────────────────────── */
.war-room-tab {
  display: grid;
  grid-template-columns: 65% 35%;
  gap: var(--sp-4);
  height: 100%;
  min-height: 480px;
  padding: var(--sp-4);
  animation: warRoomFadeIn 0.3s ease;
}

@keyframes warRoomFadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Mobile: stack vertically */
@media (max-width: 768px) {
  .war-room-tab {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
  }
}
```

### Intel Feed
```css
/* ─── INTEL FEED ────────────────────────────────────────────────── */
.intel-feed {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  overflow-y: auto;
  max-height: 520px;
  padding-right: var(--sp-2);
}

.intel-feed::-webkit-scrollbar { width: 2px; }
.intel-feed::-webkit-scrollbar-track { background: transparent; }
.intel-feed::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

.intel-feed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--sp-3);
  border-bottom: 1px solid var(--border-subtle);
}

.intel-feed-title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bull);
  animation: livePulse 2s ease-in-out infinite;
}

@keyframes livePulse {
  0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 rgba(16,185,129,0.4); }
  50% { opacity: 0.8; transform: scale(1.3); box-shadow: 0 0 0 4px rgba(16,185,129,0); }
}

.intel-feed-updated {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

/* ─── INTEL CARDS ───────────────────────────────────────────────── */
.intel-cards-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.intel-card {
  background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--sp-3) var(--sp-4);
  cursor: pointer;
  transition: all 150ms ease;
  animation: cardStaggerIn 0.4s ease both;
  animation-delay: calc(var(--stagger-index) * 60ms);
}

@keyframes cardStaggerIn {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}

.intel-card:hover {
  background: linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.03) 100%);
  border-color: var(--border-strong);
  transform: translateX(2px);
}

/* Signal type left border accent */
.intel-card.signal-bullish  { border-left: 2px solid var(--bull); }
.intel-card.signal-bearish  { border-left: 2px solid var(--bear); }
.intel-card.signal-whale    { border-left: 2px solid #8B5CF6; }
.intel-card.signal-macro    { border-left: 2px solid #F59E0B; }
.intel-card.signal-onchain  { border-left: 2px solid #06B6D4; }
.intel-card.signal-neutral  { border-left: 2px solid var(--border-strong); }

.intel-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-2);
}

.intel-card-left {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  flex-wrap: wrap;
}

.signal-badge {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 2px 6px;
  border-radius: 4px;
}

.signal-badge--bullish  { color: var(--bull);  background: rgba(16,185,129,0.12); }
.signal-badge--bearish  { color: var(--bear);  background: rgba(239,68,68,0.12); }
.signal-badge--whale    { color: #A78BFA;      background: rgba(139,92,246,0.12); }
.signal-badge--macro    { color: #FCD34D;      background: rgba(245,158,11,0.12); }
.signal-badge--onchain  { color: #22D3EE;      background: rgba(6,182,212,0.12); }
.signal-badge--neutral  { color: var(--text-muted); background: rgba(255,255,255,0.06); }

.breaking-badge {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--bear);
  background: rgba(239,68,68,0.15);
  animation: breakingPulse 1.5s ease-in-out infinite;
}

@keyframes breakingPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.ticker-badge {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 4px;
  color: var(--text-tertiary);
  background: rgba(255,255,255,0.06);
}

.intel-card-time {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
}

.intel-card-headline {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-primary);
  margin: 0 0 var(--sp-1);
}

.intel-card-brief {
  max-height: 0;
  overflow: hidden;
  transition: max-height 250ms ease, opacity 200ms ease;
  opacity: 0;
}

.intel-card-brief--visible {
  max-height: 200px;
  opacity: 1;
}

.intel-card-brief p {
  font-family: var(--font-body);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: var(--sp-2) 0;
}

.intel-card-sources {
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
  margin-top: var(--sp-2);
}

.source-chip {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 2px 6px;
}

.intel-card-expand-hint {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  margin-top: var(--sp-1);
  opacity: 0;
  transition: opacity 150ms ease;
}

.intel-card:hover .intel-card-expand-hint {
  opacity: 1;
}
```

### War Room Chat
```css
/* ─── WAR ROOM CHAT ─────────────────────────────────────────────── */
.war-room-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: linear-gradient(168deg, #07060a 0%, #09080d 35%, #040306 70%, #020103 100%);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.06),
    inset 0 1px 0 rgba(255,255,255,0.10),
    0 4px 24px rgba(0,0,0,0.4);
}

.wrc-header {
  padding: var(--sp-4) var(--sp-5);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.wrc-title {
  display: block;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.wrc-subtitle {
  display: block;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}

.wrc-answer-area {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-4) var(--sp-5);
  display: flex;
  flex-direction: column;
}

/* Suggested prompts */
.wrc-suggestions {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.wrc-suggestions-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: var(--sp-1);
}

.wrc-suggestion-pill {
  text-align: left;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--text-secondary);
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-3);
  cursor: pointer;
  transition: all 150ms ease;
  line-height: 1.4;
}

.wrc-suggestion-pill:hover {
  background: rgba(139,92,246,0.08);
  border-color: rgba(139,92,246,0.3);
  color: var(--text-primary);
  transform: translateX(4px);
}

/* Loading state */
.wrc-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: var(--sp-3);
}

.wrc-loading-dots {
  display: flex;
  gap: 6px;
}

.wrc-loading-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: dotPulse 1.2s ease-in-out infinite;
}
.wrc-loading-dots span:nth-child(2) { animation-delay: 0.2s; }
.wrc-loading-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

.wrc-loading-text {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

/* Answer */
.wrc-answer {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  animation: answerIn 0.3s ease;
}

@keyframes answerIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.wrc-answer-query {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

.wrc-answer-text {
  font-family: var(--font-cinema); /* Playfair Display — editorial, premium */
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-primary);
  letter-spacing: 0.01em;
}

.wrc-cursor {
  display: inline-block;
  color: var(--accent);
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.wrc-answer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-subtle);
}

.wrc-data-sources {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
}

.wrc-new-question {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--accent);
  background: transparent;
  border: 1px solid rgba(139,92,246,0.3);
  border-radius: 4px;
  padding: 3px 8px;
  cursor: pointer;
  transition: all 150ms ease;
}

.wrc-new-question:hover {
  background: rgba(139,92,246,0.1);
}

/* Input area */
.wrc-input-wrap {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.wrc-input {
  flex: 1;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--text-primary);
  outline: none;
  transition: border-color 150ms ease;
}

.wrc-input:focus {
  border-color: var(--border-accent);
  background: rgba(255,255,255,0.06);
}

.wrc-input::placeholder {
  color: var(--text-muted);
}

.wrc-send-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  border: none;
  color: white;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms ease;
  flex-shrink: 0;
}

.wrc-send-btn:hover:not(:disabled) {
  background: #7C3AED;
  transform: translateY(-1px);
}

.wrc-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

### Skeleton Loading
```css
/* ─── SKELETON ─────────────────────────────────────────────────── */
.intel-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.intel-skeleton-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--sp-3) var(--sp-4);
}

.skel-line {
  height: 10px;
  border-radius: 4px;
  background: linear-gradient(90deg,
    rgba(255,255,255,0.04) 25%,
    rgba(255,255,255,0.08) 50%,
    rgba(255,255,255,0.04) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  margin-bottom: var(--sp-2);
}

.skel-line--badge { width: 60px; height: 16px; margin-bottom: var(--sp-2); }
.skel-line--title { width: 85%; height: 14px; }
.skel-line--body  { width: 70%; height: 10px; margin-top: var(--sp-1); }

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

### Day Mode
```css
/* ─── DAY MODE ─────────────────────────────────────────────────── */
.app.app-day-mode .intel-card {
  background: #ffffff;
  border-color: rgba(0,0,0,0.08);
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
.app.app-day-mode .intel-card:hover {
  background: #f8fafc;
  border-color: rgba(0,0,0,0.12);
}
.app.app-day-mode .intel-card-headline {
  color: #0f172a;
}
.app.app-day-mode .intel-card-brief p {
  color: #475569;
}
.app.app-day-mode .war-room-chat {
  background: #ffffff;
  border-color: rgba(0,0,0,0.08);
}
.app.app-day-mode .wrc-title {
  color: #0f172a;
}
.app.app-day-mode .wrc-answer-text {
  color: #1e293b;
}
.app.app-day-mode .wrc-input {
  background: #f8fafc;
  border-color: rgba(0,0,0,0.12);
  color: #0f172a;
}
.app.app-day-mode .wrc-suggestion-pill {
  background: #f1f5f9;
  border-color: rgba(0,0,0,0.08);
  color: #475569;
}
.app.app-day-mode .wrc-suggestion-pill:hover {
  background: rgba(139,92,246,0.08);
  color: #0f172a;
}
```

---

## PART 5: INTEGRATION — ADD THE TAB

Find the tab strip in the Command Center (look for where "Top Coins", "On-Chain", "Prediction Markets" are defined). Add War Room as the FIRST tab:

```jsx
// In whatever component renders the bottom tab strip:
const BOTTOM_TABS = [
  { id: 'war-room', label: 'War Room' },      // ← ADD FIRST
  { id: 'top-coins', label: 'Top Coins' },
  { id: 'on-chain', label: 'On-Chain' },
  { id: 'prediction-markets', label: 'Prediction Markets' },
  { id: 'ai-agents', label: 'AI Agents' },
  { id: 'ai-models', label: 'AI Models' },
];

// Default active tab should now be 'war-room'
const [activeBottomTab, setActiveBottomTab] = useState('war-room');
```

And in the content area:
```jsx
{activeBottomTab === 'war-room' && (
  <WarRoomTab 
    watchlist={userWatchlist}       // pass from WatchlistsContext
    marketData={currentMarketData}  // BTC price, ETH, SOL, F&G, dominance
  />
)}
```

---

## PART 6: VERIFICATION

```bash
# Test intel feed
curl http://localhost:3001/api/war-room/intel | jq '.stories | length'
# Should return 8

# Test chat (non-streaming)
curl -X POST http://localhost:3001/api/war-room/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "Is BTC bullish right now?", "context": {"btcPrice": 68000, "fearGreed": 25}}'

# Check War Room tab renders
# Navigate to dashboard → Click "War Room" tab
# Intel cards should appear with stagger animation
# Chat panel should show suggested prompts

# Verify day mode
# Toggle day mode → War Room should flip correctly
```

---

## FINAL NOTES FOR CLAUDE CODE

1. **War Room tab is the default** — it should be the first thing users see when they open the dashboard
2. **The chat answer renders in Playfair Display** — this is intentional. Serif in a sea of sans-serif = editorial, premium, authoritative. Do not change this.
3. **Never show conversation history** — this is not a chatbot. Each answer replaces the last.
4. **Stagger animation on cards is mandatory** — cards appearing one-by-one signals intelligence arriving in real-time
5. **The intel feed auto-refreshes silently** — no loading flash on refresh, only on first load
6. **Source chips build trust** — they should be present on every card even if generic ("Spectre Market Data")
7. **Signal type left border is the visual anchor** — green/red/purple strips let users scan sentiment instantly without reading
