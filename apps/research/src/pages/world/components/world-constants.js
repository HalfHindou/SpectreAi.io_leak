import * as THREE from 'three'

export const GLOBE_RADIUS = 2

export function latLngToVec3(lat, lng, radius = GLOBE_RADIUS) {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  )
}

export const FINANCIAL_HUBS = [
  { id: 'nyc', name: 'New York', lat: 40.7128, lng: -74.006, region: 'americas' },
  { id: 'london', name: 'London', lat: 51.5074, lng: -0.1278, region: 'europe' },
  { id: 'tokyo', name: 'Tokyo', lat: 35.6762, lng: 139.6503, region: 'asia' },
  { id: 'frankfurt', name: 'Frankfurt', lat: 50.1109, lng: 8.6821, region: 'europe' },
  { id: 'hongkong', name: 'Hong Kong', lat: 22.3193, lng: 114.1694, region: 'asia' },
  { id: 'singapore', name: 'Singapore', lat: 1.3521, lng: 103.8198, region: 'asia' },
  { id: 'dubai', name: 'Dubai', lat: 25.2048, lng: 55.2708, region: 'europe' },
  { id: 'shanghai', name: 'Shanghai', lat: 31.2304, lng: 121.4737, region: 'asia' },
  { id: 'sydney', name: 'Sydney', lat: -33.8688, lng: 151.2093, region: 'asia' },
  { id: 'toronto', name: 'Toronto', lat: 43.6532, lng: -79.3832, region: 'americas' },
  { id: 'zurich', name: 'Zurich', lat: 47.3769, lng: 8.5417, region: 'europe' },
  { id: 'paris', name: 'Paris', lat: 48.8566, lng: 2.3522, region: 'europe' },
  { id: 'seoul', name: 'Seoul', lat: 37.5665, lng: 126.978, region: 'asia' },
  { id: 'mumbai', name: 'Mumbai', lat: 19.076, lng: 72.8777, region: 'asia' },
  { id: 'saopaulo', name: 'Sao Paulo', lat: -23.5505, lng: -46.6333, region: 'americas' },
  { id: 'chicago', name: 'Chicago', lat: 41.8781, lng: -87.6298, region: 'americas' },
  { id: 'la', name: 'Los Angeles', lat: 34.0522, lng: -118.2437, region: 'americas' },
  { id: 'stockholm', name: 'Stockholm', lat: 59.3293, lng: 18.0686, region: 'europe' },
  { id: 'amsterdam', name: 'Amsterdam', lat: 52.3676, lng: 4.9041, region: 'europe' },
  { id: 'miami', name: 'Miami', lat: 25.7617, lng: -80.1918, region: 'americas' },
]

export const CRYPTO_NODES = [
  { id: 'us-east', name: 'US East', lat: 39.0, lng: -77.0, size: 1.0, hash: '35%' },
  { id: 'us-west', name: 'US West', lat: 37.0, lng: -122.0, size: 0.6, hash: '12%' },
  { id: 'eu-central', name: 'EU Central', lat: 50.0, lng: 10.0, size: 0.7, hash: '18%' },
  { id: 'china', name: 'China', lat: 35.0, lng: 105.0, size: 0.5, hash: '8%' },
  { id: 'russia', name: 'Russia', lat: 55.0, lng: 73.0, size: 0.4, hash: '6%' },
  { id: 'southeast-asia', name: 'SE Asia', lat: 5.0, lng: 105.0, size: 0.5, hash: '7%' },
  { id: 'latam', name: 'Latin America', lat: -15.0, lng: -55.0, size: 0.35, hash: '4%' },
  { id: 'middle-east', name: 'Middle East', lat: 25.0, lng: 50.0, size: 0.3, hash: '3%' },
  { id: 'iceland', name: 'Iceland', lat: 64.5, lng: -19.0, size: 0.25, hash: '2%' },
  { id: 'japan-korea', name: 'Japan/Korea', lat: 36.0, lng: 135.0, size: 0.45, hash: '5%' },
]

