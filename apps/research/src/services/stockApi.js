/**
 * Stock Market API Service
 * Provides stock quotes, search, OHLC data, and company info
 * Primary: Server proxy at localhost:3001/api/stocks/* (Yahoo Finance, no CORS)
 * Fallback: Direct CORS proxy chain → static FALLBACK_STOCK_DATA
 */
import { isDev } from '@/utils/env'

// Server proxy (primary - no CORS issues, cached, fast)
// In dev, Vite proxies /api to localhost:3001; in prod, use relative paths
const SERVER_BASE = ''

// Finnhub API (used only as CORS proxy fallback)
const FINNHUB_API_KEY = 'demo'
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'

// 2026-05-28 hide-apis: removed dead CORS_PROXIES array (was defined here but
// never referenced — leftover from an older fallback path). It listed
// api.allorigins.win + corsproxy.io which would otherwise need to stay in
// CSP connect-src. The serverFetch() path below already covers prod via
// /api/stocks/* and dev via the Vite -> Express proxy.

/**
 * Fetch with timeout helper
 */
function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id))
}

/**
 * Try server proxy first, then CORS proxies as fallback
 */
async function serverFetch(endpoint, timeoutMs = 6000) {
  // 1. Try server proxy. In dev, Vite proxies /api -> Express (localhost:3001)
  //    which proxies Yahoo; in prod, the relative path hits the serverless fn.
  //    (Previously returned null in dev, which forced stale fallback prices.)
  try {
    const res = await fetchWithTimeout(`${SERVER_BASE}${endpoint}`, {}, timeoutMs)
    if (res.ok) {
      const data = await res.json()
      if (data) return data
    }
  } catch (e) {
    // Server not running, fall through
  }
  return null
}

