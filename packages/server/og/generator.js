/**
 * Spectre Intelligence Hub — OG Image Generator
 * Creates premium 1200x630 social preview cards for X, LinkedIn, Discord, etc.
 * Uses node-canvas with Space Grotesk, Inter, and JetBrains Mono fonts.
 */
let createCanvas, registerFont;
try {
  ({ createCanvas, registerFont } = require('canvas'));
} catch {
  // canvas native bindings not built — OG image generation disabled
  createCanvas = () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), toBuffer: () => Buffer.alloc(0) });
  registerFont = () => {};
}
const path = require('path');
const fs = require('fs');

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 60;
const CARD_MARGIN = 32;
const CARD_RADIUS = 20;

// ── COLORS (from SPECTRE_DESIGN_LAW) ──
const C = {
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

// ── FONT LOADING ──
function loadFonts() {
  const fontDir = path.join(__dirname, '..', 'fonts');
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

  let loaded = 0;
  for (const [family, variants] of Object.entries(fontFiles)) {
    for (const v of variants) {
      const filePath = path.join(fontDir, v.file);
      if (fs.existsSync(filePath)) {
        try {
          registerFont(filePath, { family, weight: v.weight });
          loaded++;
        } catch (e) {
          console.warn(`[og] Failed to register ${v.file}:`, e.message);
        }
      }
    }
  }
  if (loaded === 0) console.warn('[og] No custom fonts loaded, using system fallbacks');
  return loaded > 0;
}

const fontsLoaded = loadFonts();

const F = {
  display: fontsLoaded ? 'Space Grotesk' : 'Arial',
  body: fontsLoaded ? 'Inter' : 'Arial',
  mono: fontsLoaded ? 'JetBrains Mono' : 'Courier New',
};

// ── HELPERS ──

/** Strip markdown formatting from text for clean canvas rendering */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\*\*/g, '')    // bold markers
    .replace(/\*/g, '')      // italic markers
    .replace(/^#+\s*/gm, '') // heading markers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/`/g, '')       // code ticks
    .trim();
}

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

function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '...').width > maxWidth) t = t.slice(0, -1);
  return t + '...';
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = word;
      if (lines.length >= maxLines) break;
    } else {
      cur = test;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    lines[lines.length - 1] = truncateText(ctx, lines[lines.length - 1], maxWidth);
  }
  return lines;
}

function fmtPrice(p) {
  if (!p || p === 0) return '$\u2014';
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + p.toFixed(6);
}

function fmtChange(c) {
  if (c == null) return '\u2014';
  return `${c >= 0 ? '+' : ''}${c.toFixed(1)}%`;
}

function fmtMktCap(mc) {
  if (!mc) return '\u2014';
  if (mc >= 1e12) return '$' + (mc / 1e12).toFixed(2) + 'T';
  if (mc >= 1e9) return '$' + (mc / 1e9).toFixed(1) + 'B';
  if (mc >= 1e6) return '$' + (mc / 1e6).toFixed(0) + 'M';
  return '$' + mc.toLocaleString();
}

// ── DRAW BASE CARD (shared) ──