export const FLOW_ROUTES = [
  { from: 'nyc', to: 'london', asset: 'equities', volume: 0.9 },
  { from: 'london', to: 'frankfurt', asset: 'equities', volume: 0.7 },
  { from: 'tokyo', to: 'hongkong', asset: 'crypto', volume: 0.8 },
  { from: 'nyc', to: 'tokyo', asset: 'forex', volume: 0.85 },
  { from: 'london', to: 'dubai', asset: 'commodities', volume: 0.6 },
  { from: 'singapore', to: 'shanghai', asset: 'crypto', volume: 0.75 },
  { from: 'zurich', to: 'nyc', asset: 'equities', volume: 0.7 },
  { from: 'chicago', to: 'london', asset: 'commodities', volume: 0.65 },
  { from: 'hongkong', to: 'sydney', asset: 'forex', volume: 0.5 },
  { from: 'miami', to: 'saopaulo', asset: 'crypto', volume: 0.55 },
  { from: 'seoul', to: 'tokyo', asset: 'crypto', volume: 0.6 },
  { from: 'paris', to: 'nyc', asset: 'equities', volume: 0.7 },
  { from: 'mumbai', to: 'singapore', asset: 'forex', volume: 0.5 },
  { from: 'amsterdam', to: 'london', asset: 'equities', volume: 0.55 },
  { from: 'stockholm', to: 'frankfurt', asset: 'equities', volume: 0.4 },
  { from: 'la', to: 'tokyo', asset: 'crypto', volume: 0.65 },
  { from: 'toronto', to: 'nyc', asset: 'equities', volume: 0.6 },
  { from: 'dubai', to: 'mumbai', asset: 'commodities', volume: 0.5 },
  { from: 'shanghai', to: 'la', asset: 'crypto', volume: 0.7 },
  { from: 'singapore', to: 'sydney', asset: 'forex', volume: 0.45 },
]

export const ASSET_COLORS = {
  crypto: '#f59e0b',
  equities: '#3b82f6',
  commodities: '#d4a017',
  forex: '#10b981',
}

export const MARKET_SESSIONS = [
  { id: 'asia', label: 'Asia', openUTC: 0, closeUTC: 8, cities: ['tokyo', 'hongkong', 'shanghai', 'singapore', 'seoul', 'sydney'] },
  { id: 'europe', label: 'Europe', openUTC: 7, closeUTC: 16, cities: ['london', 'frankfurt', 'paris', 'zurich', 'amsterdam', 'stockholm'] },
  { id: 'us', label: 'US', openUTC: 13, closeUTC: 21, cities: ['nyc', 'chicago', 'la', 'toronto', 'miami'] },
  { id: 'crypto', label: 'Crypto', openUTC: 0, closeUTC: 24, cities: [] },
]

export function isSessionOpen(session) {
  const utcHour = new Date().getUTCHours()
  if (session.closeUTC === 24) return true
  if (session.openUTC < session.closeUTC) {
    return utcHour >= session.openUTC && utcHour < session.closeUTC
  }
  return utcHour >= session.openUTC || utcHour < session.closeUTC
}

export const LAYERS = [
  { id: 'flows', label: 'Capital Flows' },
  { id: 'exchanges', label: 'Exchanges' },
  { id: 'whales', label: 'Whale Alerts' },
  { id: 'sentiment', label: 'Sentiment' },
]

/* ── Exchange nodes — real locations, real-time volume from WebSockets ── */
export const EXCHANGE_NODES = [
  { id: 'binance', name: 'Binance', lat: 25.2, lng: 55.3, color: '#F0B90B', region: 'Dubai' },
  { id: 'okx', name: 'OKX', lat: 22.3, lng: 114.2, color: '#ffffff', region: 'Hong Kong' },
  { id: 'bybit', name: 'Bybit', lat: 1.3, lng: 103.8, color: '#f7a600', region: 'Singapore' },
  { id: 'kraken', name: 'Kraken', lat: 37.8, lng: -122.4, color: '#5741d9', region: 'San Francisco' },
  { id: 'coinbase', name: 'Coinbase', lat: 40.7, lng: -74.0, color: '#0052ff', region: 'New York' },
]

// 2026-05-26 beta-quality fix: removed Math.random()-based generateWhaleAlert.
// Was fabricating "$2.5B BTC moved from Binance to Kraken" alerts every 8s with no upstream feed.
// Caller (world-page) now renders empty state until /v1/intelligence/whale-tracker is wired.
export function generateWhaleAlert() {
  return null
}

