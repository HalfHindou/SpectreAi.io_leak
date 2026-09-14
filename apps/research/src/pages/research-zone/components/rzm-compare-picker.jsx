import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import { SYMBOL_TO_COINGECKO_ID, COINGECKO_LOGOS } from '@/constants/majorTokens'
import { searchCoinsForROI } from '@/services/coinGeckoApi'
import './rzm-compare-picker.css'

// Mobile compare picker — bottom sheet variant of rz-compare-picker.jsx.
// Same data source (searchCoinsForROI + quick picks), reshaped for touch:
// full-width slide-up sheet, 48px rows, no keyboard-nav chrome.

const QUICK_PICKS = [
  { symbol: 'BTC', name: 'Bitcoin', cgId: 'bitcoin', id: 'bitcoin', large: COINGECKO_LOGOS.BTC, thumb: COINGECKO_LOGOS.BTC, rank: 1 },
  { symbol: 'ETH', name: 'Ethereum', cgId: 'ethereum', id: 'ethereum', large: COINGECKO_LOGOS.ETH, thumb: COINGECKO_LOGOS.ETH, rank: 2 },
  { symbol: 'SOL', name: 'Solana', cgId: 'solana', id: 'solana', large: COINGECKO_LOGOS.SOL, thumb: COINGECKO_LOGOS.SOL, rank: 5 },
  { symbol: 'BNB', name: 'BNB', cgId: 'binancecoin', id: 'binancecoin', large: COINGECKO_LOGOS.BNB, thumb: COINGECKO_LOGOS.BNB, rank: 4 },
  { symbol: 'XRP', name: 'XRP', cgId: 'ripple', id: 'ripple', large: COINGECKO_LOGOS.XRP, thumb: COINGECKO_LOGOS.XRP, rank: 3 },
  { symbol: 'DOGE', name: 'Dogecoin', cgId: 'dogecoin', id: 'dogecoin', large: COINGECKO_LOGOS.DOGE, thumb: COINGECKO_LOGOS.DOGE, rank: 8 },
]

function ResultRow({ token, baseUpper, onPick }) {
  const sym = (token.symbol || '').toUpperCase()
  const tc = TOKEN_ROW_COLORS[sym]
  const logo = token.large || token.thumb || token.image
  const rank = Number.isFinite(token.rank) ? token.rank : null
  return (
    <button
      type="button"
      className="rzcp-row"
      onClick={() => onPick(token)}
    >
      <span
        className="rzcp-logo"
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
                span.className = 'rzcp-logo-letter'
                span.textContent = sym.charAt(0).toUpperCase()
                parent.appendChild(span)
              }
            }}
          />
        ) : (
          <span className="rzcp-logo-letter">{sym.charAt(0)}</span>
        )}
      </span>
      <span className="rzcp-meta">
        <span className="rzcp-name">{token.name || sym}</span>
        <span className="rzcp-sub">
          <span className="rzcp-sym">{sym}</span>
          {rank != null && (
            <>
              <span className="rzcp-dot">·</span>
              <span className="rzcp-rank">#{rank}</span>
            </>
          )}
        </span>
      </span>
    </button>
  )
}

export default function RzmComparePicker({ open, baseSymbol, onPick, onClose, dayMode = false }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  // Reset + focus on open
  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    // small delay so the sheet-in transition doesn't fight the keyboard
    const id = setTimeout(() => inputRef.current?.focus(), 260)
    return () => clearTimeout(id)
  }, [open])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Body-scroll lock while open (match the other RZ mobile sheets)
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

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
          .slice(0, 12)
        setResults(filtered)
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
  }

  if (!open) return null

  const showResults = query.trim().length > 0
  const baseUpper = baseSymbol?.toUpperCase()
  const filteredQuickPicks = QUICK_PICKS.filter(p => p.symbol !== baseUpper)

  return createPortal(
    <div className={`rzcp-overlay${dayMode ? ' app app-day-mode' : ''}`} role="dialog" aria-label={t('researchPro.mcomparePicker.rzmcomparepicker.ariaCompareWithAnotherToken', "Compare with another token")}>
      <div className="rzcp-backdrop" onClick={() => onClose?.()} />
      <div className="rzcp-sheet">
        <div className="rzcp-grip" aria-hidden />
        <div className="rzcp-head">
          <span className="rzcp-head-title">
            Compare with{baseUpper ? ` ${baseUpper}` : ''}
          </span>
          <button type="button" className="rzcp-close" onClick={() => onClose?.()} aria-label={t('researchPro.mcomparePicker.rzmcomparepicker.ariaClose', "Close")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="rzcp-search">
          <svg className="rzcp-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            autoCapitalize="off"
            autoCorrect="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('researchPro.mcomparePicker.rzmcomparepicker.placeholderSearchAnyCoinBtcSuiDog', "Search any coin (BTC, sui, dogecoin…)")}
            maxLength={48}
          />
          {query && (
            <button type="button" className="rzcp-search-clear" onClick={() => setQuery('')} aria-label={t('researchPro.mcomparePicker.rzmcomparepicker.ariaClearSearch', "Clear search")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="rzcp-body">
          {showResults ? (
            <>
              {loading && results.length === 0 && (
                <div className="rzcp-skeletons">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="rzcp-skel-row">
                      <span className="rzcp-skel-logo animate-shimmer" />
                      <span className="rzcp-skel-lines">
                        <span className="rzcp-skel-line animate-shimmer" />
                        <span className="rzcp-skel-line rzcp-skel-line--sm animate-shimmer" />
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!loading && results.length === 0 && (
                <div className="rzcp-empty">No matches for “{query.trim()}”</div>
              )}
              {results.map((c) => (
                <ResultRow key={c.id || c.symbol} token={c} baseUpper={baseUpper} onPick={handlePick} />
              ))}
            </>
          ) : (
            <>
              <div className="rzcp-label">{t('researchPro.mcomparePicker.rzmcomparepicker.quickPicks', "Quick picks")}</div>
              {filteredQuickPicks.map((c) => (
                <ResultRow key={c.id || c.symbol} token={c} baseUpper={baseUpper} onPick={handlePick} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