function drawBase(ctx, accentHue) {
  // Void background
  ctx.fillStyle = C.void;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Main card
  const cx = CARD_MARGIN, cy = CARD_MARGIN;
  const cw = WIDTH - CARD_MARGIN * 2, ch = HEIGHT - CARD_MARGIN * 2 - 28;

  const grad = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
  grad.addColorStop(0, C.cardBg);
  grad.addColorStop(1, C.cardBgEnd);

  roundRect(ctx, cx, cy, cw, ch, CARD_RADIUS);
  ctx.fillStyle = grad;
  ctx.fill();

  // Ambient gradient glow (adds visual depth)
  if (accentHue != null) {
    const glow = ctx.createRadialGradient(cx + cw * 0.75, cy + ch * 0.2, 0, cx + cw * 0.75, cy + ch * 0.2, cw * 0.55);
    glow.addColorStop(0, `hsla(${accentHue}, 80%, 50%, 0.08)`);
    glow.addColorStop(0.6, `hsla(${accentHue}, 60%, 40%, 0.03)`);
    glow.addColorStop(1, 'transparent');
    roundRect(ctx, cx, cy, cw, ch, CARD_RADIUS);
    ctx.fillStyle = glow;
    ctx.fill();

    // Second glow — bottom left
    const glow2 = ctx.createRadialGradient(cx + cw * 0.15, cy + ch * 0.85, 0, cx + cw * 0.15, cy + ch * 0.85, cw * 0.4);
    glow2.addColorStop(0, `hsla(${(accentHue + 40) % 360}, 70%, 45%, 0.06)`);
    glow2.addColorStop(0.7, 'transparent');
    roundRect(ctx, cx, cy, cw, ch, CARD_RADIUS);
    ctx.fillStyle = glow2;
    ctx.fill();
  }

  // Border
  roundRect(ctx, cx, cy, cw, ch, CARD_RADIUS);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Top edge highlight
  ctx.beginPath();
  ctx.moveTo(cx + CARD_RADIUS, cy + 0.5);
  ctx.lineTo(cx + cw - CARD_RADIUS, cy + 0.5);
  ctx.strokeStyle = C.topEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Header: SPECTRE diamond INTELLIGENCE
  const sx = PADDING + CARD_MARGIN;
  const hy = CARD_MARGIN + 56;

  ctx.font = `600 18px "${F.display}"`;
  ctx.fillStyle = C.white;
  ctx.fillText('SPECTRE', sx, hy);
  const sw = ctx.measureText('SPECTRE').width;

  ctx.fillStyle = C.accent;
  ctx.fillText(' \u25C6 ', sx + sw, hy);
  const dw = ctx.measureText(' \u25C6 ').width;

  ctx.fillStyle = C.white;
  ctx.fillText('INTELLIGENCE', sx + sw + dw, hy);

  // Divider
  const dy = hy + 20;
  ctx.beginPath();
  ctx.moveTo(sx, dy);
  ctx.lineTo(sx + 320, dy);
  ctx.strokeStyle = C.borderSubtle;
  ctx.lineWidth = 1;
  ctx.stroke();

  // URL watermark
  ctx.font = `400 13px "${F.body}"`;
  ctx.fillStyle = C.textWatermark;
  ctx.textAlign = 'right';
  ctx.fillText('app.spectreai.io/intelligence', WIDTH - CARD_MARGIN - 16, HEIGHT - 12);
  ctx.textAlign = 'left';

  return { sx, dy, cw };
}

// ── TEMPLATE: DAILY BRIEF ──

