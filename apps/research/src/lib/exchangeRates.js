const CACHE_TTL = 15 * 60 * 1000 // 15 minutes
const LS_KEY = 'spectre-exchange-rates'

const FALLBACK_RATES = {
  usd: 1,
  eur: 0.92,
  gbp: 0.79,
  jpy: 150,
  cad: 1.36,
  aud: 1.54,
  chf: 0.88,
  cny: 7.24,
  inr: 83.4,
  brl: 4.97,
  krw: 1330,
  rub: 92,
  try: 34.5,
  pln: 4.05,
  uah: 41.5,
  idr: 16500,
  vnd: 25400,
  thb: 36.2,
  php: 58.0,
  mxn: 19.8,
  aed: 3.67,
}

let cache = { rates: null, ts: 0 }

function loadFromStorage() {
  try {
    const stored = localStorage.getItem(LS_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed.rates && parsed.ts) return parsed
    }
  } catch {}
  return null
}

function saveToStorage(rates) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ rates, ts: Date.now() }))
  } catch {}
}

export async function fetchExchangeRates() {
  if (cache.rates && Date.now() - cache.ts < CACHE_TTL) {
    return cache.rates
  }

  try {
    // Local Vite dev often runs without the serverless `/api/coingecko` proxy.
    // Avoid a route-wide 500 on every page load; production still uses live rates.
    if (import.meta.env.DEV) {
      const stored = loadFromStorage()
      if (stored?.rates) {
        cache = stored
        return stored.rates
      }
      cache = { rates: FALLBACK_RATES, ts: Date.now() }
      return FALLBACK_RATES
    }

    const currencies = 'eur,gbp,jpy,cad,aud,chf,cny,inr,brl,krw,rub,try,pln,uah,idr,vnd,thb,php,mxn,aed'
    const res = await fetch(`/api/coingecko/simple/price?ids=tether&vs_currencies=usd,${currencies}`)
    if (!res.ok) throw new Error('Rate fetch failed')
    const data = await res.json()
    const tether = data.tether || data.TETHER || {}
    const rates = { usd: 1 }
    for (const [key, val] of Object.entries(tether)) {
      rates[key.toLowerCase()] = val
    }
    cache = { rates, ts: Date.now() }
    saveToStorage(rates)
    return rates
  } catch (err) {
    // silently handled - using fallback
    const stored = loadFromStorage()
    if (stored?.rates) {
      cache = stored
      return stored.rates
    }
    cache = { rates: FALLBACK_RATES, ts: Date.now() }
    return FALLBACK_RATES
  }
}

export function getRate(currencyCode, rates) {
  if (!rates || currencyCode === 'USD') return 1
  return rates[currencyCode.toLowerCase()] || 1
}
