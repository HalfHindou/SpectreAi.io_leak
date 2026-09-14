/**
 * Spectre AI — Shared Utilities
 */

/**
 * Format a price for display
 */
export function formatPrice(price) {
  const p = parseFloat(price);
  if (isNaN(p)) return '$0.00';
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  if (p >= 0.0001) return '$' + p.toFixed(6);
  return '$' + p.toFixed(8);
}

/**
 * Format large numbers (market cap, volume)
 */
export function formatLarge(value) {
  const v = parseFloat(value);
  if (isNaN(v)) return '$0';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(2);
}

/**
 * Format percentage change
 */
export function formatChange(change) {
  const c = parseFloat(change);
  if (isNaN(c)) return '0.00%';
  const sign = c >= 0 ? '+' : '';
  return sign + c.toFixed(2) + '%';
}

/**
 * Determine if price change is positive
 */
export function isPositive(change) {
  return parseFloat(change) >= 0;
}

/**
 * Get arrow character for price change
 */
export function changeArrow(change) {
  return parseFloat(change) >= 0 ? '\u25B2' : '\u25BC';
}

/**
 * Determine Fear & Greed sentiment category
 */
export function getFGSentiment(value) {
  const v = parseInt(value, 10);
  if (v <= 25) return { label: 'Extreme Fear', sentiment: 'extreme-fear', color: '#EF4444' };
  if (v <= 45) return { label: 'Fear', sentiment: 'fear', color: '#F87171' };
  if (v <= 55) return { label: 'Neutral', sentiment: 'neutral', color: '#F59E0B' };
  if (v <= 75) return { label: 'Greed', sentiment: 'greed', color: '#34D399' };
  return { label: 'Extreme Greed', sentiment: 'extreme-greed', color: '#10B981' };
}

/**
 * Determine AI Pulse state from Fear & Greed + price action
 */
export function getAIPulseState(fgValue, btcChange24h) {
  const fg = parseInt(fgValue, 10);
  const btcChange = parseFloat(btcChange24h) || 0;

  if (fg <= 20 || btcChange <= -8) {
    return { state: 'RISK_OFF', label: 'Risk Off', color: '#EF4444', icon: '!' };
  }
  if (fg <= 35 || btcChange <= -5) {
    return { state: 'CAUTION', label: 'Caution', color: '#F59E0B', icon: '~' };
  }
  if (fg >= 80 && btcChange >= 5) {
    return { state: 'EUPHORIA', label: 'Euphoria', color: '#A78BFA', icon: '\u2191\u2191' };
  }
  if (fg >= 55 && btcChange >= 0) {
    return { state: 'RISK_ON', label: 'Risk On', color: '#10B981', icon: '\u2191' };
  }
  return { state: 'NEUTRAL', label: 'Neutral', color: '#F59E0B', icon: '-' };
}

/**
 * Debounce function
 */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Generate a deep link to Spectre AI for a token
 */
export function getSpectreDeepLink(token) {
  if (token.codex?.address && token.codex?.networkId) {
    return `https://trade.spectreai.io/lite#token/${token.codex.networkId}/${token.codex.address}`;
  }
  return `https://trade.spectreai.io/lite?search=${encodeURIComponent(token.symbol)}`;
}

/**
 * Get token logo URL from CoinGecko ID
 */
export function getTokenLogo(coingeckoId) {
  if (!coingeckoId) return null;
  return `https://assets.coingecko.com/coins/images/1/small/${coingeckoId}.png`;
}

/**
 * Draw a sparkline on a canvas element
 */
export function drawSparkline(canvas, data, color) {
  if (!canvas || !data || data.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  data.forEach((val, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((val - min) / range) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, color.replace(')', ', 0.15)').replace('rgb', 'rgba'));
  gradient.addColorStop(1, 'transparent');
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}