// Fallback stock data when all APIs fail (realistic market data - Feb 2026)
export const FALLBACK_STOCK_DATA = {
  'SPY': { symbol: 'SPY', name: 'SPDR S&P 500 ETF', price: 612.45, change: 0.82, marketCap: 565000000000, volume: 68500000, pe: null, sector: 'Index', exchange: 'NYSE' },
  'QQQ': { symbol: 'QQQ', name: 'Invesco QQQ Trust', price: 538.32, change: 1.15, marketCap: 265000000000, volume: 42300000, pe: null, sector: 'Index', exchange: 'NASDAQ' },
  'AAPL': { symbol: 'AAPL', name: 'Apple Inc.', price: 247.85, change: 1.24, marketCap: 3780000000000, volume: 52400000, pe: 32.2, sector: 'Technology', exchange: 'NASDAQ' },
  'MSFT': { symbol: 'MSFT', name: 'Microsoft Corp.', price: 482.18, change: 0.95, marketCap: 3580000000000, volume: 18200000, pe: 35.5, sector: 'Technology', exchange: 'NASDAQ' },
  'GOOGL': { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 198.92, change: 0.67, marketCap: 2450000000000, volume: 21500000, pe: 22.8, sector: 'Technology', exchange: 'NASDAQ' },
  'AMZN': { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 245.45, change: 1.85, marketCap: 2550000000000, volume: 35800000, pe: 38.1, sector: 'Consumer', exchange: 'NASDAQ' },
  'NVDA': { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 958.52, change: 2.34, marketCap: 2400000000000, volume: 245000000, pe: 55.2, sector: 'Semiconductor', exchange: 'NASDAQ' },
  'TSLA': { symbol: 'TSLA', name: 'Tesla Inc.', price: 412.15, change: -1.45, marketCap: 1350000000000, volume: 82000000, pe: 85.5, sector: 'Automotive', exchange: 'NASDAQ' },
  'META': { symbol: 'META', name: 'Meta Platforms', price: 632.78, change: 1.12, marketCap: 1620000000000, volume: 14500000, pe: 26.4, sector: 'Technology', exchange: 'NASDAQ' },
  'JPM': { symbol: 'JPM', name: 'JPMorgan Chase', price: 272.45, change: 0.45, marketCap: 785000000000, volume: 8200000, pe: 11.8, sector: 'Financial', exchange: 'NYSE' },
  'V': { symbol: 'V', name: 'Visa Inc.', price: 338.92, change: 0.78, marketCap: 622000000000, volume: 5800000, pe: 29.2, sector: 'Financial', exchange: 'NYSE' },
  'JNJ': { symbol: 'JNJ', name: 'Johnson & Johnson', price: 162.35, change: -0.32, marketCap: 392000000000, volume: 6500000, pe: 14.4, sector: 'Healthcare', exchange: 'NYSE' },
  'WMT': { symbol: 'WMT', name: 'Walmart Inc.', price: 102.45, change: 0.55, marketCap: 822000000000, volume: 12500000, pe: 38.8, sector: 'Consumer', exchange: 'NYSE' },
  'PG': { symbol: 'PG', name: 'Procter & Gamble', price: 178.25, change: 0.28, marketCap: 420000000000, volume: 5200000, pe: 26.5, sector: 'Consumer', exchange: 'NYSE' },
  'KO': { symbol: 'KO', name: 'Coca-Cola Co.', price: 62.45, change: 0.18, marketCap: 268000000000, volume: 12000000, pe: 25.2, sector: 'Consumer', exchange: 'NYSE' },
  'PEP': { symbol: 'PEP', name: 'PepsiCo Inc.', price: 158.85, change: -0.22, marketCap: 218000000000, volume: 5500000, pe: 23.8, sector: 'Consumer', exchange: 'NASDAQ' },
  'COST': { symbol: 'COST', name: 'Costco Wholesale', price: 912.45, change: 0.85, marketCap: 405000000000, volume: 1800000, pe: 55.2, sector: 'Consumer', exchange: 'NASDAQ' },
  'MCD': { symbol: 'MCD', name: 'McDonald\'s Corp.', price: 298.45, change: 0.32, marketCap: 215000000000, volume: 3200000, pe: 25.5, sector: 'Consumer', exchange: 'NYSE' },
  'NKE': { symbol: 'NKE', name: 'Nike Inc.', price: 78.25, change: -0.85, marketCap: 118000000000, volume: 8500000, pe: 28.2, sector: 'Consumer', exchange: 'NYSE' },
  'SBUX': { symbol: 'SBUX', name: 'Starbucks Corp.', price: 105.42, change: 0.45, marketCap: 120000000000, volume: 5200000, pe: 32.5, sector: 'Consumer', exchange: 'NASDAQ' },
  'UNH': { symbol: 'UNH', name: 'UnitedHealth Group', price: 525.62, change: -0.85, marketCap: 485000000000, volume: 3200000, pe: 17.2, sector: 'Healthcare', exchange: 'NYSE' },
  'PFE': { symbol: 'PFE', name: 'Pfizer Inc.', price: 28.45, change: -0.55, marketCap: 162000000000, volume: 28000000, pe: 12.5, sector: 'Healthcare', exchange: 'NYSE' },
  'ABBV': { symbol: 'ABBV', name: 'AbbVie Inc.', price: 185.25, change: 0.42, marketCap: 328000000000, volume: 5200000, pe: 15.8, sector: 'Healthcare', exchange: 'NYSE' },
  'MRK': { symbol: 'MRK', name: 'Merck & Co.', price: 112.45, change: 0.25, marketCap: 285000000000, volume: 8200000, pe: 14.2, sector: 'Healthcare', exchange: 'NYSE' },
  'LLY': { symbol: 'LLY', name: 'Eli Lilly & Co.', price: 825.42, change: -1.85, marketCap: 782000000000, volume: 3500000, pe: 120.5, sector: 'Healthcare', exchange: 'NYSE' },
  'HD': { symbol: 'HD', name: 'Home Depot', price: 432.85, change: 0.92, marketCap: 430000000000, volume: 3800000, pe: 24.4, sector: 'Consumer', exchange: 'NYSE' },
  'BAC': { symbol: 'BAC', name: 'Bank of America', price: 48.82, change: 0.65, marketCap: 382000000000, volume: 32000000, pe: 13.2, sector: 'Financial', exchange: 'NYSE' },
  'MS': { symbol: 'MS', name: 'Morgan Stanley', price: 108.25, change: 0.55, marketCap: 185000000000, volume: 6500000, pe: 14.5, sector: 'Financial', exchange: 'NYSE' },
  'C': { symbol: 'C', name: 'Citigroup Inc.', price: 72.45, change: 0.42, marketCap: 142000000000, volume: 12000000, pe: 10.8, sector: 'Financial', exchange: 'NYSE' },
  'WFC': { symbol: 'WFC', name: 'Wells Fargo & Co.', price: 68.25, change: 0.35, marketCap: 225000000000, volume: 15000000, pe: 12.2, sector: 'Financial', exchange: 'NYSE' },
  'XOM': { symbol: 'XOM', name: 'Exxon Mobil', price: 118.45, change: -0.42, marketCap: 528000000000, volume: 14500000, pe: 13.8, sector: 'Energy', exchange: 'NYSE' },
  'CVX': { symbol: 'CVX', name: 'Chevron Corp.', price: 158.25, change: 0.35, marketCap: 298000000000, volume: 6200000, pe: 12.5, sector: 'Energy', exchange: 'NYSE' },
  'COP': { symbol: 'COP', name: 'ConocoPhillips', price: 112.85, change: -0.25, marketCap: 135000000000, volume: 5500000, pe: 11.8, sector: 'Energy', exchange: 'NYSE' },
  'DIS': { symbol: 'DIS', name: 'Walt Disney Co.', price: 122.35, change: 1.25, marketCap: 225000000000, volume: 8500000, pe: 45.4, sector: 'Communication', exchange: 'NYSE' },
  'VZ': { symbol: 'VZ', name: 'Verizon Communications', price: 42.85, change: 0.15, marketCap: 180000000000, volume: 15000000, pe: 9.5, sector: 'Communication', exchange: 'NYSE' },
  'T': { symbol: 'T', name: 'AT&T Inc.', price: 22.45, change: -0.12, marketCap: 160000000000, volume: 28000000, pe: 8.8, sector: 'Communication', exchange: 'NYSE' },
  'NFLX': { symbol: 'NFLX', name: 'Netflix Inc.', price: 942.45, change: 2.15, marketCap: 408000000000, volume: 4200000, pe: 42.2, sector: 'Communication', exchange: 'NASDAQ' },
  // Industrial
  'BA': { symbol: 'BA', name: 'Boeing Co.', price: 178.25, change: -1.25, marketCap: 108000000000, volume: 8500000, pe: null, sector: 'Industrial', exchange: 'NYSE' },
  'CAT': { symbol: 'CAT', name: 'Caterpillar Inc.', price: 372.45, change: 0.65, marketCap: 185000000000, volume: 2800000, pe: 17.2, sector: 'Industrial', exchange: 'NYSE' },
  'GE': { symbol: 'GE', name: 'GE Aerospace', price: 188.25, change: 0.85, marketCap: 205000000000, volume: 4200000, pe: 42.5, sector: 'Industrial', exchange: 'NYSE' },
  'UPS': { symbol: 'UPS', name: 'United Parcel Service', price: 138.45, change: -0.45, marketCap: 118000000000, volume: 3200000, pe: 16.8, sector: 'Industrial', exchange: 'NYSE' },
  'HON': { symbol: 'HON', name: 'Honeywell International', price: 212.85, change: 0.35, marketCap: 142000000000, volume: 2500000, pe: 22.5, sector: 'Industrial', exchange: 'NASDAQ' },
  // ── Commodity Futures (actual spot/futures contracts) ──
  'GC=F': { symbol: 'GC=F', name: 'Gold Futures', price: 5114.0, change: -1.3, marketCap: 0, volume: 185000, pe: null, sector: 'Commodity', exchange: 'COMEX' },
  'SI=F': { symbol: 'SI=F', name: 'Silver Futures', price: 87.33, change: 1.5, marketCap: 0, volume: 62000, pe: null, sector: 'Commodity', exchange: 'COMEX' },
  'CL=F': { symbol: 'CL=F', name: 'Crude Oil WTI', price: 68.25, change: -0.8, marketCap: 0, volume: 520000, pe: null, sector: 'Commodity', exchange: 'NYMEX' },
  'NG=F': { symbol: 'NG=F', name: 'Natural Gas', price: 4.12, change: 2.3, marketCap: 0, volume: 310000, pe: null, sector: 'Commodity', exchange: 'NYMEX' },
  'HG=F': { symbol: 'HG=F', name: 'Copper Futures', price: 4.85, change: 0.6, marketCap: 0, volume: 48000, pe: null, sector: 'Commodity', exchange: 'COMEX' },
  'PL=F': { symbol: 'PL=F', name: 'Platinum Futures', price: 1025.0, change: -0.3, marketCap: 0, volume: 18000, pe: null, sector: 'Commodity', exchange: 'NYMEX' },
  'PA=F': { symbol: 'PA=F', name: 'Palladium Futures', price: 985.0, change: -0.9, marketCap: 0, volume: 5200, pe: null, sector: 'Commodity', exchange: 'NYMEX' },
  // ETFs extra
  'DIA': { symbol: 'DIA', name: 'SPDR Dow Jones ETF', price: 435.85, change: 0.42, marketCap: 38000000000, volume: 3200000, pe: null, sector: 'Index', exchange: 'NYSE' },
  'VOO': { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', price: 565.42, change: 0.55, marketCap: 480000000000, volume: 4500000, pe: null, sector: 'Index', exchange: 'NYSE' },
  'SLV': { symbol: 'SLV', name: 'iShares Silver Trust', price: 28.85, change: 0.82, marketCap: 12000000000, volume: 22000000, pe: null, sector: 'Commodity', exchange: 'NYSE' },
  // Semiconductors
  'AMD': { symbol: 'AMD', name: 'Advanced Micro Devices', price: 178.45, change: 1.85, marketCap: 288000000000, volume: 42000000, pe: 48.2, sector: 'Semiconductor', exchange: 'NASDAQ' },
  'INTC': { symbol: 'INTC', name: 'Intel Corp.', price: 32.15, change: -0.95, marketCap: 136000000000, volume: 38000000, pe: 125.0, sector: 'Semiconductor', exchange: 'NASDAQ' },
  'AVGO': { symbol: 'AVGO', name: 'Broadcom Inc.', price: 185.42, change: 1.42, marketCap: 860000000000, volume: 12000000, pe: 38.5, sector: 'Semiconductor', exchange: 'NASDAQ' },
  'QCOM': { symbol: 'QCOM', name: 'Qualcomm Inc.', price: 172.85, change: 0.95, marketCap: 192000000000, volume: 6500000, pe: 18.2, sector: 'Semiconductor', exchange: 'NASDAQ' },
  'TSM': { symbol: 'TSM', name: 'Taiwan Semiconductor', price: 192.35, change: 1.65, marketCap: 998000000000, volume: 15000000, pe: 28.4, sector: 'Semiconductor', exchange: 'NYSE' },
  'MU': { symbol: 'MU', name: 'Micron Technology', price: 108.25, change: 2.15, marketCap: 120000000000, volume: 18000000, pe: 22.5, sector: 'Semiconductor', exchange: 'NASDAQ' },
  'MRVL': { symbol: 'MRVL', name: 'Marvell Technology', price: 88.45, change: 1.32, marketCap: 76000000000, volume: 8500000, pe: 65.2, sector: 'Semiconductor', exchange: 'NASDAQ' },
  'ON': { symbol: 'ON', name: 'ON Semiconductor', price: 72.35, change: -0.85, marketCap: 31000000000, volume: 5200000, pe: 19.8, sector: 'Semiconductor', exchange: 'NASDAQ' },
  'LRCX': { symbol: 'LRCX', name: 'Lam Research', price: 92.45, change: 0.78, marketCap: 121000000000, volume: 2800000, pe: 25.4, sector: 'Semiconductor', exchange: 'NASDAQ' },
  'AMAT': { symbol: 'AMAT', name: 'Applied Materials', price: 198.35, change: 1.15, marketCap: 165000000000, volume: 5500000, pe: 22.8, sector: 'Semiconductor', exchange: 'NASDAQ' },
  'KLAC': { symbol: 'KLAC', name: 'KLA Corporation', price: 742.15, change: 0.92, marketCap: 100000000000, volume: 1200000, pe: 28.2, sector: 'Semiconductor', exchange: 'NASDAQ' },
  'ARM': { symbol: 'ARM', name: 'Arm Holdings', price: 168.45, change: 2.85, marketCap: 175000000000, volume: 8200000, pe: 95.4, sector: 'Semiconductor', exchange: 'NASDAQ' },
  // Software & Cloud
  'CRM': { symbol: 'CRM', name: 'Salesforce Inc.', price: 342.78, change: 0.92, marketCap: 332000000000, volume: 5200000, pe: 52.4, sector: 'Technology', exchange: 'NYSE' },
  'ADBE': { symbol: 'ADBE', name: 'Adobe Inc.', price: 542.35, change: 0.45, marketCap: 242000000000, volume: 2800000, pe: 42.8, sector: 'Technology', exchange: 'NASDAQ' },
  'ORCL': { symbol: 'ORCL', name: 'Oracle Corp.', price: 182.45, change: 0.68, marketCap: 505000000000, volume: 8500000, pe: 38.2, sector: 'Technology', exchange: 'NYSE' },
  'NOW': { symbol: 'NOW', name: 'ServiceNow Inc.', price: 892.45, change: 1.25, marketCap: 178000000000, volume: 1500000, pe: 68.5, sector: 'Technology', exchange: 'NYSE' },
  'SNOW': { symbol: 'SNOW', name: 'Snowflake Inc.', price: 178.92, change: -0.85, marketCap: 58000000000, volume: 4200000, pe: null, sector: 'Technology', exchange: 'NYSE' },
  'PLTR': { symbol: 'PLTR', name: 'Palantir Technologies', price: 82.45, change: 3.42, marketCap: 188000000000, volume: 52000000, pe: 200.0, sector: 'Technology', exchange: 'NMS' },
  'PANW': { symbol: 'PANW', name: 'Palo Alto Networks', price: 392.15, change: 1.05, marketCap: 128000000000, volume: 3200000, pe: 52.4, sector: 'Technology', exchange: 'NASDAQ' },
  'CRWD': { symbol: 'CRWD', name: 'CrowdStrike Holdings', price: 345.85, change: 1.82, marketCap: 84000000000, volume: 3800000, pe: 85.2, sector: 'Technology', exchange: 'NASDAQ' },
  'SHOP': { symbol: 'SHOP', name: 'Shopify Inc.', price: 112.45, change: 2.15, marketCap: 145000000000, volume: 8500000, pe: 72.5, sector: 'Technology', exchange: 'NYSE' },
  'SQ': { symbol: 'SQ', name: 'Block Inc.', price: 78.92, change: 1.85, marketCap: 48000000000, volume: 6200000, pe: 42.8, sector: 'Technology', exchange: 'NYSE' },
  'UBER': { symbol: 'UBER', name: 'Uber Technologies', price: 78.25, change: 0.95, marketCap: 162000000000, volume: 18000000, pe: 125.0, sector: 'Technology', exchange: 'NYSE' },
  'SPOT': { symbol: 'SPOT', name: 'Spotify Technology', price: 512.85, change: 1.45, marketCap: 102000000000, volume: 2200000, pe: 95.2, sector: 'Technology', exchange: 'NYSE' },
  'ABNB': { symbol: 'ABNB', name: 'Airbnb Inc.', price: 158.42, change: 0.72, marketCap: 102000000000, volume: 4200000, pe: 35.8, sector: 'Technology', exchange: 'NASDAQ' },
  'NET': { symbol: 'NET', name: 'Cloudflare Inc.', price: 112.35, change: 2.25, marketCap: 38000000000, volume: 5200000, pe: null, sector: 'Technology', exchange: 'NYSE' },
  'DDOG': { symbol: 'DDOG', name: 'Datadog Inc.', price: 142.45, change: 1.05, marketCap: 46000000000, volume: 3800000, pe: 250.0, sector: 'Technology', exchange: 'NASDAQ' },
  'ZS': { symbol: 'ZS', name: 'Zscaler Inc.', price: 225.85, change: 0.85, marketCap: 32000000000, volume: 1800000, pe: null, sector: 'Technology', exchange: 'NASDAQ' },
  'MSTR': { symbol: 'MSTR', name: 'MicroStrategy Inc.', price: 342.15, change: 4.85, marketCap: 68000000000, volume: 22000000, pe: null, sector: 'Technology', exchange: 'NASDAQ' },
  // Financial
  'PYPL': { symbol: 'PYPL', name: 'PayPal Holdings', price: 82.35, change: 1.42, marketCap: 88000000000, volume: 12500000, pe: 22.4, sector: 'Financial', exchange: 'NASDAQ' },
  'MA': { symbol: 'MA', name: 'Mastercard Inc.', price: 528.92, change: 0.85, marketCap: 492000000000, volume: 2800000, pe: 38.2, sector: 'Financial', exchange: 'NYSE' },
  'GS': { symbol: 'GS', name: 'Goldman Sachs', price: 582.45, change: 0.72, marketCap: 185000000000, volume: 2200000, pe: 16.8, sector: 'Financial', exchange: 'NYSE' },
  'COIN': { symbol: 'COIN', name: 'Coinbase Global', price: 285.32, change: 3.85, marketCap: 72000000000, volume: 8500000, pe: 42.5, sector: 'Financial', exchange: 'NASDAQ' },
  'SCHW': { symbol: 'SCHW', name: 'Charles Schwab', price: 82.45, change: 0.52, marketCap: 152000000000, volume: 6800000, pe: 25.5, sector: 'Financial', exchange: 'NYSE' },
  'BLK': { symbol: 'BLK', name: 'BlackRock Inc.', price: 982.35, change: 0.65, marketCap: 148000000000, volume: 520000, pe: 22.8, sector: 'Financial', exchange: 'NYSE' },
  'AXP': { symbol: 'AXP', name: 'American Express', price: 292.45, change: 0.82, marketCap: 210000000000, volume: 2500000, pe: 20.5, sector: 'Financial', exchange: 'NYSE' },
  'HOOD': { symbol: 'HOOD', name: 'Robinhood Markets', price: 48.25, change: 2.85, marketCap: 42000000000, volume: 28000000, pe: 85.2, sector: 'Financial', exchange: 'NASDAQ' },
  'SOFI': { symbol: 'SOFI', name: 'SoFi Technologies', price: 15.85, change: 1.92, marketCap: 17000000000, volume: 32000000, pe: null, sector: 'Financial', exchange: 'NASDAQ' },
  // Communication
  'CMCSA': { symbol: 'CMCSA', name: 'Comcast Corp.', price: 42.85, change: -0.35, marketCap: 165000000000, volume: 18000000, pe: 11.5, sector: 'Communication', exchange: 'NASDAQ' },
  'TMUS': { symbol: 'TMUS', name: 'T-Mobile US', price: 215.42, change: 0.45, marketCap: 252000000000, volume: 3500000, pe: 25.2, sector: 'Communication', exchange: 'NASDAQ' },
  'ROKU': { symbol: 'ROKU', name: 'Roku Inc.', price: 82.15, change: 1.95, marketCap: 12000000000, volume: 4800000, pe: null, sector: 'Communication', exchange: 'NASDAQ' },
  'WBD': { symbol: 'WBD', name: 'Warner Bros. Discovery', price: 12.45, change: -1.25, marketCap: 30000000000, volume: 22000000, pe: null, sector: 'Communication', exchange: 'NASDAQ' },
  // Healthcare extra
  'TMO': { symbol: 'TMO', name: 'Thermo Fisher Scientific', price: 585.42, change: 0.42, marketCap: 225000000000, volume: 1200000, pe: 32.5, sector: 'Healthcare', exchange: 'NYSE' },
  'BMY': { symbol: 'BMY', name: 'Bristol-Myers Squibb', price: 52.85, change: -0.65, marketCap: 108000000000, volume: 12000000, pe: 8.5, sector: 'Healthcare', exchange: 'NYSE' },
  'AMGN': { symbol: 'AMGN', name: 'Amgen Inc.', price: 295.42, change: 0.35, marketCap: 158000000000, volume: 2800000, pe: 22.4, sector: 'Healthcare', exchange: 'NASDAQ' },
  'GILD': { symbol: 'GILD', name: 'Gilead Sciences', price: 98.25, change: 0.55, marketCap: 122000000000, volume: 5200000, pe: 12.8, sector: 'Healthcare', exchange: 'NASDAQ' },
  'ISRG': { symbol: 'ISRG', name: 'Intuitive Surgical', price: 542.85, change: 1.15, marketCap: 192000000000, volume: 1500000, pe: 72.5, sector: 'Healthcare', exchange: 'NASDAQ' },
  'MRNA': { symbol: 'MRNA', name: 'Moderna Inc.', price: 42.15, change: -2.45, marketCap: 16000000000, volume: 8500000, pe: null, sector: 'Healthcare', exchange: 'NASDAQ' },
  // Consumer extra
  'TGT': { symbol: 'TGT', name: 'Target Corp.', price: 148.25, change: 0.45, marketCap: 68000000000, volume: 4200000, pe: 15.2, sector: 'Consumer', exchange: 'NYSE' },
  'LOW': { symbol: 'LOW', name: 'Lowe\'s Companies', price: 268.42, change: 0.72, marketCap: 155000000000, volume: 2800000, pe: 18.5, sector: 'Consumer', exchange: 'NYSE' },
  'EL': { symbol: 'EL', name: 'Estee Lauder', price: 85.42, change: -1.25, marketCap: 30000000000, volume: 2500000, pe: 45.2, sector: 'Consumer', exchange: 'NYSE' },
  'CMG': { symbol: 'CMG', name: 'Chipotle Mexican Grill', price: 62.85, change: 0.95, marketCap: 86000000000, volume: 5200000, pe: 58.5, sector: 'Consumer', exchange: 'NYSE' },
  'LULU': { symbol: 'LULU', name: 'Lululemon Athletica', price: 392.45, change: 1.05, marketCap: 48000000000, volume: 1500000, pe: 28.4, sector: 'Consumer', exchange: 'NASDAQ' },
  // Energy extra
  'SLB': { symbol: 'SLB', name: 'Schlumberger Ltd.', price: 52.85, change: -0.45, marketCap: 75000000000, volume: 8200000, pe: 15.2, sector: 'Energy', exchange: 'NYSE' },
  'EOG': { symbol: 'EOG', name: 'EOG Resources', price: 128.45, change: 0.35, marketCap: 74000000000, volume: 3200000, pe: 10.5, sector: 'Energy', exchange: 'NYSE' },
  'OXY': { symbol: 'OXY', name: 'Occidental Petroleum', price: 58.25, change: -0.82, marketCap: 52000000000, volume: 12000000, pe: 12.8, sector: 'Energy', exchange: 'NYSE' },
  'MPC': { symbol: 'MPC', name: 'Marathon Petroleum', price: 165.42, change: 0.55, marketCap: 58000000000, volume: 3500000, pe: 8.5, sector: 'Energy', exchange: 'NYSE' },
  'PSX': { symbol: 'PSX', name: 'Phillips 66', price: 142.85, change: 0.42, marketCap: 58000000000, volume: 2800000, pe: 12.2, sector: 'Energy', exchange: 'NYSE' },
  // Industrial extra
  'RTX': { symbol: 'RTX', name: 'RTX Corporation', price: 125.42, change: 0.35, marketCap: 168000000000, volume: 4500000, pe: 38.5, sector: 'Industrial', exchange: 'NYSE' },
  'LMT': { symbol: 'LMT', name: 'Lockheed Martin', price: 485.85, change: 0.52, marketCap: 118000000000, volume: 1200000, pe: 17.2, sector: 'Industrial', exchange: 'NYSE' },
  'NOC': { symbol: 'NOC', name: 'Northrop Grumman', price: 512.45, change: 0.28, marketCap: 72000000000, volume: 800000, pe: 18.5, sector: 'Industrial', exchange: 'NYSE' },
  'DE': { symbol: 'DE', name: 'Deere & Company', price: 418.25, change: 0.65, marketCap: 122000000000, volume: 1500000, pe: 14.8, sector: 'Industrial', exchange: 'NYSE' },
  'MMM': { symbol: 'MMM', name: '3M Company', price: 135.42, change: -0.45, marketCap: 74000000000, volume: 3200000, pe: 15.5, sector: 'Industrial', exchange: 'NYSE' },
  'FDX': { symbol: 'FDX', name: 'FedEx Corp.', price: 285.85, change: 0.82, marketCap: 72000000000, volume: 1800000, pe: 16.2, sector: 'Industrial', exchange: 'NYSE' },
  'GD': { symbol: 'GD', name: 'General Dynamics', price: 298.45, change: 0.42, marketCap: 82000000000, volume: 1200000, pe: 19.5, sector: 'Industrial', exchange: 'NYSE' },
  // Real Estate
  'AMT': { symbol: 'AMT', name: 'American Tower Corp.', price: 215.42, change: 0.25, marketCap: 100000000000, volume: 2200000, pe: 42.5, sector: 'RealEstate', exchange: 'NYSE' },
  'PLD': { symbol: 'PLD', name: 'Prologis Inc.', price: 128.85, change: 0.35, marketCap: 118000000000, volume: 3200000, pe: 48.2, sector: 'RealEstate', exchange: 'NYSE' },
  'CCI': { symbol: 'CCI', name: 'Crown Castle Inc.', price: 105.42, change: -0.45, marketCap: 45000000000, volume: 2500000, pe: 35.8, sector: 'RealEstate', exchange: 'NYSE' },
  'EQIX': { symbol: 'EQIX', name: 'Equinix Inc.', price: 892.45, change: 0.55, marketCap: 82000000000, volume: 500000, pe: 85.2, sector: 'RealEstate', exchange: 'NASDAQ' },
  'O': { symbol: 'O', name: 'Realty Income Corp.', price: 58.25, change: 0.15, marketCap: 52000000000, volume: 4200000, pe: 52.4, sector: 'RealEstate', exchange: 'NYSE' },
  'SPG': { symbol: 'SPG', name: 'Simon Property Group', price: 168.45, change: 0.42, marketCap: 55000000000, volume: 1500000, pe: 22.5, sector: 'RealEstate', exchange: 'NYSE' },
  // Automotive
  'F': { symbol: 'F', name: 'Ford Motor Co.', price: 11.85, change: -0.75, marketCap: 47000000000, volume: 42000000, pe: 12.5, sector: 'Automotive', exchange: 'NYSE' },
  'GM': { symbol: 'GM', name: 'General Motors', price: 52.45, change: 0.45, marketCap: 58000000000, volume: 8500000, pe: 5.8, sector: 'Automotive', exchange: 'NYSE' },
  'RIVN': { symbol: 'RIVN', name: 'Rivian Automotive', price: 18.25, change: -2.85, marketCap: 18000000000, volume: 22000000, pe: null, sector: 'Automotive', exchange: 'NASDAQ' },
  'LCID': { symbol: 'LCID', name: 'Lucid Group', price: 3.45, change: -3.25, marketCap: 8000000000, volume: 28000000, pe: null, sector: 'Automotive', exchange: 'NASDAQ' },
  'TM': { symbol: 'TM', name: 'Toyota Motor Corp.', price: 192.85, change: 0.35, marketCap: 285000000000, volume: 500000, pe: 8.5, sector: 'Automotive', exchange: 'NYSE' },
  // ETFs extra
  'GLD': { symbol: 'GLD', name: 'SPDR Gold Trust', price: 242.85, change: 0.32, marketCap: 72000000000, volume: 8200000, pe: null, sector: 'Commodity', exchange: 'NYSE' },
  'IWM': { symbol: 'IWM', name: 'iShares Russell 2000', price: 228.45, change: 0.95, marketCap: 72000000000, volume: 28000000, pe: null, sector: 'Index', exchange: 'NYSE' },
  'VTI': { symbol: 'VTI', name: 'Vanguard Total Stock Market', price: 292.45, change: 0.72, marketCap: 420000000000, volume: 3200000, pe: null, sector: 'Index', exchange: 'NYSE' },
  'ARKK': { symbol: 'ARKK', name: 'ARK Innovation ETF', price: 52.85, change: 2.45, marketCap: 8000000000, volume: 18000000, pe: null, sector: 'Index', exchange: 'NYSE' },
  'XLF': { symbol: 'XLF', name: 'Financial Select Sector SPDR', price: 48.25, change: 0.55, marketCap: 42000000000, volume: 32000000, pe: null, sector: 'Index', exchange: 'NYSE' },
  'XLE': { symbol: 'XLE', name: 'Energy Select Sector SPDR', price: 92.45, change: -0.35, marketCap: 38000000000, volume: 15000000, pe: null, sector: 'Index', exchange: 'NYSE' },
  'XLK': { symbol: 'XLK', name: 'Technology Select Sector SPDR', price: 228.42, change: 1.15, marketCap: 68000000000, volume: 8500000, pe: null, sector: 'Index', exchange: 'NYSE' },
  'USO': { symbol: 'USO', name: 'United States Oil Fund', price: 72.85, change: -0.85, marketCap: 3000000000, volume: 5200000, pe: null, sector: 'Commodity', exchange: 'NYSE' },
  // Commodity extra
  'COPX': { symbol: 'COPX', name: 'Global X Copper Miners ETF', price: 42.15, change: 1.25, marketCap: 2800000000, volume: 3200000, pe: null, sector: 'Commodity', exchange: 'NYSE' },
  'WEAT': { symbol: 'WEAT', name: 'Teucrium Wheat Fund', price: 5.85, change: -0.42, marketCap: 180000000, volume: 1200000, pe: null, sector: 'Commodity', exchange: 'NYSE' },
  'UNG': { symbol: 'UNG', name: 'United States Natural Gas', price: 12.42, change: 2.15, marketCap: 650000000, volume: 8500000, pe: null, sector: 'Commodity', exchange: 'NYSE' },
  'DBA': { symbol: 'DBA', name: 'Invesco DB Agriculture', price: 25.85, change: 0.32, marketCap: 950000000, volume: 620000, pe: null, sector: 'Commodity', exchange: 'NYSE' },
  'CORN': { symbol: 'CORN', name: 'Teucrium Corn Fund', price: 22.45, change: -0.55, marketCap: 150000000, volume: 350000, pe: null, sector: 'Commodity', exchange: 'NYSE' },
  'PPLT': { symbol: 'PPLT', name: 'Aberdeen Platinum ETF', price: 88.25, change: 0.82, marketCap: 850000000, volume: 45000, pe: null, sector: 'Commodity', exchange: 'NYSE' },
  'PALL': { symbol: 'PALL', name: 'Aberdeen Palladium ETF', price: 92.45, change: -1.15, marketCap: 320000000, volume: 22000, pe: null, sector: 'Commodity', exchange: 'NYSE' },
  // Communication extra
  'PARA': { symbol: 'PARA', name: 'Paramount Global', price: 11.85, change: -1.55, marketCap: 8000000000, volume: 18000000, pe: 8.5, sector: 'Communication', exchange: 'NASDAQ' },
  'CHTR': { symbol: 'CHTR', name: 'Charter Communications', price: 352.45, change: 0.65, marketCap: 52000000000, volume: 1200000, pe: 11.2, sector: 'Communication', exchange: 'NASDAQ' },
  'SNAP': { symbol: 'SNAP', name: 'Snap Inc.', price: 12.85, change: 2.45, marketCap: 21000000000, volume: 22000000, pe: null, sector: 'Communication', exchange: 'NYSE' },
  'PINS': { symbol: 'PINS', name: 'Pinterest Inc.', price: 35.42, change: 1.15, marketCap: 24000000000, volume: 8500000, pe: 35.2, sector: 'Communication', exchange: 'NYSE' },
  'TTD': { symbol: 'TTD', name: 'The Trade Desk', price: 108.25, change: 1.85, marketCap: 52000000000, volume: 4200000, pe: 185.5, sector: 'Communication', exchange: 'NASDAQ' },
  'RBLX': { symbol: 'RBLX', name: 'Roblox Corp.', price: 62.45, change: 2.25, marketCap: 38000000000, volume: 12000000, pe: null, sector: 'Communication', exchange: 'NYSE' },
  // Energy extra
  'VLO': { symbol: 'VLO', name: 'Valero Energy', price: 142.85, change: 0.75, marketCap: 48000000000, volume: 3200000, pe: 5.8, sector: 'Energy', exchange: 'NYSE' },
  'HAL': { symbol: 'HAL', name: 'Halliburton Co.', price: 32.45, change: -0.85, marketCap: 28000000000, volume: 8500000, pe: 11.2, sector: 'Energy', exchange: 'NYSE' },
  'DVN': { symbol: 'DVN', name: 'Devon Energy', price: 42.85, change: -0.55, marketCap: 28000000000, volume: 8200000, pe: 7.5, sector: 'Energy', exchange: 'NYSE' },
  'FANG': { symbol: 'FANG', name: 'Diamondback Energy', price: 178.25, change: 0.95, marketCap: 32000000000, volume: 2200000, pe: 9.8, sector: 'Energy', exchange: 'NASDAQ' },
  'BKR': { symbol: 'BKR', name: 'Baker Hughes Co.', price: 38.85, change: 0.45, marketCap: 38000000000, volume: 5200000, pe: 18.5, sector: 'Energy', exchange: 'NASDAQ' },
  'WMB': { symbol: 'WMB', name: 'Williams Companies', price: 52.45, change: 0.35, marketCap: 62000000000, volume: 5800000, pe: 35.2, sector: 'Energy', exchange: 'NYSE' },
  // RealEstate extra
  'WELL': { symbol: 'WELL', name: 'Welltower Inc.', price: 128.45, change: 0.42, marketCap: 72000000000, volume: 2200000, pe: 125.5, sector: 'RealEstate', exchange: 'NYSE' },
  'DLR': { symbol: 'DLR', name: 'Digital Realty Trust', price: 172.85, change: 0.55, marketCap: 55000000000, volume: 1800000, pe: 82.5, sector: 'RealEstate', exchange: 'NYSE' },
  'PSA': { symbol: 'PSA', name: 'Public Storage', price: 312.45, change: 0.25, marketCap: 55000000000, volume: 800000, pe: 32.5, sector: 'RealEstate', exchange: 'NYSE' },
  'VNQ': { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', price: 88.25, change: 0.32, marketCap: 32000000000, volume: 4500000, pe: null, sector: 'RealEstate', exchange: 'NYSE' },
  'SBAC': { symbol: 'SBAC', name: 'SBA Communications', price: 225.85, change: -0.35, marketCap: 24000000000, volume: 1200000, pe: 48.5, sector: 'RealEstate', exchange: 'NASDAQ' },
  'AVB': { symbol: 'AVB', name: 'AvalonBay Communities', price: 218.45, change: 0.45, marketCap: 30000000000, volume: 600000, pe: 22.8, sector: 'RealEstate', exchange: 'NYSE' },
  // Automotive extra
  'STLA': { symbol: 'STLA', name: 'Stellantis N.V.', price: 12.85, change: -1.85, marketCap: 38000000000, volume: 8500000, pe: 3.2, sector: 'Automotive', exchange: 'NYSE' },
  'LI': { symbol: 'LI', name: 'Li Auto Inc.', price: 28.45, change: 2.45, marketCap: 32000000000, volume: 12000000, pe: 22.5, sector: 'Automotive', exchange: 'NASDAQ' },
  'NIO': { symbol: 'NIO', name: 'NIO Inc.', price: 5.85, change: -2.15, marketCap: 12000000000, volume: 42000000, pe: null, sector: 'Automotive', exchange: 'NYSE' },
  'XPEV': { symbol: 'XPEV', name: 'XPeng Inc.', price: 18.25, change: 3.15, marketCap: 16000000000, volume: 15000000, pe: null, sector: 'Automotive', exchange: 'NYSE' },
  'RACE': { symbol: 'RACE', name: 'Ferrari N.V.', price: 428.85, change: 0.55, marketCap: 82000000000, volume: 280000, pe: 52.5, sector: 'Automotive', exchange: 'NYSE' },
  'APTV': { symbol: 'APTV', name: 'Aptiv PLC', price: 68.45, change: -0.95, marketCap: 18000000000, volume: 3200000, pe: 42.5, sector: 'Automotive', exchange: 'NYSE' },
}

// FALLBACK_STOCK_DATA is METADATA-ONLY (name / sector / exchange + logo lookups).
// Its numeric fields were stale & fabricated (e.g. pre-split NVDA $958 vs the real
// ~$220) and must NEVER be displayed — strip them at module load so prices and
// market caps come ONLY from live data. Any consumer that reads fb.price/marketCap/
// change/volume/pe now gets `undefined` and must render a loading/empty state.
for (const _entry of Object.values(FALLBACK_STOCK_DATA)) {
  delete _entry.price
  delete _entry.change
  delete _entry.marketCap
  delete _entry.volume
  delete _entry.pe
}

/**
 * Get real-time quotes for multiple stock symbols
 * Primary: server proxy → fallback: static data
 * @param {string[]} symbols - Array of stock symbols (e.g., ['AAPL', 'MSFT'])
 * @returns {Promise<Record<string, StockQuote>>}
 */
// Client cache + in-flight dedup for stock quotes. The server already caches
// (30s TTL), but gm-dashboard and categories each fire getStockQuotes twice on
// mount (init + first poll tick) and concurrent widgets double-fire — without a
// client layer every one was a separate round-trip. Keyed by the sorted symbol
// set so callers in any order share a cache entry. A short LS snapshot is the
// fallback when the server returns empty (market closed / cold serverless), so
// surfaces show last-known prices instead of flashing empty.
const _quoteCache = new Map()    // key -> { data, ts }
const _quoteInflight = new Map() // key -> Promise
const QUOTE_TTL = 25_000
const QUOTE_LS_PREFIX = 'spectre-stockq-v1:'
const QUOTE_LS_TTL = 6 * 60 * 60 * 1000 // 6h - just a last-known fallback, revalidated on every call

function _quoteLsLoad(key) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`${QUOTE_LS_PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number') return null
    if (Date.now() - parsed.ts > QUOTE_LS_TTL) return null
    return parsed.data
  } catch {
    return null
  }
}

function _quoteLsSave(key, data) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`${QUOTE_LS_PREFIX}${key}`, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    // quota exceeded / private mode - silently ignore
  }
}

export async function getStockQuotes(symbols) {
  if (!symbols || symbols.length === 0) return {}

  const key = [...symbols].sort().join(',')

  const cached = _quoteCache.get(key)
  if (cached && Date.now() - cached.ts < QUOTE_TTL) return cached.data
  if (_quoteInflight.has(key)) return _quoteInflight.get(key)

  const symbolsStr = symbols.join(',')
  const promise = (async () => {
    // 1. Try server proxy (fast, cached, no CORS). Big batches (the heatmap
    // asks for ~350 symbols) can take 6-8s cold from Yahoo, so allow 15s —
    // the default 6s was timing out and dropping the whole stock heatmap to
    // an empty snapshot.
    try {
      const data = await serverFetch(`/api/stocks/quotes?symbols=${encodeURIComponent(symbolsStr)}`, 15000)
      if (data && Object.keys(data).length > 0) {
        _quoteCache.set(key, { data, ts: Date.now() })
        _quoteLsSave(key, data)
        return data
      }
    } catch (err) {
      // silently handled
    }

    // 2. No live data — fall back to a recent LS snapshot so the surface keeps
    // its last-known prices rather than flashing empty. We never fabricate
    // prices (that once showed a stale pre-split NVDA ~$958 vs the real ~$220);
    // the snapshot is always real data we previously fetched, capped at 6h.
    return _quoteLsLoad(key) || {}
  })().finally(() => { _quoteInflight.delete(key) })

  _quoteInflight.set(key, promise)
  return promise
}

/**
 * Get single stock quote
 */
export async function getStockQuote(symbol) {
  const quotes = await getStockQuotes([symbol])
  return quotes[symbol] || null
}

/** Hardcoded logo overrides — local assets for tickers where CDN logo is wrong or missing */
const HARDCODED_LOGOS = {
  PLTR: '/stock-logos/PLTR.svg',
}

/**
 * Get stock logo URL for a given ticker symbol.
 * Priority: hardcoded local → FMP CDN (proper icon logos, 250×250 PNG).
 */
export function getStockLogoUrl(symbol) {
  if (!symbol) return null
  const upper = symbol.toUpperCase()
  if (HARDCODED_LOGOS[upper]) return HARDCODED_LOGOS[upper]
  return `https://financialmodelingprep.com/image-stock/${upper}.png`
}

/** Fallback logo URL when primary CDN fails (CompaniesMarketCap, 256×256 webp) */
export function getStockLogoFallback(symbol) {
  if (!symbol) return null
  const mapped = { GOOGL: 'GOOG', 'BRK.B': 'BRK-B' }[symbol.toUpperCase()] || symbol.toUpperCase()
  return `https://companiesmarketcap.com/img/company-logos/256/${mapped}.webp`
}

// Popular stocks for search fallback (comprehensive list - 150+ stocks)
export const POPULAR_STOCKS = [
  // ═══ ETFs & Index Funds ═══
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF', exchange: 'NYSE', sector: 'Index' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', type: 'ETF', exchange: 'NASDAQ', sector: 'Index' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', type: 'ETF', exchange: 'NYSE', sector: 'Index' },
  { symbol: 'DIA', name: 'SPDR Dow Jones ETF', type: 'ETF', exchange: 'NYSE', sector: 'Index' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', type: 'ETF', exchange: 'NYSE', sector: 'Index' },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market', type: 'ETF', exchange: 'NYSE', sector: 'Index' },
  { symbol: 'ARKK', name: 'ARK Innovation ETF', type: 'ETF', exchange: 'NYSE', sector: 'Index' },
  { symbol: 'XLF', name: 'Financial Select Sector SPDR', type: 'ETF', exchange: 'NYSE', sector: 'Index' },
  { symbol: 'XLE', name: 'Energy Select Sector SPDR', type: 'ETF', exchange: 'NYSE', sector: 'Index' },
  { symbol: 'XLK', name: 'Technology Select Sector SPDR', type: 'ETF', exchange: 'NYSE', sector: 'Index' },
  // ═══ Commodity Futures (actual contracts) ═══
  { symbol: 'GC=F', name: 'Gold Futures', type: 'FUTURES', exchange: 'COMEX', sector: 'Commodity' },
  { symbol: 'SI=F', name: 'Silver Futures', type: 'FUTURES', exchange: 'COMEX', sector: 'Commodity' },
  { symbol: 'CL=F', name: 'Crude Oil WTI Futures', type: 'FUTURES', exchange: 'NYMEX', sector: 'Commodity' },
  { symbol: 'NG=F', name: 'Natural Gas Futures', type: 'FUTURES', exchange: 'NYMEX', sector: 'Commodity' },
  { symbol: 'HG=F', name: 'Copper Futures', type: 'FUTURES', exchange: 'COMEX', sector: 'Commodity' },
  { symbol: 'PL=F', name: 'Platinum Futures', type: 'FUTURES', exchange: 'NYMEX', sector: 'Commodity' },
  { symbol: 'PA=F', name: 'Palladium Futures', type: 'FUTURES', exchange: 'NYMEX', sector: 'Commodity' },
  // ═══ Commodities — Precious Metals (ETFs) ═══
  { symbol: 'GLD', name: 'SPDR Gold Trust', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'IAU', name: 'iShares Gold Trust', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'SGOL', name: 'Aberdeen Physical Gold', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'SLV', name: 'iShares Silver Trust', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'PPLT', name: 'Aberdeen Platinum ETF', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'PALL', name: 'Aberdeen Palladium ETF', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  // ═══ Commodities — Energy ═══
  { symbol: 'USO', name: 'United States Oil Fund', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'BNO', name: 'United States Brent Oil', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'UNG', name: 'United States Natural Gas', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'AMLP', name: 'Alerian MLP ETF', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  // ═══ Commodities — Agriculture ═══
  { symbol: 'DBA', name: 'Invesco DB Agriculture', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'CORN', name: 'Teucrium Corn Fund', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'WEAT', name: 'Teucrium Wheat Fund', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'SOYB', name: 'Teucrium Soybean Fund', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'CANE', name: 'Teucrium Sugar Fund', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'COW', name: 'iPath Livestock ETN', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'JO', name: 'iPath Coffee ETN', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'NIB', name: 'iPath Cocoa ETN', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'TAGS', name: 'Teucrium Agricultural Fund', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  // ═══ Commodities — Industrial Metals ═══
  { symbol: 'CPER', name: 'United States Copper Index', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'COPX', name: 'Global X Copper Miners ETF', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'LIT', name: 'Global X Lithium & Battery', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'URA', name: 'Global X Uranium ETF', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'REMX', name: 'VanEck Rare Earth ETF', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'PICK', name: 'iShares MSCI Mining ETF', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'SLX', name: 'VanEck Steel ETF', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  // ═══ Commodities — Broad Baskets ═══
  { symbol: 'DJP', name: 'iPath Bloomberg Commodity', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'GSG', name: 'iShares GSCI Commodity', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'PDBC', name: 'Invesco Optimum Yield Commodity', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'COM', name: 'Direxion Auspice Commodity', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'COMT', name: 'iShares GSCI Commodity ETF', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'FTGC', name: 'First Trust Global Commodity', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'BCI', name: 'Aberdeen Standard Commodity', type: 'ETF', exchange: 'NYSE', sector: 'Commodity' },
  // ═══ Mining Stocks ═══
  { symbol: 'NEM', name: 'Newmont Corporation', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'GOLD', name: 'Barrick Gold Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'AEM', name: 'Agnico Eagle Mines', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'WPM', name: 'Wheaton Precious Metals', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'RGLD', name: 'Royal Gold Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Commodity' },
  { symbol: 'FNV', name: 'Franco-Nevada Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'VALE', name: 'Vale S.A.', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'BHP', name: 'BHP Group Limited', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'RIO', name: 'Rio Tinto PLC', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'SCCO', name: 'Southern Copper Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'TECK', name: 'Teck Resources Ltd.', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  { symbol: 'AA', name: 'Alcoa Corporation', type: 'EQUITY', exchange: 'NYSE', sector: 'Commodity' },
  // ═══ Magnificent 7 ═══
  { symbol: 'AAPL', name: 'Apple Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Consumer' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'TSLA', name: 'Tesla Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Automotive' },
  { symbol: 'META', name: 'Meta Platforms Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  // ═══ Semiconductors ═══
  { symbol: 'AMD', name: 'Advanced Micro Devices', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'INTC', name: 'Intel Corporation', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'ASML', name: 'ASML Holding', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'QCOM', name: 'Qualcomm Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor', type: 'EQUITY', exchange: 'NYSE', sector: 'Semiconductor' },
  { symbol: 'MU', name: 'Micron Technology', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'MRVL', name: 'Marvell Technology', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'ON', name: 'ON Semiconductor', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'LRCX', name: 'Lam Research', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'AMAT', name: 'Applied Materials', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'KLAC', name: 'KLA Corporation', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  { symbol: 'ARM', name: 'Arm Holdings', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Semiconductor' },
  // ═══ Software & Cloud ═══
  { symbol: 'CRM', name: 'Salesforce Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Technology' },
  { symbol: 'ADBE', name: 'Adobe Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'ORCL', name: 'Oracle Corporation', type: 'EQUITY', exchange: 'NYSE', sector: 'Technology' },
  { symbol: 'IBM', name: 'IBM', type: 'EQUITY', exchange: 'NYSE', sector: 'Technology' },
  { symbol: 'INTU', name: 'Intuit Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'NOW', name: 'ServiceNow Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Technology' },
  { symbol: 'SNOW', name: 'Snowflake Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Technology' },
  { symbol: 'PLTR', name: 'Palantir Technologies', type: 'EQUITY', exchange: 'NMS', sector: 'Technology' },
  { symbol: 'PANW', name: 'Palo Alto Networks', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'CRWD', name: 'CrowdStrike Holdings', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'SHOP', name: 'Shopify Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Technology' },
  { symbol: 'SQ', name: 'Block Inc. (Square)', type: 'EQUITY', exchange: 'NYSE', sector: 'Technology' },
  { symbol: 'UBER', name: 'Uber Technologies', type: 'EQUITY', exchange: 'NYSE', sector: 'Technology' },
  { symbol: 'SPOT', name: 'Spotify Technology', type: 'EQUITY', exchange: 'NYSE', sector: 'Technology' },
  { symbol: 'ABNB', name: 'Airbnb Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'NET', name: 'Cloudflare Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Technology' },
  { symbol: 'DDOG', name: 'Datadog Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'ZS', name: 'Zscaler Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'MSTR', name: 'MicroStrategy Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Technology' },
  // ═══ Communication & Media ═══
  { symbol: 'NFLX', name: 'Netflix Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Communication' },
  { symbol: 'DIS', name: 'Walt Disney Co.', type: 'EQUITY', exchange: 'NYSE', sector: 'Communication' },
  { symbol: 'VZ', name: 'Verizon Communications', type: 'EQUITY', exchange: 'NYSE', sector: 'Communication' },
  { symbol: 'T', name: 'AT&T Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Communication' },
  { symbol: 'CMCSA', name: 'Comcast Corp.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Communication' },
  { symbol: 'TMUS', name: 'T-Mobile US', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Communication' },
  { symbol: 'ROKU', name: 'Roku Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Communication' },
  { symbol: 'WBD', name: 'Warner Bros. Discovery', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Communication' },
  { symbol: 'PARA', name: 'Paramount Global', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Communication' },
  { symbol: 'CHTR', name: 'Charter Communications', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Communication' },
  { symbol: 'SNAP', name: 'Snap Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Communication' },
  { symbol: 'PINS', name: 'Pinterest Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Communication' },
  { symbol: 'TTD', name: 'The Trade Desk', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Communication' },
  { symbol: 'RBLX', name: 'Roblox Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'Communication' },
  // ═══ Financial ═══
  { symbol: 'BRK-B', name: 'Berkshire Hathaway', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'V', name: 'Visa Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'MA', name: 'Mastercard Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'BAC', name: 'Bank of America Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'GS', name: 'Goldman Sachs Group', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'MS', name: 'Morgan Stanley', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'C', name: 'Citigroup Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'WFC', name: 'Wells Fargo & Co.', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'COIN', name: 'Coinbase Global', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Financial' },
  { symbol: 'PYPL', name: 'PayPal Holdings', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Financial' },
  { symbol: 'SCHW', name: 'Charles Schwab', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'BLK', name: 'BlackRock Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'AXP', name: 'American Express', type: 'EQUITY', exchange: 'NYSE', sector: 'Financial' },
  { symbol: 'HOOD', name: 'Robinhood Markets', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Financial' },
  { symbol: 'SOFI', name: 'SoFi Technologies', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Financial' },
  // ═══ Healthcare & Pharma ═══
  { symbol: 'NVO', name: 'Novo Nordisk', type: 'EQUITY', exchange: 'NYSE', sector: 'Healthcare' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', type: 'EQUITY', exchange: 'NYSE', sector: 'Healthcare' },
  { symbol: 'UNH', name: 'UnitedHealth Group', type: 'EQUITY', exchange: 'NYSE', sector: 'Healthcare' },
  { symbol: 'PFE', name: 'Pfizer Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Healthcare' },
  { symbol: 'ABBV', name: 'AbbVie Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Healthcare' },
  { symbol: 'MRK', name: 'Merck & Co.', type: 'EQUITY', exchange: 'NYSE', sector: 'Healthcare' },
  { symbol: 'LLY', name: 'Eli Lilly & Co.', type: 'EQUITY', exchange: 'NYSE', sector: 'Healthcare' },
  { symbol: 'TMO', name: 'Thermo Fisher Scientific', type: 'EQUITY', exchange: 'NYSE', sector: 'Healthcare' },
  { symbol: 'BMY', name: 'Bristol-Myers Squibb', type: 'EQUITY', exchange: 'NYSE', sector: 'Healthcare' },
  { symbol: 'AMGN', name: 'Amgen Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Healthcare' },
  { symbol: 'GILD', name: 'Gilead Sciences', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Healthcare' },
  { symbol: 'ISRG', name: 'Intuitive Surgical', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Healthcare' },
  { symbol: 'MRNA', name: 'Moderna Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Healthcare' },
  // ═══ Consumer ═══
  { symbol: 'WMT', name: 'Walmart Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Consumer' },
  { symbol: 'HD', name: 'Home Depot Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Consumer' },
  { symbol: 'PG', name: 'Procter & Gamble Co.', type: 'EQUITY', exchange: 'NYSE', sector: 'Consumer' },
  { symbol: 'KO', name: 'Coca-Cola Co.', type: 'EQUITY', exchange: 'NYSE', sector: 'Consumer' },
  { symbol: 'PEP', name: 'PepsiCo Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Consumer' },
  { symbol: 'COST', name: 'Costco Wholesale', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Consumer' },
  { symbol: 'MCD', name: 'McDonald\'s Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'Consumer' },
  { symbol: 'NKE', name: 'Nike Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Consumer' },
  { symbol: 'SBUX', name: 'Starbucks Corp.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Consumer' },
  { symbol: 'TGT', name: 'Target Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'Consumer' },
  { symbol: 'LOW', name: 'Lowe\'s Companies', type: 'EQUITY', exchange: 'NYSE', sector: 'Consumer' },
  { symbol: 'EL', name: 'Estee Lauder', type: 'EQUITY', exchange: 'NYSE', sector: 'Consumer' },
  { symbol: 'CMG', name: 'Chipotle Mexican Grill', type: 'EQUITY', exchange: 'NYSE', sector: 'Consumer' },
  { symbol: 'LULU', name: 'Lululemon Athletica', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Consumer' },
  // ═══ Energy ═══
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  { symbol: 'CVX', name: 'Chevron Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  { symbol: 'COP', name: 'ConocoPhillips', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  { symbol: 'SLB', name: 'Schlumberger Ltd.', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  { symbol: 'EOG', name: 'EOG Resources', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  { symbol: 'OXY', name: 'Occidental Petroleum', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  { symbol: 'MPC', name: 'Marathon Petroleum', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  { symbol: 'PSX', name: 'Phillips 66', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  { symbol: 'VLO', name: 'Valero Energy', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  { symbol: 'HAL', name: 'Halliburton Co.', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  { symbol: 'DVN', name: 'Devon Energy', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  { symbol: 'FANG', name: 'Diamondback Energy', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Energy' },
  { symbol: 'BKR', name: 'Baker Hughes Co.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Energy' },
  { symbol: 'WMB', name: 'Williams Companies', type: 'EQUITY', exchange: 'NYSE', sector: 'Energy' },
  // ═══ Industrial & Aerospace ═══
  // 🪤 SPCX was missing here until 2026-08-07 even though it IPO'd 2026-06-12
  // and the rest of the app knows about it (stockData.js, the earnings rail,
  // the below-IPO notification class). At a $1.75T cap it is the 4th largest
  // name we track, so every total computed from this list - "money added to US
  // stocks today" above all - was understating the market by a couple of
  // hundred billion, and disagreeing with LITE, whose own board did carry it.
  { symbol: 'SPCX', name: 'SpaceX', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Industrial' },
  { symbol: 'BA', name: 'Boeing Co.', type: 'EQUITY', exchange: 'NYSE', sector: 'Industrial' },
  { symbol: 'CAT', name: 'Caterpillar Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Industrial' },
  { symbol: 'GE', name: 'GE Aerospace', type: 'EQUITY', exchange: 'NYSE', sector: 'Industrial' },
  { symbol: 'UPS', name: 'United Parcel Service', type: 'EQUITY', exchange: 'NYSE', sector: 'Industrial' },
  { symbol: 'HON', name: 'Honeywell International', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Industrial' },
  { symbol: 'RTX', name: 'RTX Corporation', type: 'EQUITY', exchange: 'NYSE', sector: 'Industrial' },
  { symbol: 'LMT', name: 'Lockheed Martin', type: 'EQUITY', exchange: 'NYSE', sector: 'Industrial' },
  { symbol: 'NOC', name: 'Northrop Grumman', type: 'EQUITY', exchange: 'NYSE', sector: 'Industrial' },
  { symbol: 'DE', name: 'Deere & Company', type: 'EQUITY', exchange: 'NYSE', sector: 'Industrial' },
  { symbol: 'MMM', name: '3M Company', type: 'EQUITY', exchange: 'NYSE', sector: 'Industrial' },
  { symbol: 'FDX', name: 'FedEx Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'Industrial' },
  { symbol: 'GD', name: 'General Dynamics', type: 'EQUITY', exchange: 'NYSE', sector: 'Industrial' },
  // ═══ Real Estate ═══
  { symbol: 'AMT', name: 'American Tower Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'RealEstate' },
  { symbol: 'PLD', name: 'Prologis Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'RealEstate' },
  { symbol: 'CCI', name: 'Crown Castle Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'RealEstate' },
  { symbol: 'EQIX', name: 'Equinix Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'RealEstate' },
  { symbol: 'O', name: 'Realty Income Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'RealEstate' },
  { symbol: 'SPG', name: 'Simon Property Group', type: 'EQUITY', exchange: 'NYSE', sector: 'RealEstate' },
  { symbol: 'WELL', name: 'Welltower Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'RealEstate' },
  { symbol: 'DLR', name: 'Digital Realty Trust', type: 'EQUITY', exchange: 'NYSE', sector: 'RealEstate' },
  { symbol: 'PSA', name: 'Public Storage', type: 'EQUITY', exchange: 'NYSE', sector: 'RealEstate' },
  { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', type: 'ETF', exchange: 'NYSE', sector: 'RealEstate' },
  { symbol: 'SBAC', name: 'SBA Communications', type: 'EQUITY', exchange: 'NASDAQ', sector: 'RealEstate' },
  { symbol: 'AVB', name: 'AvalonBay Communities', type: 'EQUITY', exchange: 'NYSE', sector: 'RealEstate' },
  // ═══ Automotive ═══
  { symbol: 'F', name: 'Ford Motor Co.', type: 'EQUITY', exchange: 'NYSE', sector: 'Automotive' },
  { symbol: 'GM', name: 'General Motors', type: 'EQUITY', exchange: 'NYSE', sector: 'Automotive' },
  { symbol: 'RIVN', name: 'Rivian Automotive', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Automotive' },
  { symbol: 'LCID', name: 'Lucid Group', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Automotive' },
  { symbol: 'TM', name: 'Toyota Motor Corp.', type: 'EQUITY', exchange: 'NYSE', sector: 'Automotive' },
  { symbol: 'STLA', name: 'Stellantis N.V.', type: 'EQUITY', exchange: 'NYSE', sector: 'Automotive' },
  { symbol: 'LI', name: 'Li Auto Inc.', type: 'EQUITY', exchange: 'NASDAQ', sector: 'Automotive' },
  { symbol: 'NIO', name: 'NIO Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Automotive' },
  { symbol: 'XPEV', name: 'XPeng Inc.', type: 'EQUITY', exchange: 'NYSE', sector: 'Automotive' },
  { symbol: 'RACE', name: 'Ferrari N.V.', type: 'EQUITY', exchange: 'NYSE', sector: 'Automotive' },
  { symbol: 'APTV', name: 'Aptiv PLC', type: 'EQUITY', exchange: 'NYSE', sector: 'Automotive' },
]

/**
 * Search stocks by ticker or company name
 * Primary: server proxy → Fallback: local POPULAR_STOCKS filter
 * @param {string} query - Search query
 * @returns {Promise<Array<{symbol: string, name: string, type: string, exchange: string}>>}
 */
export async function searchStocks(query) {
  if (!query || query.length < 1) return []

  // 1. Try server proxy (Yahoo search, cached)
  try {
    const data = await serverFetch(`/api/stocks/search?q=${encodeURIComponent(query)}`)
    if (Array.isArray(data) && data.length > 0) {
      return data.slice(0, 12)
    }
  } catch (err) {
    // silently handled
  }

  // 2. Fallback: search in popular stocks list locally
  const upperQuery = query.toUpperCase()
  const lowerQuery = query.toLowerCase()
  return POPULAR_STOCKS.filter(stock =>
    stock.symbol.includes(upperQuery) ||
    stock.name.toLowerCase().includes(lowerQuery)
  ).slice(0, 12)
}

/**
 * Get OHLC candle data for charts
 * Primary: server proxy → Fallback: empty (no CORS-free candle source)
 * @param {string} symbol - Stock symbol
 * @param {string} resolution - Timeframe: '1m', '5m', '15m', '1h', '1d', '1wk', '1mo'
 * @param {number} from - Unix timestamp (seconds)
 * @param {number} to - Unix timestamp (seconds)
 * @returns {Promise<{getBars: Array<{t: number, o: number, h: number, l: number, c: number, v: number}>}>}
 */
// SEC EDGAR insider activity (Form 4 buys/sells + 90d net flow), keyless.
// Server caches 6h; this module cache just kills same-session refetches.
const _insiderCache = new Map()
export async function getInsiderActivity(symbol) {
  const sym = String(symbol || '').toUpperCase()
  if (!sym) return null
  const hit = _insiderCache.get(sym)
  if (hit && Date.now() - hit.ts < 30 * 60 * 1000) return hit.data
  try {
    const res = await fetch(`/api/stocks/insiders/${encodeURIComponent(sym)}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const data = await res.json()
    _insiderCache.set(sym, { ts: Date.now(), data })
    return data
  } catch (e) {
    return null
  }
}

/* Yahoo has no 4h and no 12h interval, and the hero chart asks for both. The
   old map had no '30' or '720' entry at all (silently serving 1h under the 30m
   and 12h buttons) and sent '240' to '1d', so the 4H button drew DAILY candles.
   Hourly bars aggregated into the bucket the button promises is the same trick
   STOCK_TA_INTERVALS already uses for the indicator engine. */
const STOCK_CANDLE_SPEC = {
  '1': { interval: '1m', range: '1d' },
  '5': { interval: '5m', range: '5d' },
  '15': { interval: '15m', range: '5d' },
  '30': { interval: '30m', range: '1mo' },
  '60': { interval: '1h', range: '1mo' },
  '1h': { interval: '1h', range: '1mo' },
  '240': { interval: '1h', range: '3mo', aggregate: 4 * 3600 },
  '4h': { interval: '1h', range: '3mo', aggregate: 4 * 3600 },
  '720': { interval: '1h', range: '6mo', aggregate: 12 * 3600 },
  '12h': { interval: '1h', range: '6mo', aggregate: 12 * 3600 },
  '1D': { interval: '1d', range: '1y' },
  '1d': { interval: '1d', range: '1y' },
  '1W': { interval: '1wk', range: '5y' },
  '1w': { interval: '1wk', range: '5y' },
  '1M': { interval: '1mo', range: 'max' },
}

export async function getStockCandles(symbol, resolution = '1h', from, to, opts = {}) {
  const base = STOCK_CANDLE_SPEC[String(resolution)] || STOCK_CANDLE_SPEC['1h']
  // `opts.range` lets a caller with its own scroll-back (LITE's lightweight
  // chart) pull a deeper Yahoo window than the default first-paint range.
  const spec = opts.range ? { ...base, range: opts.range } : base

  // 1. Try server proxy (Yahoo Finance chart data, cached)
  try {
    const data = await serverFetch(
      `/api/stocks/candles?symbol=${encodeURIComponent(symbol)}&interval=${spec.interval}&range=${spec.range}`,
      10000 // longer timeout for candle data
    )
    // Server returns { bars: [...] } — normalize to { getBars: [...] } for hook compatibility
    let bars = data?.getBars || data?.bars
    if (bars && bars.length > 0) {
      if (spec.aggregate) bars = aggregateStockBars(bars, spec.aggregate)
      return { getBars: bars }
    }
  } catch (err) {
    // silently handled
  }

  return { getBars: [] }
}

/**
 * Stock OHLC series sized for the TA engine (useKlineIndicators / useMtfThesis).
 *
 * getStockCandles above serves the hero chart with short display ranges; the
 * indicator engine needs >=210 bars (EMA200 + warm-up) wherever Yahoo allows.
 * Yahoo v8 caps: 1m=7d, 5m/15m/30m=60d, 1h(60m)=730d, 1d/1wk=decades — so the
 * range per resolution below is picked to clear 210 bars inside the cap.
 * Yahoo has NO native 4h interval: '240' fetches hourly over 6mo and
 * aggregates client-side into 4h buckets on the 09:30 ET session grid
 * (see aggregateStockBars).
 *
 * Returns { bars: [{t(sec),o,h,l,c,v(shares)}] } ascending — same shape the
 * crypto chain yields, so the engine's _cleanBars/math run unchanged.
 */
const STOCK_TA_INTERVALS = {
  // Ranges sit near Yahoo's per-interval ceiling (1m: 7d, 5m-30m: 60d, 1h:
  // 730d) because the TradingView stock leg SLICES this fixed range for every
  // scroll-back request - anything older than the range reads as "history
  // exhausted", so a short range is a chart that stops loading.
  '1':   { interval: '1m',  range: '5d' },
  '5':   { interval: '5m',  range: '1mo' },
  '15':  { interval: '15m', range: '1mo' },
  '30':  { interval: '30m', range: '1mo' },
  '60':  { interval: '1h',  range: '6mo' },
  '240': { interval: '1h',  range: '1y', aggregate: 4 * 3600 },
  '1D':  { interval: '1d',  range: '5y' },
  '1W':  { interval: '1wk', range: 'max' },
}

// Equity bars aggregate on the SESSION grid, not the UTC grid. Yahoo stamps
// hourly bars at 09:30, 10:30 ... 15:30 America/New_York; a 4h bucket must be
// 09:30-13:30 / 13:30-16:00 the way TradingView's own equity 4h bars are cut.
// The UTC-aligned floor(t / 14400) this replaced (2026-09-04) stamped the two
// daily buckets 08:00 ET and 12:00 ET - both outside/inside the '0930-1600'
// session TradingViewAdvanced declares, and the charting library snapped both
// into its single 09:30 slot: one candle per day, a hole between each, today
// absent until noon (TSLA measured: 259 bars supplied, 132 kept). Derived in
// the exchange time zone so EDT and EST both land on 09:30.
const NY_OPEN_MIN = 9 * 60 + 30
const _nyParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
})
function nySecondsSinceOpen(tSec) {
  const parts = _nyParts.formatToParts(new Date(tSec * 1000))
  let h = 0, m = 0, sec = 0
  for (const p of parts) {
    if (p.type === 'hour') h = Number(p.value) % 24
    else if (p.type === 'minute') m = Number(p.value)
    else if (p.type === 'second') sec = Number(p.value)
  }
  return (h * 60 + m - NY_OPEN_MIN) * 60 + sec
}

export function aggregateStockBars(bars, bucketSec) {
  if (!Array.isArray(bars) || !bars.length || !bucketSec) return bars
  const buckets = new Map()
  for (const b of bars) {
    const t = Number(b.t)
    if (!Number.isFinite(t)) continue
    // Pre-market stamps (never in Yahoo's regular-session series, kept safe)
    // fold into the opening bucket rather than a negative index.
    const sinceOpen = Math.max(0, nySecondsSinceOpen(t))
    const idx = Math.floor(sinceOpen / bucketSec)
    const key = t - sinceOpen + idx * bucketSec
    const cur = buckets.get(key)
    if (!cur) {
      buckets.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0, _last: t })
    } else {
      if (b.h > cur.h) cur.h = b.h
      if (b.l < cur.l) cur.l = b.l
      if (t >= cur._last) { cur.c = b.c; cur._last = t }
      cur.v += b.v || 0
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t).map(({ _last, ...bar }) => bar)
}

export async function getStockSeriesBars(symbol, resolution = '60') {
  const spec = STOCK_TA_INTERVALS[String(resolution)] || STOCK_TA_INTERVALS['60']
  try {
    const data = await serverFetch(
      `/api/stocks/candles?symbol=${encodeURIComponent(symbol)}&interval=${spec.interval}&range=${spec.range}`,
      12000
    )
    let bars = data?.bars || data?.getBars || []
    if (spec.aggregate) bars = aggregateStockBars(bars, spec.aggregate)
    return { bars }
  } catch (err) {
    return { bars: [] }
  }
}

/**
 * Get company profile/fundamentals
 * Primary: /api/stocks/fundamentals/:symbol (rich data: description, CEO, employees, dividendYield, etc.)
 * Fallback: getStockQuotes (basic price + PE)
 */
export async function getCompanyProfile(symbol) {
  // 1. Try the rich fundamentals endpoint (Finnhub profile + Yahoo quoteSummary)
  try {
    const data = await serverFetch(`/api/stocks/fundamentals/${encodeURIComponent(symbol)}`, 8000)
    if (data && data.symbol) {
      return {
        symbol: data.symbol,
        name: data.name,
        exchange: data.exchange,
        sector: data.sector,
        industry: data.industry || data.sector || '',
        country: data.country || 'US',
        description: data.description || '',
        ipo: data.ipo || null,
        employees: data.employees || null,
        ceo: data.ceo || null,
        website: data.website || '',
        logo: data.logo || null,
        marketCap: data.marketCap,
        pe: data.pe,
        forwardPe: data.forwardPe || null,
        eps: data.eps,
        dividendYield: data.dividendYield || null,
        beta: data.beta || null,
        sharesOutstanding: data.sharesOutstanding || null,
        week52High: data.week52High,
        week52Low: data.week52Low,
        avgVolume: data.avgVolume,
        earningsDate: data.earningsDate || null,
        earningsAvg: data.earningsAvg ?? null,
        revenueAvg: data.revenueAvg ?? null,
        earningsHistory: Array.isArray(data.earningsHistory) ? data.earningsHistory : [],
        targetMeanPrice: data.targetMeanPrice ?? null,
        targetHighPrice: data.targetHighPrice ?? null,
        targetLowPrice: data.targetLowPrice ?? null,
        recommendationKey: data.recommendationKey || null,
        analystCount: data.analystCount ?? null,
        recTrend: data.recTrend || null,
        price: data.price,
        change: data.change,
        volume: data.volume,
        previousClose: data.previousClose || null,
        open: data.open || null,
        high: data.high || null,
        low: data.low || null,
      }
    }
  } catch (err) {
    // silently handled
  }

  // 2. Fallback: basic quote data
  try {
    const quotes = await getStockQuotes([symbol])
    const quote = quotes[symbol]

    if (quote) {
      return {
        symbol: quote.symbol,
        name: quote.name,
        exchange: quote.exchange,
        sector: quote.sector,
        country: 'US',
        description: '',
        ipo: null,
        employees: null,
        website: '',
        logo: null,
        marketCap: quote.marketCap,
        pe: quote.pe,
        forwardPe: null,
        eps: quote.eps,
        dividendYield: null,
        beta: null,
        sharesOutstanding: null,
        week52High: quote.week52High,
        week52Low: quote.week52Low,
        avgVolume: quote.avgVolume,
        price: quote.price,
        change: quote.change,
        volume: quote.volume,
      }
    }
  } catch (err) {
    // silently handled
  }

  return null
}

/**
 * Get market movers - top gainers and losers
 * Primary: server proxy (pre-computed) → Fallback: fetch quotes + sort locally
 */
export async function getMarketMovers() {
  // 1. Try server proxy (pre-sorted, cached 2 min)
  try {
    const data = await serverFetch('/api/stocks/movers')
    if (data && (data.gainers?.length > 0 || data.losers?.length > 0)) {
      return data
    }
  } catch (err) {
    // silently handled
  }

  // 2. Fallback: fetch quotes for popular stocks and sort locally
  const watchSymbols = [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
    'JPM', 'V', 'JNJ', 'UNH', 'HD', 'PG', 'MA', 'DIS', 'NFLX', 'PYPL',
    'ADBE', 'CRM', 'INTC', 'AMD', 'CSCO', 'PEP', 'KO', 'MRK', 'PFE',
    'BA', 'CAT', 'GS', 'WMT', 'CVX', 'XOM'
  ]

  try {
    const quotes = await getStockQuotes(watchSymbols)
    const stocks = Object.values(quotes).filter(q => q.price > 0)
    const sorted = [...stocks].sort((a, b) => b.change - a.change)

    return {
      gainers: sorted.slice(0, 10),
      losers: sorted.slice(-10).reverse(),
      mostActive: [...stocks].sort((a, b) => b.volume - a.volume).slice(0, 10),
    }
  } catch (err) {
    // silently handled
    return { gainers: [], losers: [], mostActive: [] }
  }
}

/**
 * Get market status (open/closed)
 */
export function getMarketStatus() {
  const now = new Date()
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = nyTime.getDay()
  const hours = nyTime.getHours()
  const minutes = nyTime.getMinutes()
  const timeNum = hours * 100 + minutes

  // Weekend
  if (day === 0 || day === 6) {
    return {
      isOpen: false,
      status: 'CLOSED',
      message: 'Weekend - Markets Closed',
      nextOpen: getNextMarketOpen(nyTime),
    }
  }

  // Pre-market: 4:00 AM - 9:30 AM ET
  if (timeNum >= 400 && timeNum < 930) {
    return {
      isOpen: false,
      status: 'PRE',
      message: 'Pre-Market Trading',
      nextOpen: 'Opens at 9:30 AM ET',
    }
  }

  // Regular hours: 9:30 AM - 4:00 PM ET
  if (timeNum >= 930 && timeNum < 1600) {
    return {
      isOpen: true,
      status: 'REGULAR',
      message: 'Market Open',
      closesAt: '4:00 PM ET',
    }
  }

  // After-hours: 4:00 PM - 8:00 PM ET
  if (timeNum >= 1600 && timeNum < 2000) {
    return {
      isOpen: false,
      status: 'POST',
      message: 'After-Hours Trading',
      nextOpen: 'Opens tomorrow 9:30 AM ET',
    }
  }

  // Closed
  return {
    isOpen: false,
    status: 'CLOSED',
    message: 'Markets Closed',
    nextOpen: getNextMarketOpen(nyTime),
  }
}

function getNextMarketOpen(nyTime) {
  const day = nyTime.getDay()
  let daysUntilOpen = 1

  if (day === 5) daysUntilOpen = 3 // Friday -> Monday
  else if (day === 6) daysUntilOpen = 2 // Saturday -> Monday

  return `Opens in ${daysUntilOpen} day${daysUntilOpen > 1 ? 's' : ''} at 9:30 AM ET`
}

/**
 * Get major market indices (S&P 500, Dow, Nasdaq, Russell, VIX)
 * Primary: server proxy → Fallback: fetch quotes for index symbols
 */
export async function getMarketIndices() {
  // 1. Try server proxy (cached, pre-formatted)
  try {
    const data = await serverFetch('/api/stocks/indices')
    if (Array.isArray(data) && data.length > 0) {
      return data
    }
  } catch (err) {
    // silently handled
  }

  // 2. Fallback: fetch index quotes directly
  const indices = ['^GSPC', '^DJI', '^IXIC', '^RUT', '^VIX']
  const indexNames = {
    '^GSPC': 'S&P 500',
    '^DJI': 'Dow Jones',
    '^IXIC': 'Nasdaq',
    '^RUT': 'Russell 2000',
    '^VIX': 'VIX',
  }

  try {
    const quotes = await getStockQuotes(indices)
    return Object.entries(quotes).map(([symbol, data]) => ({
      ...data,
      name: indexNames[symbol] || data.name,
    }))
  } catch (err) {
    // silently handled
    return []
  }
}

// ── Upcoming earnings (curated high-profile watch list by default) ──────────
// Backs the Lite + Command Center earnings widgets. Server (Yahoo calendarEvents)
// caches ~30min; this module cache + inflight dedup kills same-session refetches,
// and a localStorage seed (6h) paints last-known dates instead of an empty widget
// when the serverless is cold / market data is briefly unavailable.
const _earnCache = {}     // { [key]: { data, ts } }
const _earnInflight = {}  // { [key]: Promise }
const EARN_TTL = 30 * 60 * 1000
const EARN_LS_PREFIX = 'spectre-earnings-v1:'

export async function getUpcomingEarnings(symbols) {
  const list = Array.isArray(symbols) ? symbols.map(s => String(s).toUpperCase()).filter(Boolean) : []
  const key = list.length ? list.slice().sort().join(',') : 'default'
  const qs = list.length ? `?symbols=${encodeURIComponent(list.join(','))}` : ''

  const hit = _earnCache[key]
  if (hit && Date.now() - hit.ts < EARN_TTL) return hit.data
  if (_earnInflight[key]) return _earnInflight[key]

  const p = (async () => {
    try {
      const data = await serverFetch(`/api/stocks/earnings${qs}`, 12000)
      const rows = Array.isArray(data?.earnings) ? data.earnings : []
      if (rows.length) {
        _earnCache[key] = { data: rows, ts: Date.now() }
        try { localStorage.setItem(EARN_LS_PREFIX + key, JSON.stringify({ rows, ts: Date.now() })) } catch { /* quota */ }
        return rows
      }
      // Empty server response (cold serverless / closed-session Yahoo miss):
      // fall back to a recent localStorage seed rather than flash an empty widget.
      try {
        const seed = JSON.parse(localStorage.getItem(EARN_LS_PREFIX + key) || 'null')
        if (seed?.rows?.length && Date.now() - seed.ts < 6 * 60 * 60 * 1000) return seed.rows
      } catch { /* ignore */ }
      return []
    } catch {
      return []
    } finally {
      delete _earnInflight[key]
    }
  })()
  _earnInflight[key] = p
  return p
}

export default {
  getStockQuotes,
  getStockQuote,
  getUpcomingEarnings,
  searchStocks,
  getStockCandles,
  getStockSeriesBars,
  getCompanyProfile,
  getMarketMovers,
  getMarketStatus,
  getMarketIndices,
}

/**
 * Reported earnings figures — the fastest true source.
 *
 * Founder 2026-08-04: "earnings should come from fastest true source not from
 * old media like yahoo if they are slow." The vendor's actual-vs-estimate row
 * lagged the wire by over an hour on SPCX's print. This reads what the news
 * copy explicitly states; the vendor still overwrites it once it publishes.
 * `status` is 'reported' (wire) or 'pending' (nothing stated yet) — never
 * 'confirmed', which only the vendor row can claim.
 */
const _reportedCache = new Map()
export async function getReportedEarnings(symbol, companyName) {
  if (!symbol) return null
  const key = String(symbol).toUpperCase()
  const hit = _reportedCache.get(key)
  if (hit && Date.now() - hit.ts < 60_000) return hit.data
  try {
    const qs = companyName ? `?name=${encodeURIComponent(companyName)}` : ''
    const res = await fetch(`/api/stocks/reported/${encodeURIComponent(key)}${qs}`, {
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    const data = await res.json()
    _reportedCache.set(key, { data, ts: Date.now() })
    return data
  } catch {
    return null
  }
}
