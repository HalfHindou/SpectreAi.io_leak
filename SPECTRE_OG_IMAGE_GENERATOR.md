# SPECTRE OG IMAGE GENERATOR — Dynamic Social Cards

> **Paste into Claude Code. This builds a server-side OG image generator that creates premium social preview cards for every Intelligence Hub article. When someone shares a Spectre article on X, LinkedIn, or Discord, it shows a branded dark-glass card with the article title, asset price, change %, and Spectre branding. Route: `GET /og/:type/:slug.png`**

---

## BEFORE YOU START

```bash
# Install node-canvas (server-side image generation)
cd server
npm install canvas

# Check if fonts exist in the project
find . -name "*.ttf" -o -name "*.woff" -o -name "*.woff2" | head -20

# Read the design law for exact colors/tokens
cat .cursor/rules/SPECTRE_DESIGN_LAW.md | head -100

# Check existing OG references in Intelligence Hub articles
grep -r "ogImage" server/content/ 2>/dev/null | head -5
grep -r "og:" server/seo/ 2>/dev/null | head -10

# Check what the articles reference
grep "ogImage" server/agents/*.js 2>/dev/null | head -5
```

---

## WHAT THIS DOES

Every Intelligence Hub article has an `ogImage` field pointing to:
```
https://app.spectreai.io/og/daily/2026-02-19.png
https://app.spectreai.io/og/crypto/bitcoin.png
https://app.spectreai.io/og/stocks/NVDA.png
```

Right now those URLs 404. This builds a server route that generates these images on the fly using node-canvas, caches them, and serves them as PNG. The result is a premium branded card that makes every shared Spectre link look professional on social media.

---

## IMAGE DIMENSIONS

Standard Open Graph: **1200 x 630 pixels**

This works on: X/Twitter (summary_large_image), LinkedIn, Discord, Telegram, iMessage, Slack, Facebook.

---

## DESIGN SPECS — 3 TEMPLATES

### Template 1: DAILY BRIEF

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                      │  │
│  │   SPECTRE ◆ INTELLIGENCE                             │  │
│  │                                                      │  │
│  │   ─────────────────────────────────                  │  │
│  │                                                      │  │
│  │   DAILY MARKET BRIEF                                 │  │
│  │                                                      │  │
│  │   BTC Holds $98K as ETF Inflows                      │  │
│  │   Surge; NVDA Rallies on AI                          │  │
│  │   Spending Estimates                                 │  │
│  │                                                      │  │
│  │   ─────────────────────────────────                  │  │
│  │                                                      │  │
│  │   FEBRUARY 19, 2026                                  │  │
│  │                                                      │  │
│  │   BTC $98,421 (+2.3%)    ETH $3,245 (-1.1%)        │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│                              app.spectreai.io/intelligence  │
└─────────────────────────────────────────────────────────────┘
```

### Template 2: CRYPTO ANALYSIS

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                      │  │
│  │   SPECTRE ◆ INTELLIGENCE                             │  │
│  │                                                      │  │
│  │   ─────────────────────────────────                  │  │
│  │                                                      │  │
│  │   CRYPTO ANALYSIS                                    │  │
│  │                                                      │  │
│  │   Bitcoin (BTC)                                      │  │
│  │                                                      │  │
│  │   ┌─────────────────────────────────────────────┐   │  │
│  │   │  $98,421          +2.3%         #1          │   │  │
│  │   │  Price            24h       Mkt Cap Rank    │   │  │
│  │   └─────────────────────────────────────────────┘   │  │
│  │                                                      │  │
│  │   Price, Fundamentals & Outlook                      │  │
│  │   Updated February 19, 2026                          │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│                              app.spectreai.io/intelligence  │
└─────────────────────────────────────────────────────────────┘
```

