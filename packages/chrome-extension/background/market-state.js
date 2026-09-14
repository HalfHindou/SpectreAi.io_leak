/**
 * Spectre AI — Market State Manager
 * Uses CoinGecko global endpoint + CoinMarketCap Fear & Greed (primary)
 * with alternative.me fallback. CMC is the Spectre source of truth - its F&G
 * reading diverges from alternative.me by 20-40 points on some days.
 * Tracks F&G, BTC dominance, AI Pulse, and updates extension icon
 */

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const CMC_FNG_URL = 'https://api.coinmarketcap.com/data-api/v3/fear-greed/chart';
const MARKET_REFRESH = 5 * 60 * 1000; // 5 minutes

let marketState = {
  fearGreed: { value: 50, classification: 'Neutral' },
  btcDominance: 0,
  ethDominance: 0,
  solDominance: 0,
  totalMarketCap: 0,
  totalVolume: 0,
  marketCapChange24h: 0,
  aiPulse: { state: 'NEUTRAL', label: 'Neutral', color: '#F59E0B' },
  updatedAt: 0,
};

let refreshTimer = null;

/**
 * Initialize market state polling
 */
export function initMarketState() {
  refreshMarketState();
  refreshTimer = setInterval(refreshMarketState, MARKET_REFRESH);
}

/**
 * Stop market state polling
 */
export function stopMarketState() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Get current market state
 */
export function getMarketState() {
  return { ...marketState };
}

/**
 * Refresh market state from CoinGecko + alternative.me
 */
async function refreshMarketState() {
  // Fetch CoinGecko global market data
  try {
    const globalRes = await fetch(`${COINGECKO_BASE}/global`);
    if (globalRes.ok) {
      const json = await globalRes.json();
      const data = json.data || {};

      marketState.btcDominance = parseFloat(data.market_cap_percentage?.btc) || 0;
      marketState.ethDominance = parseFloat(data.market_cap_percentage?.eth) || 0;
      marketState.solDominance = parseFloat(data.market_cap_percentage?.sol) || 0;
      marketState.totalMarketCap = parseFloat(data.total_market_cap?.usd) || 0;
      marketState.totalVolume = parseFloat(data.total_volume?.usd) || 0;
      marketState.marketCapChange24h = parseFloat(data.market_cap_change_percentage_24h_usd) || 0;

      console.log('[Spectre] Global market data updated:', {
        btcD: marketState.btcDominance.toFixed(1) + '%',
        mcap: (marketState.totalMarketCap / 1e12).toFixed(2) + 'T',
        vol: (marketState.totalVolume / 1e9).toFixed(0) + 'B',
      });
    }
  } catch (err) {
    console.warn('[Spectre] CoinGecko global fetch failed:', err.message);
  }

  // Fetch Fear & Greed Index — CMC primary (matches Spectre app),
  // alternative.me fallback only if CMC fails
  let fgUpdated = false;
  try {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 2 * 86400; // 2 days back to ensure we get a reading
    const cmcRes = await fetch(`${CMC_FNG_URL}?start=${start}&end=${now}`);
    if (cmcRes.ok) {
      const j = await cmcRes.json();
      const list = j?.data?.dataList;
      if (list?.length) {
        const latest = list[list.length - 1];
        marketState.fearGreed = {
          value: parseInt(latest.score, 10),
          classification: latest.name || '',
        };
        fgUpdated = true;
        console.log('[Spectre] F&G (CMC):', marketState.fearGreed.value, marketState.fearGreed.classification);
      }
    }
  } catch (err) {
    console.warn('[Spectre] CMC F&G fetch failed:', err.message);
  }

  if (!fgUpdated) {
    try {
      const fgRes = await fetch('https://api.alternative.me/fng/?limit=1');
      if (fgRes.ok) {
        const fgData = await fgRes.json();
        if (fgData.data?.[0]) {
          marketState.fearGreed = {
            value: parseInt(fgData.data[0].value, 10),
            classification: fgData.data[0].value_classification,
          };
          console.log('[Spectre] F&G (alternative.me fallback):', marketState.fearGreed.value);
        }
      }
    } catch (err) {
      console.warn('[Spectre] Fear & Greed fallback failed:', err.message);
    }
  }

  // Calculate AI Pulse from F&G + market conditions
  marketState.aiPulse = calculateAIPulse(
    marketState.fearGreed.value,
    marketState.marketCapChange24h
  );
  marketState.updatedAt = Date.now();

  // Update extension icon badge
  updateIconBadge(marketState.aiPulse);
}

/**
 * Calculate AI Pulse state
 */
function calculateAIPulse(fgValue, marketChange) {
  if (fgValue <= 20 || marketChange <= -8) {
    return { state: 'RISK_OFF', label: 'Risk Off', color: '#EF4444', icon: '!' };
  }
  if (fgValue <= 35 || marketChange <= -5) {
    return { state: 'CAUTION', label: 'Caution', color: '#F59E0B', icon: '~' };
  }
  if (fgValue >= 80 && marketChange >= 5) {
    return { state: 'EUPHORIA', label: 'Euphoria', color: '#A78BFA', icon: '\u2191\u2191' };
  }
  if (fgValue >= 55 && marketChange >= 0) {
    return { state: 'RISK_ON', label: 'Risk On', color: '#10B981', icon: '\u2191' };
  }
  return { state: 'NEUTRAL', label: 'Neutral', color: '#F59E0B', icon: '-' };
}

/**
 * Update the extension toolbar icon badge based on market state
 */
function updateIconBadge(aiPulse) {
  try {
    switch (aiPulse.state) {
      case 'RISK_OFF':
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
        break;
      case 'CAUTION':
        chrome.action.setBadgeText({ text: '~' });
        chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
        break;
      case 'RISK_ON':
        chrome.action.setBadgeText({ text: '\u2191' });
        chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
        break;
      case 'EUPHORIA':
        chrome.action.setBadgeText({ text: '\u2191\u2191' });
        chrome.action.setBadgeBackgroundColor({ color: '#A78BFA' });
        break;
      default:
        chrome.action.setBadgeText({ text: '' });
        break;
    }
  } catch (err) {
    // Badge API may not be available in all contexts
  }
}