function renderDailyBrief(article) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const { sx, dy } = drawBase(ctx, 260); // purple hue

  const maxW = WIDTH - PADDING * 2 - CARD_MARGIN * 2;
  let y = dy + 36;

  // Category
  ctx.font = `600 13px "${F.body}"`;
  ctx.fillStyle = C.textTertiary;
  ctx.fillText('DAILY MARKET BRIEF', sx, y);
  y += 44;

  // Headline
  ctx.font = `600 36px "${F.display}"`;
  ctx.fillStyle = C.white;
  const lines = wrapText(ctx, cleanText(article.headline || article.title || 'Market Brief'), maxW, 3);
  for (const line of lines) {
    ctx.fillText(line, sx, y);
    y += 46;
  }
  y += 16;

  // Divider
  ctx.beginPath();
  ctx.moveTo(sx, y);
  ctx.lineTo(sx + 320, y);
  ctx.strokeStyle = C.borderSubtle;
  ctx.lineWidth = 1;
  ctx.stroke();
  y += 28;

  // Date
  const dateStr = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()
    : 'TODAY';
  ctx.font = `500 14px "${F.body}"`;
  ctx.fillStyle = C.textTertiary;
  ctx.fillText(dateStr, sx, y);
  y += 36;

  // Ticker prices from dataSnapshot
  const snap = article.dataSnapshot || {};
  const tickers = [];
  if (snap.btcPrice) tickers.push({ sym: 'BTC', price: snap.btcPrice, change: snap.btcChange });
  if (snap.ethPrice) tickers.push({ sym: 'ETH', price: snap.ethPrice, change: snap.ethChange });
  if (snap.solPrice) tickers.push({ sym: 'SOL', price: snap.solPrice, change: snap.solChange });

  if (tickers.length > 0) {
    let tx = sx;
    for (const t of tickers) {
      ctx.font = `bold 15px "${F.mono}"`;
      ctx.fillStyle = C.white;
      const priceStr = `${t.sym} ${fmtPrice(t.price)}`;
      ctx.fillText(priceStr, tx, y);
      const pw = ctx.measureText(priceStr + ' ').width;

      if (t.change != null) {
        ctx.font = `600 15px "${F.mono}"`;
        ctx.fillStyle = t.change >= 0 ? C.bull : C.bear;
        ctx.fillText(`(${fmtChange(t.change)})`, tx + pw, y);
        tx += pw + ctx.measureText(`(${fmtChange(t.change)})`).width + 40;
      } else {
        tx += pw + 40;
      }
    }
  }

  return canvas.toBuffer('image/png');
}

// ── TEMPLATE: CRYPTO / STOCK ANALYSIS ──