### Template 3: STOCK ANALYSIS

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                      │  │
│  │   SPECTRE ◆ INTELLIGENCE                             │  │
│  │                                                      │  │
│  │   ─────────────────────────────────                  │  │
│  │                                                      │  │
│  │   EQUITY RESEARCH                                    │  │
│  │                                                      │  │
│  │   NVIDIA (NVDA)                                      │  │
│  │                                                      │  │
│  │   ┌─────────────────────────────────────────────┐   │  │
│  │   │  $142.30          +3.8%       $3.49T        │   │  │
│  │   │  Price            24h         Mkt Cap       │   │  │
│  │   └─────────────────────────────────────────────┘   │  │
│  │                                                      │  │
│  │   Earnings, Valuation & Outlook                      │  │
│  │   Updated February 19, 2026                          │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│                              app.spectreai.io/intelligence  │
└─────────────────────────────────────────────────────────────┘
```

---

## EXACT COLORS AND STYLING

All values from SPECTRE_DESIGN_LAW.md:

```
BACKGROUND (outer):     #000000 (void black)
CARD BACKGROUND:        Linear gradient — top-left #0e0d14 to bottom-right #08070d
CARD BORDER:            rgba(255, 255, 255, 0.12) — 1px, with subtle corner radius illusion
INNER DATA CARD BG:     #0a0a0f with border rgba(255,255,255,0.08)

TEXT:
  "SPECTRE ◆ INTELLIGENCE"  — #FFFFFF, weight 600, 18px, letter-spacing 0.15em
  Category label            — rgba(255,255,255,0.48), weight 600, 13px, uppercase, letter-spacing 0.12em
  Asset name                — #FFFFFF, weight 700, 42px (main headline)
  Headline (daily brief)    — #FFFFFF, weight 600, 36px, max 3 lines
  Price                     — #FFFFFF, weight 700, 32px, monospace
  Change % positive         — #10B981 (green), weight 600, 24px, monospace
  Change % negative         — #EF4444 (red), weight 600, 24px, monospace
  Sublabels ("Price", "24h")— rgba(255,255,255,0.36), weight 500, 12px
  Date                      — rgba(255,255,255,0.48), weight 500, 14px
  URL watermark             — rgba(255,255,255,0.24), weight 400, 13px

ACCENT:
  Divider lines             — rgba(255,255,255,0.08), 1px
  The ◆ diamond in header   — #8B5CF6 (accent purple)

CARD EFFECTS:
  Inner glow at top edge    — draw a subtle line at the card top: rgba(255,255,255,0.10)
  Outer shadow              — just use solid dark background, canvas can't do box-shadow easily
```

---

## FONT LOADING

node-canvas requires .ttf or .otf font files registered before use.

```bash
# Download the fonts we need (or copy from existing project assets)
mkdir -p server/fonts

# Option 1: If fonts exist in the project
find . -name "SpaceGrotesk*" -o -name "Inter*" -o -name "JetBrainsMono*" | head -10
# Copy them to server/fonts/

# Option 2: Download from Google Fonts (if not already in project)
# Space Grotesk (headings): https://fonts.google.com/specimen/Space+Grotesk
# Inter (body): https://fonts.google.com/specimen/Inter
# JetBrains Mono (numbers): https://fonts.google.com/specimen/JetBrains+Mono
```

Register fonts in the generator:
```javascript
const { registerFont, createCanvas } = require('canvas');
const path = require('path');

