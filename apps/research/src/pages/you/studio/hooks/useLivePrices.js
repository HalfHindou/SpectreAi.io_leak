/**
 * useLivePrices — Shared simulated price feed for Studio stickers
 *
 * Module-level singleton: all components calling this hook see the
 * same prices, change%, and 24h history. Updates every 3 seconds
 * via random walk simulation.
 *
 * Usage:
 *   const { prices, history, getTokenColor, formatPrice } = useLivePrices()
 *   prices['BTC']      => { price: 97241.50, change24h: 2.14, prevPrice: 97180.22 } (USD)
 *   history['BTC']     => [97100, 97120, ...] (50 numbers, USD)
 *   getTokenColor('BTC') => '#F7931A'
 *   formatPrice(97241) => '$97,241.00' / '€89,000.00' / '¥14,500,000' (currency-aware)
 *
 * Prices and history are stored as USD numbers. `formatPrice` from the hook
 * delegates to the I18nCurrencyContext `fmtPrice` formatter, which handles both
 * FX conversion and symbol/locale formatting. The named export `formatPrice`
 * below is the legacy USD-only helper, retained for backward compatibility.
 */
import { useState, useEffect } from 'react'
import { useCurrency } from '@/contexts/I18nCurrencyContext'

/* ── Base data ──────────────────────────────────────── */

const BASE_PRICES = {
  BTC: 97241, ETH: 3280, SOL: 182, AVAX: 38.5, DOGE: 0.32,
  ADA: 0.68,  DOT: 8.9,  LINK: 18.4, MATIC: 0.92, XRP: 2.45,
}

const TOKEN_COLORS = {
  BTC: '#F7931A', ETH: '#627EEA', SOL: '#00D18C', AVAX: '#E84142',
  DOGE: '#C2A633', ADA: '#0033AD', DOT: '#E6007A', LINK: '#2A5ADA',
  MATIC: '#8247E5', XRP: '#00AAE4',
}

/* ── Module-level shared state ──────────────────────── */

let sharedPrices = null
let sharedHistory = null
let listeners = new Set()
let tickInterval = null

function initPrices() {
  sharedPrices = {}
  sharedHistory = {}
  Object.entries(BASE_PRICES).forEach(([token, base]) => {
    // Generate 24h history with gentle random walk
    const hist = []
    let p = base * (1 + (Math.random() - 0.5) * 0.04) // start ±2% from base
    for (let i = 0; i < 50; i++) {
      p *= 1 + (Math.random() - 0.5) * 0.004
      hist.push(p)
    }
    const current = hist[hist.length - 1]
    const open24h = hist[0]
    sharedPrices[token] = {
      price: current,
      change24h: ((current - open24h) / open24h) * 100,
      prevPrice: current,
    }
    sharedHistory[token] = hist
  })
}

function tick() {
  if (!sharedPrices) return
  Object.keys(sharedPrices).forEach(token => {
    const prev = sharedPrices[token].price
    // Random walk: ±0.05% per tick
    const next = prev * (1 + (Math.random() - 0.5) * 0.001)
    // Drift change24h slowly
    const newChange = sharedPrices[token].change24h + (Math.random() - 0.5) * 0.08
    sharedPrices[token] = {
      price: next,
      change24h: Math.max(-15, Math.min(15, newChange)),
      prevPrice: prev,
    }
    // Shift history window
    sharedHistory[token] = [...sharedHistory[token].slice(1), next]
  })
  // Notify all subscribers
  listeners.forEach(fn => fn())
}

function subscribe(fn) {
  if (!sharedPrices) initPrices()
  listeners.add(fn)
  if (!tickInterval) {
    tickInterval = setInterval(tick, 3000)
  }
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && tickInterval) {
      clearInterval(tickInterval)
      tickInterval = null
    }
  }
}

/* ── Hook ───────────────────────────────────────────── */

export default function useLivePrices() {
  const [, forceUpdate] = useState(0)
  const { fmtPrice } = useCurrency() || {}

  useEffect(() => {
    return subscribe(() => forceUpdate(n => n + 1))
  }, [])

  // Ensure initialised for first render
  if (!sharedPrices) initPrices()

  // Currency-aware price formatter. Prices are stored as USD numbers; `fmtPrice`
  // handles FX conversion + symbol + locale based on the user's currency setting.
  // Falls back to the legacy USD-only helper if the currency context is missing
  // (e.g., when the hook is rendered outside the provider tree in tests).
  const formatPrice = fmtPrice
    ? (usdValue) => fmtPrice(usdValue)
    : (usdValue) => `$${formatPriceUsd(usdValue)}`

  return {
    prices: sharedPrices,
    history: sharedHistory,
    getTokenColor: (token) => TOKEN_COLORS[token] || '#8b5cf6',
    formatPrice,
  }
}

/* ── Utility exports ────────────────────────────────── */

export { TOKEN_COLORS, BASE_PRICES }

/**
 * Legacy USD-only price formatter. Returns a raw number string with NO currency
 * symbol (callers historically prepended `$` in JSX). New code should use the
 * `formatPrice` returned by `useLivePrices()`, which is currency-aware.
 *
 * Kept as a named export for backward compatibility. Prefer the hook version.
 */
export function formatPrice(price) {
  return formatPriceUsd(price)
}

function formatPriceUsd(price) {
  if (price >= 100) return price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (price >= 0.01) return price.toFixed(4)
  return price.toFixed(6)
}
