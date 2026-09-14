/**
 * useMarketRegime — fetches real-time market data for the
 * Market Context strip (SPY, VIX, BTC, ETH, Gold, Fear & Greed).
 * Refreshes every 5 minutes.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getSpectrePricesBySymbols } from '@/services/spectreMarketApi'
import { getFearGreedCurrent } from '@/services/fearGreedApi'
import { getPendingBundle } from './useCalendarBundle'
import { fetchCalendarJson } from './useCalendarData'

const REFRESH_MS = 5 * 60 * 1000

function defaultFmtPrice(p) {
  if (p == null) return '—'
  return p >= 1000
    ? '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : '$' + p.toFixed(2)
}

function fmtPct(c) {
  if (c == null) return ''
  return (c >= 0 ? '+' : '') + c.toFixed(1) + '%'
}

function dir(c) {
  if (c == null) return 'flat'
  return c > 0.15 ? 'up' : c < -0.15 ? 'down' : 'flat'
}

function weekRange() {
  const now = new Date()
  const d = now.getDay()
  const mon = new Date(now)
  mon.setDate(now.getDate() - (d === 0 ? 6 : d - 1))
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  const fmt = { month: 'short', day: 'numeric' }
  return `${mon.toLocaleDateString('en-US', fmt)}\u2013${fri.toLocaleDateString('en-US', fmt)}, ${now.getFullYear()}`
}

export default function useMarketRegime(opts = {}) {
  const fmtPrice = typeof opts.fmtPrice === 'function' ? opts.fmtPrice : defaultFmtPrice
  const enabled = opts.enabled !== false
  const [regime, setRegime] = useState(null)
  const mounted = useRef(true)
  // Verdict comes from the same /api/calendar/bundle the page already fetched.
  // Seed the FIRST load from it and skip the standalone /api/calendar/verdict
  // request; the 5-min poll still refreshes it via the standalone fetch.
  const verdictSeededRef = useRef(false)

  const fmtP = useCallback((v) => {
    if (v == null) return '—'
    return fmtPrice(v)
  }, [fmtPrice])

  const load = useCallback(async () => {
    try {
      // First load only: if the calendar bundle is in-flight/resolved, take the
      // verdict from it instead of firing a standalone /api/calendar/verdict.
      // Falls back to the standalone fetch when no bundle is available (the
      // bundle returned no verdict, or the hook is used off the calendar page).
      let seededVerdict = null
      if (!verdictSeededRef.current) {
        const pending = getPendingBundle()
        if (pending) {
          const bundleJson = await pending.catch(() => null)
          // bundle.verdict has the SAME shape as /api/calendar/verdict:
          // { verdict, sentiment, updatedAt, ... }. Use it directly.
          if (bundleJson?.verdict?.verdict) {
            seededVerdict = bundleJson.verdict
            verdictSeededRef.current = true
          }
        }
      }
      const skipStandaloneVerdict = seededVerdict != null

      const [cryptoRes, stocksRes, fgRes, statusRes, verdictRes] = await Promise.allSettled([
        getSpectrePricesBySymbols(['BTC', 'ETH']),
        // CL=F = WTI futures, DX-Y.NYB = dollar index — the stocks handler is
        // a Yahoo passthrough, so futures/index symbols work like tickers.
        fetch(`/api/stocks/quotes?symbols=${encodeURIComponent('SPY,GLD,CL=F,DX-Y.NYB')}`).then(r => r.json()).catch(() => ({})),
        getFearGreedCurrent(),
        fetch('/api/stocks/market-status').then(r => r.json()).catch(() => null),
        skipStandaloneVerdict
          ? Promise.resolve(seededVerdict)
          // Dedup the standalone verdict read (poll-refresh path) against any
          // concurrent calendar verdict fetch. Short TTL so the 5-min poll
          // still pulls fresh data — only mount-time/StrictMode dupes collapse.
          : fetchCalendarJson('/api/calendar/verdict', { ttl: 5000 }).catch(() => null),
      ])

      if (!mounted.current) return

      const crypto = cryptoRes.status === 'fulfilled' ? cryptoRes.value : {}
      const stocks = stocksRes.status === 'fulfilled' ? stocksRes.value : {}
      const fg = fgRes.status === 'fulfilled' ? fgRes.value : null
      const status = statusRes.status === 'fulfilled' ? statusRes.value : null
      const verdictData = verdictRes.status === 'fulfilled' ? verdictRes.value : null

      const btc = crypto?.BTC
      const eth = crypto?.ETH
      const spy = stocks?.SPY
      const gld = stocks?.GLD
      const wti = stocks?.['CL=F']
      const dxy = stocks?.['DX-Y.NYB']
      const vix = status?.vix

      setRegime({
        weekOf: weekRange(),
        columns: [
          {
            label: 'SPX & INDICES',
            primary: spy
              ? { symbol: 'SPY', value: fmtP(spy.price), direction: dir(spy.change), change: fmtPct(spy.change) }
              : { symbol: 'SPY', value: '—', direction: 'flat' },
            secondary: vix
              ? [{ symbol: 'VIX', value: String(vix.value), direction: dir(vix.change) }]
              : [],
            context: status?.status === 'OPEN' ? 'Market Open' : status?.status === 'CLOSED' ? 'Market Closed' : '',
          },
          {
            label: 'BTC & CRYPTO',
            primary: btc
              ? { symbol: 'BTC', value: fmtP(btc.price), direction: dir(btc.change24h), change: fmtPct(btc.change24h) }
              : { symbol: 'BTC', value: '—', direction: 'flat' },
            secondary: eth
              ? [{ symbol: 'ETH', value: fmtP(eth.price), direction: dir(eth.change24h) }]
              : [],
            context: fg ? `F&G: ${fg.value} ${fg.classification}` : '',
          },
          {
            label: 'GOLD',
            primary: gld
              ? { symbol: 'GLD', value: fmtP(gld.price), direction: dir(gld.change), change: fmtPct(gld.change) }
              : { symbol: 'GLD', value: '—', direction: 'flat' },
            secondary: [],
            context: '',
          },
          // Oil + dollar — the geopolitics/energy tape (Sunny 2026-06-11:
          // "iran war is big... one more box, ppl need it on a platter").
          {
            label: 'OIL & DOLLAR',
            primary: wti
              ? { symbol: 'WTI', value: fmtP(wti.price), direction: dir(wti.change), change: fmtPct(wti.change) }
              : { symbol: 'WTI', value: '—', direction: 'flat' },
            secondary: dxy
              ? [{ symbol: 'DXY', value: Number(dxy.price).toFixed(2), direction: dir(dxy.change) }]
              : [],
            context: '',
          },
        ],
        verdict: verdictData?.verdict || null,
        verdictSentiment: verdictData?.sentiment || null,
        verdictUpdatedAt: verdictData?.updatedAt || null,
      })
    } catch (err) {
      // silently handled
    }
  }, [fmtP])

  useEffect(() => {
    mounted.current = true
    if (enabled) load()
    return () => { mounted.current = false }
  }, [enabled, load])

  useAdaptivePolling(load, { interval: REFRESH_MS, enabled })

  return regime
}