// Register fonts ONCE at startup
registerFont(path.join(__dirname, '../fonts/SpaceGrotesk-Bold.ttf'), { family: 'Space Grotesk', weight: 'bold' });
registerFont(path.join(__dirname, '../fonts/SpaceGrotesk-SemiBold.ttf'), { family: 'Space Grotesk', weight: '600' });
registerFont(path.join(__dirname, '../fonts/SpaceGrotesk-Medium.ttf'), { family: 'Space Grotesk', weight: '500' });
registerFont(path.join(__dirname, '../fonts/Inter-Regular.ttf'), { family: 'Inter', weight: 'normal' });
registerFont(path.join(__dirname, '../fonts/Inter-Medium.ttf'), { family: 'Inter', weight: '500' });
registerFont(path.join(__dirname, '../fonts/Inter-SemiBold.ttf'), { family: 'Inter', weight: '600' });
registerFont(path.join(__dirname, '../fonts/JetBrainsMono-Bold.ttf'), { family: 'JetBrains Mono', weight: 'bold' });
registerFont(path.join(__dirname, '../fonts/JetBrainsMono-SemiBold.ttf'), { family: 'JetBrains Mono', weight: '600' });
```

If font files can't be found or downloaded, fall back to system fonts: `'Arial', 'Helvetica', sans-serif` for display/body and `'Courier New', monospace` for numbers. The result won't be as premium but will still work.

---

## IMPLEMENTATION — `server/og/generator.js`

```javascript
const { createCanvas, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 60;
const CARD_MARGIN = 32;
const CARD_RADIUS = 20;

// Colors
const COLORS = {
  void: '#000000',
  cardBg: '#0b0a10',
  cardBgEnd: '#07060b',
  border: 'rgba(255, 255, 255, 0.12)',
  borderSubtle: 'rgba(255, 255, 255, 0.08)',
  topEdge: 'rgba(255, 255, 255, 0.10)',
  white: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.72)',
  textTertiary: 'rgba(255, 255, 255, 0.48)',
  textMuted: 'rgba(255, 255, 255, 0.36)',
  textWatermark: 'rgba(255, 255, 255, 0.24)',
  accent: '#8B5CF6',
  bull: '#10B981',
  bear: '#EF4444',
  innerCardBg: '#0a0a0f',
};

// Try to register fonts, fail gracefully
function loadFonts() {
  const fontDir = path.join(__dirname, '../fonts');
  const fontFiles = {
    'Space Grotesk': [
      { file: 'SpaceGrotesk-Bold.ttf', weight: 'bold' },
      { file: 'SpaceGrotesk-SemiBold.ttf', weight: '600' },
      { file: 'SpaceGrotesk-Medium.ttf', weight: '500' },
    ],
    'Inter': [
      { file: 'Inter-Regular.ttf', weight: 'normal' },
      { file: 'Inter-Medium.ttf', weight: '500' },
      { file: 'Inter-SemiBold.ttf', weight: '600' },
    ],
    'JetBrains Mono': [
      { file: 'JetBrainsMono-Bold.ttf', weight: 'bold' },
      { file: 'JetBrainsMono-SemiBold.ttf', weight: '600' },
    ],
  };

  let loaded = false;
  for (const [family, variants] of Object.entries(fontFiles)) {
    for (const v of variants) {
      const filePath = path.join(fontDir, v.file);
      if (fs.existsSync(filePath)) {
        try {
          registerFont(filePath, { family, weight: v.weight });
          loaded = true;
        } catch (e) {
          console.warn(`[og] Failed to register font ${v.file}:`, e.message);
        }
      }
    }
  }
  if (!loaded) console.warn('[og] No custom fonts loaded, using system fallbacks');
  return loaded;
}

const fontsLoaded = loadFonts();

// Font helpers (with fallbacks)
const FONT = {
  display: fontsLoaded ? 'Space Grotesk' : 'Arial',
  body: fontsLoaded ? 'Inter' : 'Arial',
  mono: fontsLoaded ? 'JetBrains Mono' : 'Courier New',
};

// Helper: draw rounded rectangle
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Helper: truncate text to fit width
function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '...').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '...';
}

// Helper: wrap text into lines
function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines) break;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }
  // Truncate last line if we hit max
  if (lines.length === maxLines && words.length > lines.join(' ').split(' ').length) {
    lines[lines.length - 1] = truncateText(ctx, lines[lines.length - 1], maxWidth);
  }
  return lines;
}

// Helper: format price
function formatPrice(price) {
  if (!price || price === 0) return '$—';
  if (price >= 1000) return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1) return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return '$' + price.toFixed(6);
}