// 2026-05-26 beta-quality fix: removed hardcoded country macro scores.
// Was displaying frozen sentiment numbers (72/45/58...) as live stress indicators.
export const MACRO_SCORES = []

/* ── Country regions for click-to-inspect ── */
export const COUNTRY_REGIONS = [
  { id: 'us', name: 'United States', lat: 39.8, lng: -98.5, gdp: '$25.5T', markets: 'NYSE, NASDAQ', crypto: 'High adoption', sentiment: 68 },
  { id: 'uk', name: 'United Kingdom', lat: 55.4, lng: -3.4, gdp: '$3.1T', markets: 'LSE', crypto: 'Regulated', sentiment: 55 },
  { id: 'germany', name: 'Germany', lat: 51.2, lng: 10.4, gdp: '$4.1T', markets: 'XETRA', crypto: 'Growing', sentiment: 41 },
  { id: 'france', name: 'France', lat: 46.6, lng: 2.2, gdp: '$2.8T', markets: 'Euronext Paris', crypto: 'Moderate', sentiment: 48 },
  { id: 'japan', name: 'Japan', lat: 36.2, lng: 138.3, gdp: '$4.2T', markets: 'TSE', crypto: 'Progressive', sentiment: 52 },
  { id: 'china', name: 'China', lat: 35.9, lng: 104.2, gdp: '$17.7T', markets: 'SSE, SZSE', crypto: 'Restricted', sentiment: 35 },
  { id: 'india', name: 'India', lat: 20.6, lng: 79.0, gdp: '$3.4T', markets: 'NSE, BSE', crypto: 'Taxed', sentiment: 62 },
  { id: 'brazil', name: 'Brazil', lat: -14.2, lng: -51.9, gdp: '$1.9T', markets: 'B3', crypto: 'Growing', sentiment: 40 },
  { id: 'australia', name: 'Australia', lat: -25.3, lng: 133.8, gdp: '$1.5T', markets: 'ASX', crypto: 'Regulated', sentiment: 55 },
  { id: 'uae', name: 'UAE', lat: 23.4, lng: 53.8, gdp: '$0.5T', markets: 'DFM, ADX', crypto: 'Hub', sentiment: 78 },
  { id: 'korea', name: 'South Korea', lat: 35.9, lng: 127.8, gdp: '$1.7T', markets: 'KRX', crypto: 'High adoption', sentiment: 58 },
  { id: 'singapore', name: 'Singapore', lat: 1.3, lng: 103.8, gdp: '$0.4T', markets: 'SGX', crypto: 'Hub', sentiment: 72 },
  { id: 'canada', name: 'Canada', lat: 56.1, lng: -106.3, gdp: '$2.0T', markets: 'TSX', crypto: 'ETFs approved', sentiment: 60 },
  { id: 'switzerland', name: 'Switzerland', lat: 46.8, lng: 8.2, gdp: '$0.8T', markets: 'SIX', crypto: 'Crypto Valley', sentiment: 70 },
  { id: 'russia', name: 'Russia', lat: 61.5, lng: 105.3, gdp: '$1.8T', markets: 'MOEX', crypto: 'Mining hub', sentiment: 30 },
  { id: 'mexico', name: 'Mexico', lat: 23.6, lng: -102.5, gdp: '$1.3T', markets: 'BMV', crypto: 'Emerging', sentiment: 45 },
  { id: 'nigeria', name: 'Nigeria', lat: 9.1, lng: 8.7, gdp: '$0.5T', markets: 'NGX', crypto: 'P2P leader', sentiment: 65 },
  { id: 'indonesia', name: 'Indonesia', lat: -0.8, lng: 113.9, gdp: '$1.2T', markets: 'IDX', crypto: 'Growing', sentiment: 50 },
]

export const EARTH_TEXTURES = {
  dark: 'https://unpkg.com/three-globe@2.41.12/example/img/earth-dark.jpg',
  night: 'https://unpkg.com/three-globe@2.41.12/example/img/earth-night.jpg',
  topology: 'https://unpkg.com/three-globe@2.41.12/example/img/earth-topology.png',
  blue: 'https://unpkg.com/three-globe@2.41.12/example/img/earth-blue-marble.jpg',
}