function renderAssetAnalysis(article, isCrypto) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const { sx, dy, cw } = drawBase(ctx, isCrypto ? 160 : 220); // green for crypto, blue for stocks

  const maxW = WIDTH - PADDING * 2 - CARD_MARGIN * 2;
  let y = dy + 36;

  // Category
  const category = isCrypto ? 'CRYPTO ANALYSIS' : 'EQUITY RESEARCH';
  ctx.font = `600 13px "${F.body}"`;
  ctx.fillStyle = C.textTertiary;
  ctx.fillText(category, sx, y);
  y += 48;

  // Asset name
  const ticker = (article.tickers || [])[0] || '';
  const name = article.headline
    ? cleanText(article.headline).replace(/ Analysis$/, '').replace(/\s*\|.*$/, '')
    : `${ticker} Analysis`;
  ctx.font = `700 42px "${F.display}"`;
  ctx.fillStyle = C.white;
  ctx.fillText(truncateText(ctx, name, maxW), sx, y);
  y += 56;

  // Inner data card
  const snap = article.dataSnapshot || {};
  const price = snap.price || 0;
  const change = snap.change || 0;
  const marketCap = snap.marketCap || 0;
  const rank = snap.rank || null;

  const innerX = sx;
  const innerY = y;
  const innerW = cw - PADDING * 2 + CARD_MARGIN;
  const innerH = 80;

  roundRect(ctx, innerX, innerY, innerW, innerH, 12);
  ctx.fillStyle = C.innerCardBg;
  ctx.fill();
  roundRect(ctx, innerX, innerY, innerW, innerH, 12);
  ctx.strokeStyle = C.borderSubtle;
  ctx.lineWidth = 1;
  ctx.stroke();

  const colW = innerW / 3;
  const dataY = innerY + 32;
  const labelY = innerY + 58;

  // Col 1: Price
  ctx.font = `bold 26px "${F.mono}"`;
  ctx.fillStyle = C.white;
  ctx.fillText(fmtPrice(price), innerX + 20, dataY);
  ctx.font = `500 12px "${F.body}"`;
  ctx.fillStyle = C.textMuted;
  ctx.fillText('Price', innerX + 20, labelY);

  // Col 2: Change
  ctx.font = `600 24px "${F.mono}"`;
  ctx.fillStyle = change >= 0 ? C.bull : C.bear;
  ctx.fillText(fmtChange(change), innerX + colW + 20, dataY);
  ctx.font = `500 12px "${F.body}"`;
  ctx.fillStyle = C.textMuted;
  ctx.fillText('24h', innerX + colW + 20, labelY);

  // Col 3: Market Cap or Rank
  ctx.font = `600 24px "${F.mono}"`;
  ctx.fillStyle = C.white;
  if (isCrypto && rank) {
    ctx.fillText(`#${rank}`, innerX + colW * 2 + 20, dataY);
    ctx.font = `500 12px "${F.body}"`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText('Mkt Cap Rank', innerX + colW * 2 + 20, labelY);
  } else {
    ctx.fillText(fmtMktCap(marketCap), innerX + colW * 2 + 20, dataY);
    ctx.font = `500 12px "${F.body}"`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText('Mkt Cap', innerX + colW * 2 + 20, labelY);
  }

  y = innerY + innerH + 32;

  // Subtitle
  const subtitle = isCrypto ? 'Price, Fundamentals & Outlook' : 'Earnings, Valuation & Outlook';
  ctx.font = `500 18px "${F.body}"`;
  ctx.fillStyle = C.textSecondary;
  ctx.fillText(subtitle, sx, y);
  y += 28;

  // Date
  const dateStr = article.publishedAt
    ? `Updated ${new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
    : 'Updated today';
  ctx.font = `500 14px "${F.body}"`;
  ctx.fillStyle = C.textTertiary;
  ctx.fillText(dateStr, sx, y);

  return canvas.toBuffer('image/png');
}

// ── TEMPLATE: RESEARCH / FALLBACK ──

function renderResearch(article) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const { sx, dy } = drawBase(ctx, 280); // indigo hue

  const maxW = WIDTH - PADDING * 2 - CARD_MARGIN * 2;
  let y = dy + 36;

  ctx.font = `600 13px "${F.body}"`;
  ctx.fillStyle = C.textTertiary;
  ctx.fillText('RESEARCH', sx, y);
  y += 48;

  ctx.font = `600 38px "${F.display}"`;
  ctx.fillStyle = C.white;
  const lines = wrapText(ctx, cleanText(article.headline || article.title || 'Research'), maxW, 3);
  for (const line of lines) {
    ctx.fillText(line, sx, y);
    y += 48;
  }
  y += 24;

  if (article.summary) {
    ctx.font = `500 16px "${F.body}"`;
    ctx.fillStyle = C.textSecondary;
    const sLines = wrapText(ctx, article.summary, maxW, 2);
    for (const line of sLines) {
      ctx.fillText(line, sx, y);
      y += 24;
    }
  }
  y += 20;

  if (article.publishedAt) {
    ctx.font = `500 14px "${F.body}"`;
    ctx.fillStyle = C.textTertiary;
    ctx.fillText(new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), sx, y);
  }

  return canvas.toBuffer('image/png');
}

// ── TEMPLATE: NEWS BRIEF ──

function renderNews(article) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  // Pick hue by category for visual variety
  const catHues = { bitcoin: 30, ethereum: 230, defi: 155, stocks: 215, macro: 40, regulation: 0, ai: 270 };
  const newsHue = catHues[(article.category || '').toLowerCase()] || 260;
  const { sx, dy } = drawBase(ctx, newsHue);

  const maxW = WIDTH - PADDING * 2 - CARD_MARGIN * 2;
  let y = dy + 36;

  // Category label — BREAKING NEWS, SPECTRE ANALYSIS, or NEWS BRIEF
  const isBreaking = article.isBreaking;
  const isOriginal = article.isOriginal || (article.sourceArticle?.source === 'Spectre AI');
  const label = isBreaking ? 'BREAKING NEWS' : isOriginal ? 'SPECTRE ANALYSIS' : 'NEWS BRIEF';
  ctx.font = `600 13px "${F.body}"`;
  ctx.fillStyle = isBreaking ? C.bear : C.accent;
  ctx.fillText(label, sx, y);

  // Sentiment badge next to label
  if (article.sentiment) {
    const labelW = ctx.measureText(label + '   ').width;
    const sentColor = article.sentiment === 'bullish' ? C.bull : article.sentiment === 'bearish' ? C.bear : C.textMuted;
    const sentLabel = article.sentiment.toUpperCase();

    // Pill background
    ctx.font = `600 11px "${F.body}"`;
    const sentW = ctx.measureText(sentLabel).width + 16;
    roundRect(ctx, sx + labelW, y - 12, sentW, 18, 9);
    ctx.fillStyle = sentColor;
    ctx.globalAlpha = 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Pill text
    ctx.fillStyle = sentColor;
    ctx.fillText(sentLabel, sx + labelW + 8, y);
  }
  y += 48;

  // Headline
  ctx.font = `600 34px "${F.display}"`;
  ctx.fillStyle = C.white;
  const lines = wrapText(ctx, cleanText(article.headline || article.title || 'News Brief'), maxW, 3);
  for (const line of lines) {
    ctx.fillText(line, sx, y);
    y += 44;
  }
  y += 16;

  // Divider
  ctx.beginPath();
  ctx.moveTo(sx, y);
  ctx.lineTo(sx + 320, y);
  ctx.strokeStyle = C.borderSubtle;
  ctx.lineWidth = 1;
  ctx.stroke();
  y += 24;

  // Source + Timestamp
  const source = article.sourceArticle?.source || 'Spectre AI';
  const timeStr = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Today';

  ctx.font = `500 15px "${F.body}"`;
  ctx.fillStyle = C.textSecondary;
  ctx.fillText(`Source: ${source}`, sx, y);
  y += 24;

  ctx.font = `500 14px "${F.body}"`;
  ctx.fillStyle = C.textTertiary;
  ctx.fillText(timeStr, sx, y);

  // Tickers on right side
  const tickers = (article.tickers || []).slice(0, 4);
  if (tickers.length > 0) {
    let tx = WIDTH - CARD_MARGIN - PADDING;
    ctx.textAlign = 'right';
    ctx.font = `bold 16px "${F.mono}"`;
    ctx.fillStyle = C.accent;
    ctx.fillText(tickers.join('  ·  '), tx, y);
    ctx.textAlign = 'left';
  }

  return canvas.toBuffer('image/png');
}

// ── DEFAULT SPECTRE CARD ──

function renderDefault() {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const { sx } = drawBase(ctx, 260);

  let y = 160;

  ctx.font = `600 13px "${F.body}"`;
  ctx.fillStyle = C.textTertiary;
  ctx.fillText('AI-POWERED MARKET INTELLIGENCE', sx, y);
  y += 52;

  ctx.font = `700 44px "${F.display}"`;
  ctx.fillStyle = C.white;
  ctx.fillText('Spectre AI', sx, y);
  y += 44;

  ctx.font = `500 20px "${F.body}"`;
  ctx.fillStyle = C.textSecondary;
  ctx.fillText('Research. Analysis. Intelligence.', sx, y);
  y += 40;

  ctx.font = `500 16px "${F.body}"`;
  ctx.fillStyle = C.textTertiary;
  ctx.fillText('Crypto & Stocks \u00B7 Updated Daily \u00B7 53+ Research Pages/Day', sx, y);

  return canvas.toBuffer('image/png');
}

// ── MAIN ENTRY ──

function generateOgImage(article) {
  if (!article) return null;
  switch (article.type) {
    case 'daily': return renderDailyBrief(article);
    case 'crypto': return renderAssetAnalysis(article, true);
    case 'stocks': return renderAssetAnalysis(article, false);
    case 'news': return renderNews(article);
    default: return renderResearch(article);
  }
}

module.exports = { generateOgImage, renderDefault };