// Helper: format change
function formatChange(change) {
  if (change === null || change === undefined) return '—';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}%`;
}

// Helper: format market cap
function formatMarketCap(mc) {
  if (!mc || mc === 0) return '—';
  if (mc >= 1e12) return '$' + (mc / 1e12).toFixed(2) + 'T';
  if (mc >= 1e9) return '$' + (mc / 1e9).toFixed(1) + 'B';
  if (mc >= 1e6) return '$' + (mc / 1e6).toFixed(0) + 'M';
  return '$' + mc.toLocaleString();
}

// Draw base card (shared across all templates)
function drawBaseCard(ctx) {
  // Void background
  ctx.fillStyle = COLORS.void;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Main card with gradient
  const cardX = CARD_MARGIN;
  const cardY = CARD_MARGIN;
  const cardW = WIDTH - CARD_MARGIN * 2;
  const cardH = HEIGHT - CARD_MARGIN * 2 - 28; // leave room for watermark

  const grad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
  grad.addColorStop(0, COLORS.cardBg);
  grad.addColorStop(1, COLORS.cardBgEnd);

  roundRect(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS);
  ctx.fillStyle = grad;
  ctx.fill();

  // Card border
  roundRect(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Top edge highlight (simulates inset glow)
  ctx.beginPath();
  ctx.moveTo(cardX + CARD_RADIUS, cardY + 0.5);
  ctx.lineTo(cardX + cardW - CARD_RADIUS, cardY + 0.5);
  ctx.strokeStyle = COLORS.topEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Header: SPECTRE ◆ INTELLIGENCE
  ctx.font = `600 18px "${FONT.display}"`;
  ctx.letterSpacing = '2px';
  const spectreText = 'SPECTRE';
  const intelligenceText = 'INTELLIGENCE';
  const diamond = ' ◆ ';

  const startX = PADDING + CARD_MARGIN;
  const headerY = CARD_MARGIN + 56;

  ctx.fillStyle = COLORS.white;
  ctx.fillText(spectreText, startX, headerY);
  const spectreWidth = ctx.measureText(spectreText).width;

  ctx.fillStyle = COLORS.accent;
  ctx.fillText(diamond, startX + spectreWidth, headerY);
  const diamondWidth = ctx.measureText(diamond).width;

  ctx.fillStyle = COLORS.white;
  ctx.fillText(intelligenceText, startX + spectreWidth + diamondWidth, headerY);

  // Divider under header
  const divY = headerY + 20;
  ctx.beginPath();
  ctx.moveTo(startX, divY);
  ctx.lineTo(startX + 320, divY);
  ctx.strokeStyle = COLORS.borderSubtle;
  ctx.lineWidth = 1;
  ctx.stroke();

  // URL watermark (bottom right)
  ctx.font = `400 13px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textWatermark;
  ctx.textAlign = 'right';
  ctx.fillText('app.spectreai.io/intelligence', WIDTH - CARD_MARGIN - 16, HEIGHT - 12);
  ctx.textAlign = 'left';

  return { cardX, cardY, cardW, cardH, startX, divY };
}

// ══════════════════════════════════════════════════
// TEMPLATE: Daily Brief
// ══════════════════════════════════════════════════
function renderDailyBrief(article) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const { startX, divY } = drawBaseCard(ctx);

  const contentX = startX;
  const maxTextW = WIDTH - PADDING * 2 - CARD_MARGIN * 2;
  let cursorY = divY + 36;

  // Category
  ctx.font = `600 13px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textTertiary;
  ctx.fillText('DAILY MARKET BRIEF', contentX, cursorY);
  cursorY += 44;

  // Headline (wrapped, max 3 lines)
  ctx.font = `600 36px "${FONT.display}"`;
  ctx.fillStyle = COLORS.white;
  const headlineLines = wrapText(ctx, article.headline || article.title || 'Market Brief', maxTextW, 3);
  for (const line of headlineLines) {
    ctx.fillText(line, contentX, cursorY);
    cursorY += 46;
  }
  cursorY += 16;

  // Divider
  ctx.beginPath();
  ctx.moveTo(contentX, cursorY);
  ctx.lineTo(contentX + 320, cursorY);
  ctx.strokeStyle = COLORS.borderSubtle;
  ctx.lineWidth = 1;
  ctx.stroke();
  cursorY += 28;

  // Date
  const dateStr = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()
    : 'TODAY';
  ctx.font = `500 14px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textTertiary;
  ctx.fillText(dateStr, contentX, cursorY);
  cursorY += 36;

  // Ticker prices (from data snapshot)
  const prices = article.dataSnapshot?.prices || {};
  const changes = article.dataSnapshot?.changes || {};
  const tickers = Object.keys(prices).slice(0, 4);

  if (tickers.length > 0) {
    let tickerX = contentX;
    for (const ticker of tickers) {
      const price = formatPrice(prices[ticker]);
      const change = changes[ticker];
      const changeStr = formatChange(change);

      ctx.font = `bold 15px "${FONT.mono}"`;
      ctx.fillStyle = COLORS.white;
      ctx.fillText(`${ticker} ${price}`, tickerX, cursorY);

      const tickerPriceW = ctx.measureText(`${ticker} ${price} `).width;
      ctx.font = `600 15px "${FONT.mono}"`;
      ctx.fillStyle = change >= 0 ? COLORS.bull : COLORS.bear;
      ctx.fillText(`(${changeStr})`, tickerX + tickerPriceW, cursorY);

      const fullW = ctx.measureText(`${ticker} ${price} (${changeStr})`).width;
      tickerX += fullW + 40;
    }
  }

  return canvas.toBuffer('image/png');
}

