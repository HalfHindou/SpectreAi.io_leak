import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import { SYMBOL_TO_COINGECKO_ID, COINGECKO_LOGOS } from '@/constants/majorTokens'
import { searchCoinsForROI } from '@/services/coinGeckoApi'
import './rz-compare-picker.css'

const QUICK_PICKS = [
  { symbol: 'BTC', name: 'Bitcoin', cgId: 'bitcoin', id: 'bitcoin', large: COINGECKO_LOGOS.BTC, thumb: COINGECKO_LOGOS.BTC, rank: 1 },
  { symbol: 'ETH', name: 'Ethereum', cgId: 'ethereum', id: 'ethereum', large: COINGECKO_LOGOS.ETH, thumb: COINGECKO_LOGOS.ETH, rank: 2 },
  { symbol: 'SOL', name: 'Solana', cgId: 'solana', id: 'solana', large: COINGECKO_LOGOS.SOL, thumb: COINGECKO_LOGOS.SOL, rank: 5 },
  { symbol: 'BNB', name: 'BNB', cgId: 'binancecoin', id: 'binancecoin', large: COINGECKO_LOGOS.BNB, thumb: COINGECKO_LOGOS.BNB, rank: 4 },
  { symbol: 'XRP', name: 'XRP', cgId: 'ripple', id: 'ripple', large: COINGECKO_LOGOS.XRP, thumb: COINGECKO_LOGOS.XRP, rank: 3 },
  { symbol: 'DOGE', name: 'Dogecoin', cgId: 'dogecoin', id: 'dogecoin', large: COINGECKO_LOGOS.DOGE, thumb: COINGECKO_LOGOS.DOGE, rank: 8 },
]

const POP_WIDTH = 320