// ══════════════════════════════════════════════════
// TEMPLATE: Crypto / Stock Analysis
// ══════════════════════════════════════════════════
function renderAssetAnalysis(article, isCrypto) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const { startX, divY, cardW } = drawBaseCard(ctx);

  const contentX = startX;
  const maxTextW = WIDTH - PADDING * 2 - CARD_MARGIN * 2;
  let cursorY = divY + 36;

  // Category
  const category = isCrypto ? 'CRYPTO ANALYSIS' : 'EQUITY RESEARCH';
  ctx.font = `600 13px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textTertiary;
  ctx.fillText(category, contentX, cursorY);
  cursorY += 48;

  // Asset name (big)
  const ticker = (article.tickers || [])[0] || '';
  const assetName = article.headline?.replace(/\s*—.*$/, '').replace(/\s*\(.*?\)\s*$/, '')
    || `${ticker} Analysis`;
  ctx.font = `700 42px "${FONT.display}"`;
  ctx.fillStyle = COLORS.white;
  const truncName = truncateText(ctx, assetName, maxTextW);
  ctx.fillText(truncName, contentX, cursorY);
  cursorY += 56;

  // Inner data card
  const snapshot = article.dataSnapshot || {};
  const price = (snapshot.prices || {})[ticker] || 0;
  const change = (snapshot.changes || {})[ticker] || 0;
  const marketCap = (snapshot.marketCap || {})[ticker] || 0;

  const innerX = contentX;
  const innerY = cursorY;
  const innerW = cardW - PADDING * 2 + CARD_MARGIN;
  const innerH = 80;

  roundRect(ctx, innerX, innerY, innerW, innerH, 12);
  ctx.fillStyle = COLORS.innerCardBg;
  ctx.fill();
  roundRect(ctx, innerX, innerY, innerW, innerH, 12);
  ctx.strokeStyle = COLORS.borderSubtle;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Data columns inside inner card
  const colWidth = innerW / 3;
  const dataY = innerY + 32;
  const labelY = innerY + 58;

  // Column 1: Price
  ctx.font = `bold 26px "${FONT.mono}"`;
  ctx.fillStyle = COLORS.white;
  ctx.fillText(formatPrice(price), innerX + 20, dataY);
  ctx.font = `500 12px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText('Price', innerX + 20, labelY);

  // Column 2: Change
  ctx.font = `600 24px "${FONT.mono}"`;
  ctx.fillStyle = change >= 0 ? COLORS.bull : COLORS.bear;
  ctx.fillText(formatChange(change), innerX + colWidth + 20, dataY);
  ctx.font = `500 12px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText('24h', innerX + colWidth + 20, labelY);

  // Column 3: Market Cap or Rank
  ctx.font = `600 24px "${FONT.mono}"`;
  ctx.fillStyle = COLORS.white;
  const col3Value = marketCap ? formatMarketCap(marketCap) : '—';
  ctx.fillText(col3Value, innerX + colWidth * 2 + 20, dataY);
  ctx.font = `500 12px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText('Mkt Cap', innerX + colWidth * 2 + 20, labelY);

  cursorY = innerY + innerH + 32;

  // Subtitle
  const subtitle = isCrypto
    ? 'Price, Fundamentals & Outlook'
    : 'Earnings, Valuation & Outlook';
  ctx.font = `500 18px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textSecondary;
  ctx.fillText(subtitle, contentX, cursorY);
  cursorY += 28;

  // Date
  const dateStr = article.publishedAt
    ? `Updated ${new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
    : 'Updated today';
  ctx.font = `500 14px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textTertiary;
  ctx.fillText(dateStr, contentX, cursorY);

  return canvas.toBuffer('image/png');
}

// ══════════════════════════════════════════════════
// TEMPLATE: Thematic Research (fallback)
// ══════════════════════════════════════════════════
function renderResearch(article) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const { startX, divY } = drawBaseCard(ctx);

  const contentX = startX;
  const maxTextW = WIDTH - PADDING * 2 - CARD_MARGIN * 2;
  let cursorY = divY + 36;

  ctx.font = `600 13px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textTertiary;
  ctx.fillText('RESEARCH', contentX, cursorY);
  cursorY += 48;

  ctx.font = `600 38px "${FONT.display}"`;
  ctx.fillStyle = COLORS.white;
  const lines = wrapText(ctx, article.headline || article.title || 'Research', maxTextW, 3);
  for (const line of lines) {
    ctx.fillText(line, contentX, cursorY);
    cursorY += 48;
  }
  cursorY += 24;

  if (article.summary) {
    ctx.font = `500 16px "${FONT.body}"`;
    ctx.fillStyle = COLORS.textSecondary;
    const sumLines = wrapText(ctx, article.summary, maxTextW, 2);
    for (const line of sumLines) {
      ctx.fillText(line, contentX, cursorY);
      cursorY += 24;
    }
  }
  cursorY += 20;

  const dateStr = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';
  if (dateStr) {
    ctx.font = `500 14px "${FONT.body}"`;
    ctx.fillStyle = COLORS.textTertiary;
    ctx.fillText(dateStr, contentX, cursorY);
  }

  return canvas.toBuffer('image/png');
}

// ══════════════════════════════════════════════════
// MAIN: Generate OG image from article
// ══════════════════════════════════════════════════
function generateOgImage(article) {
  if (!article) return null;

  switch (article.type) {
    case 'daily':
      return renderDailyBrief(article);
    case 'crypto':
      return renderAssetAnalysis(article, true);
    case 'stocks':
      return renderAssetAnalysis(article, false);
    case 'research':
    case 'data':
    default:
      return renderResearch(article);
  }
}

module.exports = { generateOgImage };
```

---

## CACHING LAYER

OG images don't change often. Cache aggressively:

```javascript
// server/og/cache.js

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '../content/og-cache');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCachedImage(type, slug) {
  ensureCacheDir();
  const filePath = path.join(CACHE_DIR, `${type}-${slug}.png`);
  if (!fs.existsSync(filePath)) return null;
  
  // Check if cache is fresh (< 1 hour)
  const stat = fs.statSync(filePath);
  const ageMs = Date.now() - stat.mtimeMs;
  if (ageMs > 60 * 60 * 1000) return null; // Expired
  
  return fs.readFileSync(filePath);
}

function setCachedImage(type, slug, buffer) {
  ensureCacheDir();
  const filePath = path.join(CACHE_DIR, `${type}-${slug}.png`);
  fs.writeFileSync(filePath, buffer);
}

module.exports = { getCachedImage, setCachedImage };
```

---

## ROUTE — `GET /og/:type/:slug.png`

```javascript
// Add to server/index.js

const { generateOgImage } = require('./og/generator');
const { getCachedImage, setCachedImage } = require('./og/cache');
const { loadArticle } = require('./content/store');