export default function RzComparePicker({ open, anchorRect, baseSymbol, onPick, onClose }) {
  const { t } = useTranslation()
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const popRef = useRef(null)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  // Position popover
  useLayoutEffect(() => {
    if (!open || !anchorRect) return
    const margin = 8
    let left = anchorRect.left
    if (left + POP_WIDTH > window.innerWidth - margin) left = window.innerWidth - POP_WIDTH - margin
    if (left < margin) left = margin
    const top = anchorRect.bottom + 8
    setPos({ top, left })
  }, [open, anchorRect])

  // Reset on open
  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setActiveIdx(0)
    const id = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(id)
  }, [open])

  // Outside click + Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!popRef.current?.contains(e.target)) onClose?.() }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    const id = setTimeout(() => {
      window.addEventListener('mousedown', onDown)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(id)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // Debounced search (no price hydration — keeps CG calls minimal)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 1) { setResults([]); setLoading(false); return }
    setLoading(true)
    let cancelled = false
    debounceRef.current = setTimeout(async () => {
      try {
        const list = await searchCoinsForROI(q)
        if (cancelled) return
        const baseUpper = (baseSymbol || '').toUpperCase()
        const filtered = (list || [])
          .filter(c => c.symbol && c.symbol.toUpperCase() !== baseUpper)
          .slice(0, 8)
        setResults(filtered)
        setActiveIdx(0)
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, baseSymbol])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => Math.min(results.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        if (results[activeIdx]) {
          e.preventDefault()
          handlePick(results[activeIdx])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, results, activeIdx])

  const handlePick = (token) => {
    if (!token) return
    const symbol = (token.symbol || '').toUpperCase()
    if (!symbol || symbol === baseSymbol?.toUpperCase()) return
    onPick?.({
      symbol,
      cgId: token.cgId || token.id || SYMBOL_TO_COINGECKO_ID[symbol] || null,
      name: token.name || null,
      logo: token.large || token.thumb || token.image || null,
    })
    setQuery('')
  }

  const fmtPrice = (p) => {
    if (!Number.isFinite(p)) return null
    if (Math.abs(p) >= 1000) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    if (Math.abs(p) >= 1) return `$${p.toFixed(2)}`
    if (Math.abs(p) >= 0.01) return `$${p.toFixed(4)}`
    if (Math.abs(p) >= 0.0001) return `$${p.toFixed(6)}`
    return `$${p.toExponential(2)}`
  }

  const fmtPct = (v) => {
    if (!Number.isFinite(v)) return null
    const sign = v >= 0 ? '+' : ''
    return `${sign}${v.toFixed(2)}%`
  }

  if (!open) return null

  const showResults = query.trim().length > 0
  const baseUpper = baseSymbol?.toUpperCase()
  const filteredQuickPicks = QUICK_PICKS.filter(p => p.symbol !== baseUpper)

  return createPortal(
    <div
      ref={popRef}
      className="rz-cmp-pop"
      style={{ top: pos.top, left: pos.left, width: POP_WIDTH }}
      role="dialog"
      aria-label={t('researchPro.comparePicker.rzcomparepicker.ariaCompareWith', "Compare with")}
    >
      <div className="rz-cmp-pop-search">
        <svg className="rz-cmp-pop-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('researchPro.comparePicker.rzcomparepicker.placeholderSearchAnyCoinBtcDogecoin', "Search any coin (BTC, dogecoin, sui…)")}
          maxLength={48}
        />
        {query && (
          <button type="button" className="rz-cmp-pop-clear" onClick={() => setQuery('')} aria-label={t('researchPro.comparePicker.rzcomparepicker.ariaClear', "Clear")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {showResults ? (
        <div className="rz-cmp-pop-results">
          {loading && results.length === 0 && (
            <div className="rz-cmp-pop-empty">Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="rz-cmp-pop-empty">No matches for “{query}”</div>
          )}
          {results.map((c, idx) => {
            const sym = (c.symbol || '').toUpperCase()
            const tc = TOKEN_ROW_COLORS[sym]
            const isActive = idx === activeIdx
            const logo = c.large || c.thumb
            const priceStr = fmtPrice(c.price)
            const pctStr = fmtPct(c.change24h)
            const pctClass = Number.isFinite(c.change24h)
              ? (c.change24h >= 0 ? 'rz-cmp-pop-up' : 'rz-cmp-pop-down')
              : ''
            return (
              <button
                key={c.id || sym}
                type="button"
                className={`rz-cmp-pop-result${isActive ? ' rz-cmp-pop-result--active' : ''}`}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => handlePick(c)}
              >
                <span
                  className="rz-cmp-pop-logo"
                  style={tc ? { background: `rgba(${tc.bg}, 0.15)` } : undefined}
                >
                  {logo ? (
                    <img
                      src={logo}
                      alt=""
                      onError={(e) => {
                        e.target.onerror = null
                        e.target.style.display = 'none'
                        e.target.parentElement?.classList.add('rz-cmp-pop-logo--fallback')
                      }}
                    />
                  ) : (
                    <span className="rz-cmp-pop-logo-letter">{sym.charAt(0)}</span>
                  )}
                </span>
                <span className="rz-cmp-pop-meta">
                  <span className="rz-cmp-pop-row1">
                    <span className="rz-cmp-pop-name">{c.name || sym}</span>
                    {Number.isFinite(c.rank) && (
                      <span className="rz-cmp-pop-rank mono">#{c.rank}</span>
                    )}
                  </span>
                  <span className="rz-cmp-pop-row2">
                    <span className="rz-cmp-pop-sym">{sym}</span>
                    {priceStr && (
                      <>
                        <span className="rz-cmp-pop-dot">·</span>
                        <span className="rz-cmp-pop-price mono">{priceStr}</span>
                      </>
                    )}
                    {pctStr && (
                      <span className={`rz-cmp-pop-pct mono ${pctClass}`}>{pctStr}</span>
                    )}
                  </span>
                </span>
                {isActive && <span className="rz-cmp-pop-enter mono" aria-hidden>↵</span>}
              </button>
            )
          })}
        </div>
      ) : (
        <>
          <div className="rz-cmp-pop-title">{t('researchPro.comparePicker.rzcomparepicker.quickPicks', "Quick picks")}</div>
          <div className="rz-cmp-pop-results">
            {filteredQuickPicks.map((c) => {
              const sym = (c.symbol || '').toUpperCase()
              const tc = TOKEN_ROW_COLORS[sym]
              const logo = c.large || c.thumb
              const priceStr = fmtPrice(c.price)
              const pctStr = fmtPct(c.change24h)
              const pctClass = Number.isFinite(c.change24h)
                ? (c.change24h >= 0 ? 'rz-cmp-pop-up' : 'rz-cmp-pop-down')
                : ''
              return (
                <button
                  key={c.id || sym}
                  type="button"
                  className="rz-cmp-pop-result"
                  onClick={() => handlePick(c)}
                >
                  <span
                    className="rz-cmp-pop-logo"
                    style={tc ? { background: `rgba(${tc.bg}, 0.15)` } : undefined}
                  >
                    {logo ? (
                      <img
                        src={logo}
                        alt=""
                        onError={(e) => {
                          e.target.onerror = null
                          const parent = e.target.parentElement
                          e.target.remove()
                          if (parent) {
                            const span = document.createElement('span')
                            span.className = 'rz-cmp-pop-logo-letter'
                            span.textContent = sym.charAt(0).toUpperCase()
                            parent.appendChild(span)
                          }
                        }}
                      />
                    ) : (
                      <span className="rz-cmp-pop-logo-letter">{sym.charAt(0)}</span>
                    )}
                  </span>
                  <span className="rz-cmp-pop-meta">
                    <span className="rz-cmp-pop-row1">
                      <span className="rz-cmp-pop-name">{c.name || sym}</span>
                      {Number.isFinite(c.rank) && (
                        <span className="rz-cmp-pop-rank mono">#{c.rank}</span>
                      )}
                    </span>
                    <span className="rz-cmp-pop-row2">
                      <span className="rz-cmp-pop-sym">{sym}</span>
                      {priceStr && (
                        <>
                          <span className="rz-cmp-pop-dot">·</span>
                          <span className="rz-cmp-pop-price mono">{priceStr}</span>
                        </>
                      )}
                      {pctStr && (
                        <span className={`rz-cmp-pop-pct mono ${pctClass}`}>{pctStr}</span>
                      )}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}