app.get('/og/:type/:slug.png', (req, res) => {
  const { type, slug } = req.params;
  
  // Check cache first
  const cached = getCachedImage(type, slug);
  if (cached) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1hr browser cache
    return res.send(cached);
  }
  
  // Load article
  const article = loadArticle(type, slug);
  if (!article) {
    // Return a default Spectre branded fallback image
    // (or 404 — but a fallback is better for social previews)
    return res.status(404).send('Not found');
  }
  
  // Generate
  const buffer = generateOgImage(article);
  if (!buffer) {
    return res.status(500).send('Generation failed');
  }
  
  // Cache for next time
  setCachedImage(type, slug, buffer);
  
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(buffer);
});
```

---

## DEFAULT FALLBACK IMAGE

Generate a simple branded Spectre OG card for pages without specific articles:

```javascript
// Also register a default OG route
app.get('/spectre-og-default.png', (req, res) => {
  const cached = getCachedImage('default', 'spectre');
  if (cached) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cached);
  }
  
  const canvas = createCanvas(1200, 630);
  const ctx = canvas.getContext('2d');
  
  // Draw base card
  drawBaseCard(ctx);
  
  const contentX = 92;
  let y = 160;
  
  ctx.font = `600 13px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textTertiary;
  ctx.fillText('AI-POWERED MARKET INTELLIGENCE', contentX, y);
  y += 52;
  
  ctx.font = `700 44px "${FONT.display}"`;
  ctx.fillStyle = COLORS.white;
  ctx.fillText('Spectre AI', contentX, y);
  y += 44;
  
  ctx.font = `500 20px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textSecondary;
  ctx.fillText('Research. Analysis. Intelligence.', contentX, y);
  y += 40;
  
  ctx.font = `500 16px "${FONT.body}"`;
  ctx.fillStyle = COLORS.textTertiary;
  ctx.fillText('Crypto & Stocks · Updated Daily · 53+ Research Pages/Day', contentX, y);
  
  const buffer = canvas.toBuffer('image/png');
  setCachedImage('default', 'spectre', buffer);
  
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buffer);
});
```

---

## VERIFICATION

```bash
# 1. Install node-canvas
cd server && npm install canvas && cd ..

# 2. Make sure at least one article exists
curl -X POST http://localhost:3001/api/intelligence/generate/crypto/BTC \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"coinGeckoId": "bitcoin"}'

# 3. Generate OG image
curl -o /tmp/test-og.png http://localhost:3001/og/crypto/bitcoin.png
# Open /tmp/test-og.png — verify it looks correct

# 4. Test daily brief OG
curl -o /tmp/test-daily.png http://localhost:3001/og/daily/2026-02-19.png

# 5. Test stock OG
curl -o /tmp/test-stock.png http://localhost:3001/og/stocks/NVDA.png

# 6. Test default fallback
curl -o /tmp/test-default.png http://localhost:3001/spectre-og-default.png

# 7. Check cache was created
ls server/content/og-cache/

# 8. Verify correct Content-Type header
curl -I http://localhost:3001/og/crypto/bitcoin.png | grep Content-Type
# Should show: Content-Type: image/png

# 9. Check the HTML references work
curl -s http://localhost:3001/intelligence/crypto/bitcoin | grep "og:image"
# Should show: <meta property="og:image" content="https://app.spectreai.io/og/crypto/bitcoin.png">

# 10. Test on social preview tools
# Paste article URL into: https://cards-dev.twitter.com/validator
# Or: https://developers.facebook.com/tools/debug/
```

---

## FONT DOWNLOAD HELPER

If fonts aren't in the project, download them:

```bash
mkdir -p server/fonts
cd server/fonts

# Space Grotesk
curl -L -o SpaceGrotesk-Bold.ttf "https://github.com/nicovanzyl/space-grotesk/raw/main/SpaceGrotesk%5Bwght%5D.ttf" 2>/dev/null || echo "Download manually from Google Fonts"

# JetBrains Mono  
curl -L -o JetBrainsMono-Bold.ttf "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Bold.ttf" 2>/dev/null || echo "Download manually"

# Inter
curl -L -o Inter-Regular.ttf "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Regular.ttf" 2>/dev/null || echo "Download manually"
```

If font download fails, the generator will fall back to system fonts. The layout will still work — just without the premium Spectre typography.
