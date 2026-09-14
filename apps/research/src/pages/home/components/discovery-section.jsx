/**
 * DiscoverySection - filter tabs + on-chain/predictions/top-coins lists + pagination.
 * Extracted from WelcomePage for maintainability.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import lazy from '@/lib/lazy-with-retry'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import useSettingsStore from '@/store/useSettingsStore'
import { getPathForPageId } from '@/constants/pageRoutes'
import { hoverIntent, allowDataPrefetch, prefetchRoute } from '@/lib/route-prefetch'
import { prewarmResearchZone } from '@/lib/rz-prewarm'
import GlassSelect from './glass-select'
import Sparkline from './sparkline'
import ChartPanel from './chart-panel'
import ShareXButton from '@/components/share-x-button'
import ShareXModal from '@/components/share-x-modal'
import { renderShareCard, preloadLogos, truncateText, drawSparkline, generateSparkline as shareGenSparkline, formatLargeNumber, drawCardDivider, getSpectreLogo, FONT, FONT_MONO, CARD_PAD } from '@/lib/shareToX'
import { TOKEN_LOGOS, CHAIN_LOGOS, ONCHAIN_CHAINS, ONCHAIN_TIMEFRAMES, PREDICTIONS_CATEGORIES, COIN_DESCRIPTIONS, AI_AGENT_CATEGORIES, AI_AGENT_LOGOS, AI_MODEL_CATEGORIES, AI_MODEL_PROVIDERS, AI_MODEL_QUALITY_TIERS, PROVIDER_COLORS, AI_PROVIDER_LOGOS, TOPCOINS_CHAINS } from './welcome-page-constants'
import { formatChange, getTokenInitials, getHistorySparkline } from './welcome-page-helpers'
import { generateSeededSparkline } from '@/utils/sparkline'
import { decodeHtmlEntities } from '@/utils/html'
import WarRoomTab from './WarRoomTab'
import MobileTokenList from './mobile-token-list'
import MobilePagination from '@/components/mobile-pagination'
// Lazy-mounted (Social tab only) so the reused /x-dash table + its 408KB CSS
// stay off the landing boot chunk.
const SocialMindshareSection = lazy(() => import('./social-mindshare-section'))

// Defense-in-depth: drop synthetic/dust tokens (`IONX_0X5F70`, numeric-suffix dust,
// nonsense pct_change, sub-$1M mcap, image-less zero-price rows) before they
// hit the trending lists. Backend filters are being added in parallel.
// On-Chain timeframe → change column it ranks by (Gainers/Losers + col highlight)
const ONCHAIN_TF_COLUMN = { '5m': 'change5m', '1h': 'change1h', '4h': 'change4h', '24h': 'change24h' }

function isDustOnchainRow(t) {
  if (!t) return true
  const sym = String(t.symbol || '').toUpperCase()
  if (/^[A-Z0-9]+_0[Xx][A-F0-9]+$/.test(sym)) return true
  if (/^[A-Z0-9]+_[0-9]{4,}$/.test(sym)) return true
  if (/[぀-ゟ゠-ヿ一-鿿]/.test(sym)) return true
  const mcap = Number(t.mcap ?? t.market_cap ?? 0)
  // A >100% day is usually a fabricated number on a synthetic row - but not
  // always. On a memecoin chain (Robinhood) a 3x on $250k+ of real pooled
  // liquidity behind a $1M+ cap is a move someone could actually have traded,
  // and blanket-dropping it deleted the day's genuine runners from the board.
  // So the rule now needs the row to ALSO lack credible depth.
  const pct = Number(t.change24h ?? t.price_change_percentage_24h ?? 0)
  const tradableDepth = Number(t.liquidity ?? 0) >= 250_000 && mcap >= 1_000_000
  if (Number.isFinite(pct) && Math.abs(pct) > 100 && !tradableDepth) return true
  if (Number.isFinite(mcap) && mcap > 0 && mcap < 1_000_000) return true
  if (Number.isFinite(mcap) && mcap > 1e14) return true // INT64-overflow sentinel
  const price = Number(t.price ?? t.current_price ?? 0)
  if (Number.isFinite(price) && price === 0) return true
  // Wash / synthetic volume: bots cycle the same thin pool so 24h volume dwarfs
  // liquidity. Real DEX tokens top out ~100x vol/liq; the fake Solana-trending
  // clusters run 400-750x (e.g. $11M volume on $16k liquidity). Also strip a
  // large mcap fabricated on dust liquidity ($300M "mcap", $16k pool). Only
  // when liquidity is known — the bridge falls liquidity back to volume (ratio
  // 1) when missing, so this never fires on a genuine no-liquidity-data row.
  const vol = Number(t.volume ?? t.volume24h ?? t.volume24 ?? 0)
  const liq = Number(t.liquidity ?? 0)
  if (Number.isFinite(liq) && liq > 0) {
    if (Number.isFinite(vol) && vol > 0 && vol / liq > 300) return true
    if (Number.isFinite(mcap) && mcap > 20_000_000 && mcap / liq > 6000) return true
  }
  return false
}

function PageJump({ currentPage, maxPage, disabled, onJump, t }) {
  const [val, setVal] = useState(String(currentPage))
  useEffect(() => { setVal(String(currentPage)) }, [currentPage])
  const commit = () => {
    const n = parseInt(val, 10)
    if (!Number.isFinite(n)) { setVal(String(currentPage)); return }
    const clamped = maxPage ? Math.min(maxPage, Math.max(1, n)) : Math.max(1, n)
    if (clamped !== currentPage) onJump(clamped)
    setVal(String(clamped))
  }
  return (
    <form
      className="topcoins-pagination-jump"
      onSubmit={(e) => { e.preventDefault(); commit() }}
    >
      <span className="topcoins-pagination-jump-label">{t('discovery.goTo', 'Go to')}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="topcoins-pagination-jump-input"
        value={val}
        onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        disabled={disabled}
        aria-label={t('discovery.goToPage', 'Go to page')}
      />
    </form>
  )
}

function PageSizeSelect({ value, options, onChange, disabled, t }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div className="topcoins-pagination-size" ref={ref}>
      <span className="topcoins-pagination-size-label">{t('discovery.show', 'Show')}</span>
      <button
        type="button"
        className={`topcoins-pagination-size-trigger${open ? ' is-open' : ''}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{value}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <ul className="topcoins-pagination-size-menu" role="listbox">
          {options.map((n) => (
            <li key={n}>
              <button
                type="button"
                role="option"
                aria-selected={n === value}
                className={`topcoins-pagination-size-option${n === value ? ' is-active' : ''}`}
                onClick={() => { onChange(n); setOpen(false) }}
              >
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Top Coins toolbar — chain select, range filters, column chooser
// ═══════════════════════════════════════════════════════════════════════════

// Customizable table columns (canonical order). `label` receives t.
const TOPCOIN_COLUMN_DEFS = [
  { id: 'price', label: (t) => t('topSection.price'), sort: 'price', th: 'th-price' },
  { id: 'change1h', label: () => '1H', sort: 'change1h', th: 'th-change' },
  { id: 'change24h', label: (t) => t('topSection.change24h'), sort: 'change', th: 'th-change' },
  { id: 'change7d', label: () => '7D', sort: 'change7d', th: 'th-change' },
  { id: 'change30d', label: () => '30D', sort: 'change30d', th: 'th-change' },
  { id: 'change1y', label: () => '1Y', sort: 'change1y', th: 'th-change' },
  { id: 'marketCap', label: (t) => t('topSection.marketCap'), sort: 'marketCap', th: 'th-mcap' },
  { id: 'fdv', label: () => 'FDV', sort: 'fdv', th: 'th-mcap' },
  { id: 'volume', label: (t) => t('topSection.volume24h'), sort: 'volume', th: 'th-volume' },
  { id: 'volMcap', label: () => 'Vol/MCap', sort: 'volMcap', th: 'th-volume' },
  { id: 'circSupply', label: () => 'Circ. Supply', sort: 'circSupply', th: 'th-volume' },
  { id: 'athPct', label: () => 'From ATH', sort: 'athPct', th: 'th-change' },
  { id: 'sparkline', label: (t) => t('topSection.last7days'), sort: null, th: 'th-sparkline' },
]
const TOPCOIN_COLS_BY_ID = Object.fromEntries(TOPCOIN_COLUMN_DEFS.map((d) => [d.id, d]))
// Default set mirrors the classic table (8 columns = the CSS grid fallback)
const TOPCOIN_DEFAULT_COLS = ['price', 'change24h', 'change7d', 'change30d', 'change1y', 'marketCap', 'volume', 'sparkline']
const TOPCOIN_COLS_LS_KEY = 'spectre-topcoins-cols-v1'

// Range filter fields. Values live in welcome-page state as plain numbers.
const RANGE_FIELD_DEFS = [
  { key: 'mcap', label: 'Market Cap', unit: '$' },
  { key: 'fdv', label: 'FDV', unit: '$' },
  { key: 'price', label: 'Price', unit: '$' },
  { key: 'chg', label: 'Change 24H', unit: '%' },
  { key: 'vol', label: 'Volume 24H', unit: '$' },
]

const MCAP_PRESETS = [
  { label: '> $10B', min: 1e10, max: null },
  { label: '$1B - $10B', min: 1e9, max: 1e10 },
  { label: '$100M - $1B', min: 1e8, max: 1e9 },
  { label: '< $100M', min: null, max: 1e8 },
]

export function countActiveTopCoinsRanges(r) {
  if (!r) return 0
  return RANGE_FIELD_DEFS.reduce((acc, f) => {
    const min = r[`${f.key}Min`]
    const max = r[`${f.key}Max`]
    return acc + ((min != null && min !== '') || (max != null && max !== '') ? 1 : 0)
  }, 0)
}

// "1.5b" / "250M" / "$10,000" / "0.5" -> number (null when empty/invalid)
function parseAmount(str) {
  if (str == null) return null
  const s = String(str).trim().toLowerCase().replace(/[$,%\s]/g, '').replace(/,/g, '')
  if (!s) return null
  const m = s.match(/^(-?\d*\.?\d+)([kmbt])?$/)
  if (!m) return null
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2]] || 1
  const n = parseFloat(m[1]) * mult
  return Number.isFinite(n) ? n : null
}

const fmtSupplyShort = (n) => {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

// Shared click-outside + Escape closer for the toolbar popovers
function usePopoverClose(ref, open, close) {
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) close() }
    const onEsc = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open, ref, close])
}

const GLOBE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a13.5 13.5 0 010 18M12 3a13.5 13.5 0 000 18" />
  </svg>
)

function TcChainSelect({ value, onChange, t }) {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  usePopoverClose(ref, open, close)
  const active = TOPCOINS_CHAINS.find((c) => c.id === value) || TOPCOINS_CHAINS[0]
  return (
    <div className="tcf-pop-wrap" ref={ref}>
      <button
        type="button"
        className={`tcf-btn${open ? ' is-open' : ''}${active.id !== 'all' ? ' has-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {active.icon ? (
          <span className="tcf-chain-glyph" aria-hidden>{active.icon}</span>
        ) : active.logo ? (
          <img className="tcf-chain-logo" src={active.logo} alt="" width="15" height="15" loading="lazy" decoding="async" onError={(e) => { e.target.style.display = 'none' }} />
        ) : GLOBE_ICON}
        <span>{active.id === 'all' ? t('topSection.chains', 'Chains') : active.label}</span>
        <svg className="tcf-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <ul className="tcf-menu" role="listbox" aria-label={tr('homePage.discoverySection.tcchainselect.ariaChain', "Chain")}>
          {TOPCOINS_CHAINS.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === value}
                className={`tcf-menu-option${c.id === value ? ' is-active' : ''}`}
                onClick={() => { onChange(c.id); setOpen(false) }}
              >
                {c.icon ? (
                  <span className="tcf-chain-glyph" aria-hidden>{c.icon}</span>
                ) : c.logo ? (
                  <img className="tcf-chain-logo" src={c.logo} alt="" width="16" height="16" loading="lazy" decoding="async" onError={(e) => { e.target.style.visibility = 'hidden' }} />
                ) : GLOBE_ICON}
                <span>{c.label}</span>
                {c.id === value && (
                  <svg className="tcf-menu-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* "More" categories - extended CG category list behind a rail-chip dropdown.
   Trigger reuses the category-tab chip styling so it reads as part of the rail;
   when a More category is active the chip shows its label + active state. */
function TcMoreCategories({ tabs, value, onChange, t }) {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  usePopoverClose(ref, open, close)
  const active = tabs.find((c) => c.id === value) || null
  return (
    <div className="tcf-pop-wrap tcf-more-wrap" ref={ref}>
      <button
        type="button"
        className={`filter-option welcome-category-tab tcf-more-btn${active ? ' active' : ''}${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="category-tab-icon" aria-hidden>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </span>
        {active ? active.label : t('categoryFilters.more', 'More')}
        <svg className="tcf-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <ul className="tcf-menu tcf-menu--cats" role="listbox" aria-label={tr('homePage.discoverySection.tcmorecategories.ariaMoreCategories', "More categories")}>
          {tabs.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === value}
                className={`tcf-menu-option${c.id === value ? ' is-active' : ''}`}
                onClick={() => { onChange(c.id); setOpen(false) }}
              >
                <span>{c.label}</span>
                {c.id === value && (
                  <svg className="tcf-menu-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TcFiltersPopover({ ranges, setRanges, t }) {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({})
  const ref = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  usePopoverClose(ref, open, close)
  const activeCount = countActiveTopCoinsRanges(ranges)

  const openPopover = () => {
    const d = {}
    RANGE_FIELD_DEFS.forEach((f) => {
      d[`${f.key}Min`] = ranges?.[`${f.key}Min`] != null ? String(ranges[`${f.key}Min`]) : ''
      d[`${f.key}Max`] = ranges?.[`${f.key}Max`] != null ? String(ranges[`${f.key}Max`]) : ''
    })
    setDraft(d)
    setOpen(true)
  }

  const apply = () => {
    const next = {}
    let any = false
    RANGE_FIELD_DEFS.forEach((f) => {
      const min = parseAmount(draft[`${f.key}Min`])
      const max = parseAmount(draft[`${f.key}Max`])
      if (min != null) { next[`${f.key}Min`] = min; any = true }
      if (max != null) { next[`${f.key}Max`] = max; any = true }
    })
    setRanges(any ? next : null)
    setOpen(false)
  }

  const reset = () => {
    setDraft({})
    setRanges(null)
  }

  const setD = (k, v) => setDraft((prev) => ({ ...prev, [k]: v }))
  const presetActive = (p) =>
    (p.min == null ? !draft.mcapMin : parseAmount(draft.mcapMin) === p.min) &&
    (p.max == null ? !draft.mcapMax : parseAmount(draft.mcapMax) === p.max)

  return (
    <div className="tcf-pop-wrap" ref={ref}>
      <button
        type="button"
        className={`tcf-btn${open ? ' is-open' : ''}${activeCount > 0 ? ' has-active' : ''}`}
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
        <span>{t('common.filters', 'Filters')}</span>
        {activeCount > 0 && <span className="tcf-count">{activeCount}</span>}
      </button>
      {open && (
        <div className="tcf-popover tcf-popover--filters" role="dialog" aria-label={tr('homePage.discoverySection.tcfilterspopover.ariaTopCoinsFilters', "Top Coins filters")}>
          <div className="tcf-popover-head">
            <span className="tcf-popover-title">{t('common.filters', 'Filters')}</span>
            <span className="tcf-popover-hint">10m, 1.5b, 25k...</span>
          </div>
          {RANGE_FIELD_DEFS.map((f) => (
            <div className="tcf-range-row" key={f.key}>
              <span className="tcf-range-label">{f.label}</span>
              <div className="tcf-range-inputs">
                <div className="tcf-range-field">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={tr('homePage.discoverySection.tcfilterspopover.placeholderMin', "Min")}
                    value={draft[`${f.key}Min`] || ''}
                    onChange={(e) => setD(`${f.key}Min`, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') apply() }}
                  />
                  <span className="tcf-range-unit">{f.unit}</span>
                </div>
                <span className="tcf-range-sep" aria-hidden>-</span>
                <div className="tcf-range-field">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={tr('homePage.discoverySection.tcfilterspopover.placeholderMax', "Max")}
                    value={draft[`${f.key}Max`] || ''}
                    onChange={(e) => setD(`${f.key}Max`, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') apply() }}
                  />
                  <span className="tcf-range-unit">{f.unit}</span>
                </div>
              </div>
              {f.key === 'mcap' && (
                <div className="tcf-presets">
                  {MCAP_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={`tcf-preset${presetActive(p) ? ' is-active' : ''}`}
                      onClick={() => setDraft((prev) => ({
                        ...prev,
                        mcapMin: p.min != null ? String(p.min) : '',
                        mcapMax: p.max != null ? String(p.max) : '',
                      }))}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="tcf-popover-foot">
            <button type="button" className="tcf-foot-reset" onClick={reset}>
              {t('common.reset', 'Reset')}
            </button>
            <button type="button" className="tcf-foot-apply" onClick={apply}>
              {t('common.apply', 'Apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TcColumnsPopover({ visibleCols, setVisibleCols, t }) {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  usePopoverClose(ref, open, close)
  const customized = visibleCols.length !== TOPCOIN_DEFAULT_COLS.length
    || visibleCols.some((id, i) => id !== TOPCOIN_DEFAULT_COLS[i])

  const toggle = (id) => {
    setVisibleCols((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((c) => c !== id)
        // Keep the table meaningful: at least 2 data columns stay on
        if (next.filter((c) => c !== 'sparkline').length < 2) return prev
        return next
      }
      // Re-insert in canonical column order
      return TOPCOIN_COLUMN_DEFS.map((d) => d.id).filter((cid) => prev.includes(cid) || cid === id)
    })
  }

  return (
    <div className="tcf-pop-wrap" ref={ref}>
      <button
        type="button"
        className={`tcf-btn${open ? ' is-open' : ''}${customized ? ' has-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
        <span>{t('common.columns', 'Columns')}</span>
      </button>
      {open && (
        <div className="tcf-popover tcf-popover--columns" role="dialog" aria-label={tr('homePage.discoverySection.tccolumnspopover.ariaTableColumns', "Table columns")}>
          <div className="tcf-popover-head">
            <span className="tcf-popover-title">{t('common.columns', 'Columns')}</span>
            {customized && (
              <button type="button" className="tcf-popover-headreset" onClick={() => setVisibleCols(TOPCOIN_DEFAULT_COLS)}>
                {t('common.reset', 'Reset')}
              </button>
            )}
          </div>
          <div className="tcf-col-list">
            {TOPCOIN_COLUMN_DEFS.map((def) => {
              const on = visibleCols.includes(def.id)
              return (
                <button
                  key={def.id}
                  type="button"
                  className={`tcf-col-row${on ? ' is-on' : ''}`}
                  onClick={() => toggle(def.id)}
                  role="switch"
                  aria-checked={on}
                >
                  <span className="tcf-col-label">{def.label(t)}</span>
                  <span className="tcf-col-switch" aria-hidden>
                    <span className="tcf-col-knob" />
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const DiscoverySection = ({
  // State
  tabsOn, setTabsOn,
  activeDiscoverTab, setActiveDiscoverTab,
  chartPanelToken, setChartPanelToken,
  topSectionTab, setTopSectionTab,
  categoryFilter, setCategoryFilter,
  topCoinsChain, setTopCoinsChain,
  topCoinsRanges, setTopCoinsRanges,
  showFutures, setShowFutures,
  timeframeFilter, setTimeframeFilter,
  predictionsCategoryFilter, setPredictionsCategoryFilter,
  onChainChainFilter, setOnChainChainFilter,
  onChainRankBy, setOnChainRankBy,
  onChainViewMode, setOnChainViewMode,
  viewMode, setViewMode,
  topCoinsLoading,
  onChainLoading,
  loading,
  compareMode, setCompareMode,
  topCoinsPage, setTopCoinsPage,
  chartOverlayTimeframe, setChartOverlayTimeframe,
  chartOverlaySubTab, setChartOverlaySubTab,
  chartOverlayYAxis, setChartOverlayYAxis,
  chartFullscreen, setChartFullscreen,
  // Data
  openTokenTabs,
  filteredOnChain,
  filteredPredictions, predictionsLoading,
  filteredAiAgents,
  filteredAiModels,
  aiAgentCategoryFilter, setAiAgentCategoryFilter,
  aiAgentSortBy, setAiAgentSortBy,
  aiAgentSortDir, setAiAgentSortDir,
  aiModelCategoryFilter, setAiModelCategoryFilter,
  aiModelProviderFilter, setAiModelProviderFilter,
  aiModelViewMode, setAiModelViewMode,
  aiModelSortBy, setAiModelSortBy,
  aiModelSortDir, setAiModelSortDir,
  aiModelQualityFilter, setAiModelQualityFilter,
  aiModelEloTrends,
  tokens,
  filteredTopCoins,
  topCoinPrices,
  compareTokens,
  binancePrices,
  // Functions
  openTokenCardPopup,
  openChartOnly,
  removeTokenTab,
  clearAllTabs,
  handleOnChainCoinClick,
  handleTopCoinClick,
  handleStockClick,
  toggleCompareToken,
  isTokenSelected,
  openTopCoinInfo,
  checkIsInWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  renderChartPanel,
  exitCompareMode,
  selectToken,
  onPageChange,
  getTradingViewSymbol,
  OVERLAY_TIMEFRAMES,
  // Formatting
  fmtPrice, fmtLarge,
  // Constants
  icons,
  TRANSLATED_STOCK_SECTORS,
  CATEGORY_TABS,
  MORE_CATEGORY_TABS,
  timeframes,
  TOTAL_TOP_COINS_PAGES,
  TOP_COINS_PAGE_SIZE,
  TOP_COINS_PAGE_SIZE_OPTIONS,
  topCoinsPageSize,
  setTopCoinsPageSize,
  hasMorePages,
  totalCategoryPages,
  loadNextTopCoinsPage,
  jumpToTopCoinsPage,
  EMPTY_STYLE,
  // Flags
  isMobile, isStocks, discoverOnly,
  // i18n
  t,
  // War Room
  fearGreed, watchlist,
  // Watchlist discovery toggle
  showWatchlist,
  watchlistWithLiveData,
}) => {
  const { t: tr } = useTranslation()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const navigate = useNavigate()
  const [isShareExporting, setIsShareExporting] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareImageUrl, setShareImageUrl] = useState(null)
  const [shareDescription, setShareDescription] = useState('')

  const toggleModelSort = useCallback((col) => {
    if (aiModelSortBy === col) {
      setAiModelSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setAiModelSortBy(col)
      setAiModelSortDir('desc')
    }
  }, [aiModelSortBy, setAiModelSortBy, setAiModelSortDir])

  const toggleAgentSort = useCallback((col) => {
    if (aiAgentSortBy === col) {
      setAiAgentSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setAiAgentSortBy(col)
      setAiAgentSortDir('desc')
    }
  }, [aiAgentSortBy, setAiAgentSortBy, setAiAgentSortDir])

  // ── Column sorting for Top Coins table ──
  const [sortColumn, setSortColumn] = useState('rank')
  const [sortDirection, setSortDirection] = useState('asc')

  // ── Customizable Top Coins columns (crypto mode only; persisted) ──
  const [topcoinCols, setTopcoinCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TOPCOIN_COLS_LS_KEY))
      if (Array.isArray(saved) && saved.length) {
        const valid = saved.filter((id) => TOPCOIN_COLS_BY_ID[id])
        if (valid.filter((c) => c !== 'sparkline').length >= 2) return valid
      }
    } catch (_) { /* corrupted seed — fall through to defaults */ }
    return TOPCOIN_DEFAULT_COLS
  })
  useEffect(() => {
    try { localStorage.setItem(TOPCOIN_COLS_LS_KEY, JSON.stringify(topcoinCols)) } catch (_) { /* ignore */ }
  }, [topcoinCols])

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection(column === 'rank' || column === 'name' ? 'asc' : 'desc')
    }
  }

  // ── Column sorting for On-Chain table ──
  const [onchainSortColumn, setOnchainSortColumn] = useState('rank')
  const [onchainSortDirection, setOnchainSortDirection] = useState('asc')
  const [onchainTimeframe, setOnchainTimeframe] = useState('24h')

  // ── On-Chain leaderboard rank mode (primary sort) + market-cap band filter ──
  // Rank replaces the old broken mcap-tier data-source pills. It maps onto the
  // one real DEX dataset: Trending (native), Gainers/Losers (active timeframe %),
  // Volume, Market Cap. 'custom' = a manual column-header click. Persisted.
  const ONCHAIN_RANKS = useRef(new Set(['trending', 'gainers', 'losers', 'volume', 'mcap'])).current
  const [onChainRank, setOnChainRankState] = useState(() => {
    try {
      const s = localStorage.getItem('spectre-onchain-rank-v1')
      return s && ONCHAIN_RANKS.has(s) ? s : 'trending'
    } catch (_) { return 'trending' }
  })
  const setOnChainRank = useCallback((v) => {
    setOnChainRankState(v)
    try {
      if (v === 'custom') localStorage.removeItem('spectre-onchain-rank-v1')
      else localStorage.setItem('spectre-onchain-rank-v1', v)
    } catch (_) { /* ignore */ }
  }, [])
  const ONCHAIN_CAPS = useRef(new Set(['all', 'large', 'mid', 'small'])).current
  const [onChainMcapBand, setOnChainMcapBandState] = useState(() => {
    try {
      const s = localStorage.getItem('spectre-onchain-cap-v1')
      return s && ONCHAIN_CAPS.has(s) ? s : 'all'
    } catch (_) { return 'all' }
  })
  const setOnChainMcapBand = useCallback((v) => {
    setOnChainMcapBandState(ONCHAIN_CAPS.has(v) ? v : 'all')
    try { localStorage.setItem('spectre-onchain-cap-v1', v) } catch (_) { /* ignore */ }
  }, [ONCHAIN_CAPS])
  // Mobile numbered pagination for the On-Chain list (25 rows per page).
  const [onchainPage, setOnchainPage] = useState(1)
  const ONCHAIN_PAGE_SIZE = 25

  // ── Double-click to watchlist (Instagram heart burst) ──
  const [heartBurst, setHeartBurst] = useState(null) // { key, id }
  const clickTimerRef = useRef(null)
  const heartBurstTimerRef = useRef(null)
  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    if (heartBurstTimerRef.current) clearTimeout(heartBurstTimerRef.current)
  }, [])

  // ── AI Models: filter dropdown ──
  const [aiFiltersOpen, setAiFiltersOpen] = useState(false)
  const aiFiltersRef = useRef(null)
  useEffect(() => {
    if (!aiFiltersOpen) return undefined
    const handleClickOutside = (e) => {
      if (aiFiltersRef.current && !aiFiltersRef.current.contains(e.target)) {
        setAiFiltersOpen(false)
      }
    }
    const handleEsc = (e) => {
      if (e.key === 'Escape') setAiFiltersOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [aiFiltersOpen])
  const aiActiveFilterCount =
    (aiModelCategoryFilter && aiModelCategoryFilter !== 'all' ? 1 : 0) +
    (aiModelProviderFilter && aiModelProviderFilter !== 'all' ? 1 : 0) +
    (aiModelQualityFilter && aiModelQualityFilter !== 'all' ? 1 : 0)

  const handleRowClick = useCallback((action) => {
    // Delay single-click navigation so double-click can cancel it
    clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => { action() }, 250)
  }, [])

  const handleRowDoubleClick = useCallback((token, e) => {
    e.stopPropagation()
    // Cancel the pending single-click navigation
    clearTimeout(clickTimerRef.current)
    if (!addToWatchlist) return
    const identifier = token.address || token.symbol
    if (checkIsInWatchlist(token)) {
      removeFromWatchlist && removeFromWatchlist(identifier)
    } else {
      addToWatchlist({
        symbol: token.symbol, name: token.name,
        address: token.address, logo: token.logo,
        price: token.price, change: token.change || token.change24h || 0,
        marketCap: token.marketCap || token.mcap, pinned: false
      })
    }
    const key = `${identifier}-${Date.now()}`
    setHeartBurst({ key, id: identifier })
    if (heartBurstTimerRef.current) clearTimeout(heartBurstTimerRef.current)
    heartBurstTimerRef.current = setTimeout(() => setHeartBurst(null), 700)
  }, [addToWatchlist, checkIsInWatchlist])

  const handleOnchainSort = (column) => {
    // Clicking the # header is the same intent as the Trending rank pill.
    if (column === 'rank') { setOnChainRank('trending'); return }
    // Any other column header is a manual sort — deselect the rank pills.
    setOnChainRank('custom')
    if (onchainSortColumn === column) {
      setOnchainSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setOnchainSortColumn(column)
      setOnchainSortDirection(column === 'name' ? 'asc' : 'desc')
    }
  }

  const sortedTopCoins = useMemo(() => {
    if (!filteredTopCoins?.length) return filteredTopCoins || []
    const list = [...filteredTopCoins]

    list.sort((a, b) => {
      let aVal, bVal

      switch (sortColumn) {
        case 'rank':
          aVal = a.rank || 0; bVal = b.rank || 0; break
        case 'name':
          aVal = (a.symbol || '').toLowerCase()
          bVal = (b.symbol || '').toLowerCase()
          return sortDirection === 'asc'
            ? (aVal < bVal ? -1 : aVal > bVal ? 1 : 0)
            : (bVal < aVal ? -1 : bVal > aVal ? 1 : 0)
        case 'price':
          aVal = a.price || 0; bVal = b.price || 0; break
        case 'change':
          aVal = a.change || 0; bVal = b.change || 0; break
        case 'change7d':
          if (isStocks) {
            aVal = (a.sector || '').toLowerCase()
            bVal = (b.sector || '').toLowerCase()
            return sortDirection === 'asc'
              ? (aVal < bVal ? -1 : aVal > bVal ? 1 : 0)
              : (bVal < aVal ? -1 : bVal > aVal ? 1 : 0)
          }
          aVal = a.change7d ?? null; bVal = b.change7d ?? null; break
        case 'change30d':
          if (isStocks) { aVal = a.pe || 0; bVal = b.pe || 0; break }
          aVal = a.change30d ?? null; bVal = b.change30d ?? null; break
        case 'change1y':
          if (isStocks) {
            aVal = (a.exchange || '').toLowerCase()
            bVal = (b.exchange || '').toLowerCase()
            return sortDirection === 'asc'
              ? (aVal < bVal ? -1 : aVal > bVal ? 1 : 0)
              : (bVal < aVal ? -1 : bVal > aVal ? 1 : 0)
          }
          aVal = a.change1y ?? null; bVal = b.change1y ?? null; break
        case 'marketCap':
          aVal = a.marketCap || 0; bVal = b.marketCap || 0; break
        case 'volume':
          aVal = a.volume || 0; bVal = b.volume || 0; break
        case 'change1h':
          aVal = a.change1h ?? null; bVal = b.change1h ?? null; break
        case 'fdv':
          aVal = a.fdv ?? null; bVal = b.fdv ?? null; break
        case 'volMcap':
          aVal = a.marketCap > 0 ? (a.volume || 0) / a.marketCap : 0
          bVal = b.marketCap > 0 ? (b.volume || 0) / b.marketCap : 0
          break
        case 'circSupply':
          aVal = a.circulatingSupply ?? null; bVal = b.circulatingSupply ?? null; break
        case 'athPct':
          aVal = a.athChangePct ?? null; bVal = b.athChangePct ?? null; break
        default: return 0
      }

      // Rows with no data for the sorted column sink to the bottom in BOTH
      // directions - a brand-new listing with no 7D history must not rank
      // as "0%" in the middle of the table.
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
    })

    return list
  }, [filteredTopCoins, sortColumn, sortDirection, isStocks])

  // ── Watchlist-filtered top coins for desktop star toggle ──
  // When showWatchlist is active, display watchlistWithLiveData directly
  // (not a filter of sortedTopCoins) so ALL watchlist tokens appear
  const displayTopCoins = useMemo(() => {
    if (!showWatchlist || !watchlistWithLiveData?.length) return sortedTopCoins
    return watchlistWithLiveData
  }, [showWatchlist, watchlistWithLiveData, sortedTopCoins])

  // Map the active timeframe to its change column (drives Gainers/Losers).
  const onchainTfColumn = ONCHAIN_TF_COLUMN[onchainTimeframe] || 'change24h'

  // Resolve the rank mode into an effective (column, direction). Column-header
  // clicks flip rank to 'custom' and use the explicit column/direction below.
  const { effCol, effDir } = useMemo(() => {
    switch (onChainRank) {
      case 'gainers': return { effCol: onchainTfColumn, effDir: 'desc' }
      case 'losers': return { effCol: onchainTfColumn, effDir: 'asc' }
      case 'volume': return { effCol: 'volume', effDir: 'desc' }
      case 'mcap': return { effCol: 'mcap', effDir: 'desc' }
      case 'custom': return { effCol: onchainSortColumn, effDir: onchainSortDirection }
      case 'trending':
      default: return { effCol: 'rank', effDir: 'asc' }
    }
  }, [onChainRank, onchainTfColumn, onchainSortColumn, onchainSortDirection])

  const sortedOnChain = useMemo(() => {
    if (!filteredOnChain?.length) return filteredOnChain || []
    let list = filteredOnChain.filter(t => !isDustOnchainRow(t))

    // Market-cap band filter (client-side over the real DEX dataset).
    if (onChainMcapBand !== 'all') {
      list = list.filter(t => {
        const m = Number(t.mcap ?? t.marketCap ?? 0)
        if (!(m > 0)) return false
        if (onChainMcapBand === 'large') return m >= 500_000_000
        if (onChainMcapBand === 'mid') return m >= 50_000_000 && m < 500_000_000
        if (onChainMcapBand === 'small') return m < 50_000_000
        return true
      })
    }

    // Helper: token has a usable 7d sparkline?
    const hasSparkline = (t) => Array.isArray(t.sparkline_7d) && t.sparkline_7d.length >= 2
      || Array.isArray(t.sparkline) && t.sparkline.length >= 2

    list.sort((a, b) => {
      // Trending (rank): keep the native volume-sorted order but float rows that
      // have a real 7d sparkline to the top so the chart column stays populated.
      if (effCol === 'rank') {
        const aHas = hasSparkline(a) ? 1 : 0
        const bHas = hasSparkline(b) ? 1 : 0
        if (aHas !== bHas) return bHas - aHas
        return 0
      }

      if (effCol === 'name') {
        const aVal = (a.symbol || '').toLowerCase()
        const bVal = (b.symbol || '').toLowerCase()
        return effDir === 'asc'
          ? (aVal < bVal ? -1 : aVal > bVal ? 1 : 0)
          : (bVal < aVal ? -1 : bVal > aVal ? 1 : 0)
      }

      let aVal, bVal
      switch (effCol) {
        case 'price': aVal = a.price || 0; bVal = b.price || 0; break
        case 'change5m': aVal = a.change5m || 0; bVal = b.change5m || 0; break
        case 'change1h': aVal = a.change1h || 0; bVal = b.change1h || 0; break
        case 'change4h': aVal = a.change4h || 0; bVal = b.change4h || 0; break
        case 'change24h': aVal = a.change24h || 0; bVal = b.change24h || 0; break
        case 'volume': aVal = a.volume || 0; bVal = b.volume || 0; break
        case 'mcap': aVal = a.mcap || 0; bVal = b.mcap || 0; break
        case 'liquidity': aVal = a.liquidity || 0; bVal = b.liquidity || 0; break
        default: return 0
      }
      return effDir === 'asc' ? aVal - bVal : bVal - aVal
    })

    return list
  }, [filteredOnChain, effCol, effDir, onChainMcapBand])

  // On mobile, slice sortedOnChain into 25-row pages so long lists aren't
  // one infinite scroll. Desktop keeps the full list (no UX change).
  const onchainTotalPages = isMobile ? Math.max(1, Math.ceil(sortedOnChain.length / ONCHAIN_PAGE_SIZE)) : 1
  const safeOnchainPage = Math.min(onchainPage, onchainTotalPages)
  const displaySortedOnChain = useMemo(() => (
    isMobile
      ? sortedOnChain.slice((safeOnchainPage - 1) * ONCHAIN_PAGE_SIZE, safeOnchainPage * ONCHAIN_PAGE_SIZE)
      : sortedOnChain
  ), [isMobile, sortedOnChain, safeOnchainPage])

  // Reset page when the dataset shrinks (sort, filter, chain change).
  useEffect(() => {
    if (onchainPage > onchainTotalPages) setOnchainPage(1)
  }, [onchainPage, onchainTotalPages])

  // The scroll has to happen AFTER React has swapped in the new page's rows.
  // Scrolling inside the click handler raced the re-render and silently did
  // nothing on the first tap - you stayed at the bottom of the page and the
  // list appeared not to react at all. A ref-flagged effect runs post-commit,
  // so it lands every time. `.tdt-onchain` carries a scroll-margin-top on
  // mobile so the first rows clear the sticky app header.
  const pendingPageScrollRef = useRef(false)

  const handleOnchainPageSelect = useCallback((page) => {
    if (page === onchainPage) return
    pendingPageScrollRef.current = true
    setOnchainPage(page)
  }, [onchainPage])

  useEffect(() => {
    if (!pendingPageScrollRef.current) return
    pendingPageScrollRef.current = false
    if (typeof document === 'undefined') return
    const list = document.querySelector('.tdt-onchain')
    // Instant, not smooth. A smooth scroll runs over several frames and the
    // new page's token logos finish loading inside that window - the layout
    // shift trips scroll anchoring, which cancels the animation and leaves
    // you parked at the bottom on the very page you just left.
    if (list) list.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [safeOnchainPage])

  // "26-50 of 75" under the pager - a numbered pager alone gives no sense of
  // position once the list header has scrolled off the phone screen.
  const onchainRangeLabel = useMemo(() => {
    if (!isMobile || onchainTotalPages <= 1) return null
    const total = sortedOnChain.length
    const from = (safeOnchainPage - 1) * ONCHAIN_PAGE_SIZE + 1
    const to = Math.min(safeOnchainPage * ONCHAIN_PAGE_SIZE, total)
    return `${from}-${to} of ${total}`
  }, [isMobile, onchainTotalPages, sortedOnChain.length, safeOnchainPage])

  const handleShareTopCoins = useCallback(async () => {
    if (isShareExporting) return
    setIsShareExporting(true)
    setShareImageUrl(null)
    setShareModalOpen(true)

    try {
      const coins = (sortedTopCoins || []).slice(0, 10)
      if (!coins.length) { setIsShareExporting(false); setShareModalOpen(false); return }

      const modeLabel = isStocks ? 'Stocks' : 'Crypto'
      setShareDescription(`Top ${coins.length} ${modeLabel} by Market Cap.\n\n\nvia @Spectre__Ai\nhttps://spectreai.io`)

      // Pre-load logos
      const spectreLogo = await getSpectreLogo()
      const logoMap = await preloadLogos(coins, (t) => TOKEN_LOGOS[t.symbol])

      const dataUrl = renderShareCard(
        (ctx, w, contentTop, c, fonts) => {
          const pad = CARD_PAD
          const rowH = 44
          const rows = coins.length
          let y = contentTop + 8

          // Table header
          const thY = y + 16
          ctx.font = `600 9.5px ${fonts.body}`
          ctx.fillStyle = c.thColor
          ctx.textAlign = 'left'
          ctx.fillText('#', pad + 4, thY)
          ctx.fillText('TOKEN', pad + 41, thY)
          ctx.textAlign = 'right'
          ctx.fillText('PRICE', pad + 264, thY)
          ctx.fillText('24H', pad + 339, thY)
          ctx.fillText('MCAP', pad + 420, thY)
          ctx.fillText('7D', w - pad - 16, thY)

          y = thY + 14

          coins.forEach((token, i) => {
            const ry = y + i * rowH
            // Alternating row bg
            if (i % 2 === 0) {
              ctx.fillStyle = c.rowAlt
              ctx.beginPath(); ctx.roundRect(pad, ry, w - pad * 2, rowH, 8); ctx.fill()
            }
            const textY = ry + 27
            // Rank
            ctx.textAlign = 'center'
            ctx.font = `500 12px ${fonts.mono}`
            ctx.fillStyle = c.rank
            ctx.fillText(String(i + 1), pad + 16, textY)
            // Logo
            const logo = logoMap[token.symbol]
            const lx = pad + 41, ls = 24, lr = 6
            if (logo) {
              ctx.save()
              ctx.beginPath(); ctx.roundRect(lx, ry + 10, ls, ls, lr); ctx.clip()
              ctx.drawImage(logo, lx, ry + 10, ls, ls)
              ctx.restore()
            } else {
              ctx.fillStyle = c.fallbackBg
              ctx.beginPath(); ctx.roundRect(lx, ry + 10, ls, ls, lr); ctx.fill()
              ctx.fillStyle = c.fallbackText
              ctx.font = `700 10px ${fonts.body}`
              const ini = (token.symbol || '?').charAt(0)
              ctx.fillText(ini, lx + ls / 2, ry + 26)
            }
            // Symbol + Name
            ctx.textAlign = 'left'
            ctx.font = `600 14px ${fonts.body}`
            ctx.fillStyle = c.symbol
            ctx.fillText(token.symbol || '', lx + 30, textY - 2)
            ctx.font = `400 10px ${fonts.body}`
            ctx.fillStyle = c.name
            const nm = truncateText(ctx, token.name || '', 100)
            ctx.fillText(nm, lx + 30, textY + 11)
            // Price
            ctx.textAlign = 'right'
            ctx.font = `500 13px ${fonts.mono}`
            ctx.fillStyle = c.price
            const priceStr = token.price != null
              ? (token.price < 0.01 ? `$${token.price.toFixed(6)}` : `$${token.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
              : '-'
            ctx.fillText(priceStr, pad + 264, textY)
            // Change
            const ch = typeof token.change === 'number' ? token.change : 0
            ctx.font = `600 13px ${fonts.mono}`
            ctx.fillStyle = ch >= 0 ? c.bull : c.bear
            ctx.fillText(`${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`, pad + 339, textY)
            // MCap
            ctx.font = `500 12px ${fonts.mono}`
            ctx.fillStyle = c.muted
            ctx.fillText(formatLargeNumber(token.marketCap || 0), pad + 420, textY)
            // Sparkline
            const spkData = token.sparkline && token.sparkline.length > 2
              ? token.sparkline : shareGenSparkline(ch, 20)
            const spkW = 64, spkH = 28
            const spkX = w - pad - spkW - 4
            const spkY = ry + (rowH - spkH) / 2
            const spkIsUp = spkData[spkData.length - 1] >= spkData[0]
            drawSparkline(ctx, spkData, spkX, spkY, spkW, spkH, c, spkIsUp)
          })

          return 30 + rows * rowH + 16
        },
        {
          title: 'Crypto Research Platform',
          logo: spectreLogo,
          badges: [
            { text: '24H', filled: false },
            { text: `TOP ${coins.length}`, filled: true },
          ],
          subtitle: isStocks ? 'US Stocks' : 'All Chains',
        },
      )
      setShareImageUrl(dataUrl)
    } catch (err) {
      console.error('Share export failed:', err)
      setShareModalOpen(false)
    }
    setIsShareExporting(false)
  }, [sortedTopCoins, isStocks, isShareExporting])

  return (
  <>
  <div id="top-coins" className="welcome-discovery-block" data-tour="discovery">
      <section className="discovery-section">
        <div className={`discovery-filters discovery-filters-with-tabs ${isMobile ? 'discovery-filters-mobile' : ''}`} style={topSectionTab === 'warroom' || topSectionTab === 'social' || (isMobile && (topSectionTab === 'topcoins' || topSectionTab === 'predictions' || topSectionTab === 'aiagents' || topSectionTab === 'aimodels')) ? { display: 'none' } : undefined}>
          {/* Tabs On/Off + Discover + token tabs (same line, before Network).
              Tabs feature only applies to topcoins + onchain (which open token
              chart panels). Hide on predictions/aiagents/aimodels — those tabs
              don't have a chart-panel concept. */}
          {(topSectionTab === 'topcoins' || topSectionTab === 'onchain') && (
          <div className="discovery-filters-tabs-group">
            <button
              type="button"
              className={`discover-tabs-toggle ${tabsOn ? 'active' : ''}`}
              onClick={() => {
                setTabsOn((prev) => {
                  const next = !prev
                  if (!next) {
                    setChartPanelToken(null)
                    setActiveDiscoverTab('discover')
                  }
                  return next
                })
              }}
              aria-pressed={tabsOn}
              aria-label={`${t('topSection.tabs')} ${tabsOn ? t('topSection.on') : t('topSection.off')}`}
            >
              <span className="discover-tabs-icon" aria-hidden>{icons.tabs}</span>
              <span className="discover-tabs-label">{t('topSection.tabs')}</span>
              <span className={`discover-tabs-dot ${tabsOn ? 'on' : ''}`} />
            </button>
            {tabsOn && openTokenTabs.length > 0 && (
              <div className="welcome-tabs-bar welcome-tabs-bar-inline">
                {openTokenTabs.map((t) => (
                  <div key={t.symbol} className={`welcome-tab-wrap ${activeDiscoverTab === (t.symbol || t) ? 'active' : ''}`}>
                    <button
                      type="button"
                      className="welcome-tab"
                      onClick={() => {
                        setActiveDiscoverTab(t.symbol || t)
                        openChartOnly(t)
                      }}
                    >
                      <span className="welcome-tab-icon" aria-hidden>{icons.tokenTab}</span>
                      <span className="welcome-tab-label">{t.symbol || t}</span>
                    </button>
                    <button
                      type="button"
                      className="welcome-tab-close"
                      aria-label={`Close ${t.symbol || t} tab`}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeTokenTab(t.symbol || t)
                      }}
                    >
                      {icons.close}
                    </button>
                  </div>
                ))}
                {openTokenTabs.length > 1 && (
                  <button
                    type="button"
                    className="welcome-tabs-clear-all"
                    onClick={clearAllTabs}
                    aria-label={t('discovery.closeAllTabs', 'Close all tabs')}
                  >
                    {icons.close}
                    <span>{t('common.clear', 'Clear')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
          )}
            {/* Trending tier pills live ONLY on the On-Chain tab below — Top Coins is
                always CG-mcap-sorted, so Sub 500M / Sub 50M / Social tiers don't apply. */}
            {/* Top Coins only: Category + Timeframe (dropdowns on mobile) */}
            {topSectionTab === 'topcoins' && (
              <>
                <div className="filter-group filter-group-categories">
                  {isMobile ? (
                    <GlassSelect
                      value={categoryFilter}
                      onChange={(e) => {
                        setCategoryFilter(e.target.value)
                        document.querySelector('.discovery-section .tdt')?.scrollTo(0, 0)
                      }}
                      options={(isStocks ? TRANSLATED_STOCK_SECTORS : [...CATEGORY_TABS, ...(MORE_CATEGORY_TABS || [])]).map(c => ({ value: c.id, label: c.label }))}
                      ariaLabel={isStocks ? 'Sector' : 'Category'}
                    />
                  ) : (
                    <>
                    <div className="filter-options">
                      {(isStocks ? TRANSLATED_STOCK_SECTORS : CATEGORY_TABS).map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          className={`filter-option welcome-category-tab ${categoryFilter === cat.id ? 'active' : ''}`}
                          onClick={() => {
                            setCategoryFilter(cat.id)
                            document.querySelector('.discovery-section .tdt')?.scrollTo(0, 0)
                          }}
                        >
                          {cat.icon && <span className="category-tab-icon" aria-hidden>{cat.icon}</span>}
                          {cat.label}
                        </button>
                      ))}
                      {isStocks && (
                        <button
                          type="button"
                          className={`filter-option futures-toggle ${showFutures ? 'active' : ''}`}
                          onClick={() => setShowFutures(!showFutures)}
                          title={showFutures ? 'Hide commodity futures (GC=F, SI=F, CL=F...)' : 'Show commodity futures (GC=F, SI=F, CL=F...)'}
                        >
                          <span className="futures-toggle-dot" />
                          {tr('homePage.discoverySection.discovery.futures', "Futures")}
                        </button>
                      )}
                    </div>
                    {/* Sits OUTSIDE .filter-options: the rail is overflow-x:auto
                        (hidden scrollbar), which would clip the dropdown menu. */}
                    {!isStocks && MORE_CATEGORY_TABS?.length > 0 && (
                      <TcMoreCategories
                        tabs={MORE_CATEGORY_TABS}
                        value={categoryFilter}
                        onChange={(id) => {
                          setCategoryFilter(id)
                          document.querySelector('.discovery-section .tdt')?.scrollTo(0, 0)
                        }}
                        t={t}
                      />
                    )}
                    </>
                  )}
                </div>
                {/* Chain filter + range filters + column chooser (crypto, desktop) */}
                {!isMobile && !isStocks && setTopCoinsChain && (
                  <div className="tcf-cluster">
                    <TcChainSelect value={topCoinsChain || 'all'} onChange={setTopCoinsChain} t={t} />
                    <TcFiltersPopover ranges={topCoinsRanges} setRanges={setTopCoinsRanges} t={t} />
                    <TcColumnsPopover visibleCols={topcoinCols} setVisibleCols={setTopcoinCols} t={t} />
                  </div>
                )}
              </>
            )}
            {/* Predictions: Timeframe + Prediction categories (dropdowns on mobile) */}
            {topSectionTab === 'predictions' && (
              <>
                <div className="filter-group filter-group-predictions-categories">
                  <span className="filter-label">
                    <span className="filter-label-icon" aria-hidden>{icons.sector}</span>
                    {t('topSection.category')}
                  </span>
                  {isMobile ? (
                    <GlassSelect
                      value={predictionsCategoryFilter}
                      onChange={(e) => setPredictionsCategoryFilter(e.target.value)}
                      options={PREDICTIONS_CATEGORIES.map(c => ({ value: c.id, label: c.label }))}
                      ariaLabel="Category"
                    />
                  ) : (
                    <div className="filter-options">
                      {PREDICTIONS_CATEGORIES.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`filter-option predictions-category-tab ${predictionsCategoryFilter === c.id ? 'active' : ''}`}
                          onClick={() => setPredictionsCategoryFilter(c.id)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            {/* On-Chain: Rank mode + cap filter + Chain filter + timeframe pills */}
            {topSectionTab === 'onchain' && (
              <div className={`discovery-filters-onchain-inline ${isMobile ? 'discovery-filters-onchain-mobile' : ''}`}>
                {/* Rank mode — primary sort for the DEX leaderboard. */}
                <div className="trending-tier-pills" role="radiogroup" aria-label={tr('homePage.discoverySection.discovery.ariaRankBy', "Rank by")}>
                  {[
                    { id: 'trending', label: 'Trending' },
                    { id: 'gainers', label: 'Gainers' },
                    { id: 'losers', label: 'Losers' },
                    { id: 'volume', label: 'Volume' },
                    { id: 'mcap', label: 'Market Cap' },
                  ].map(mode => (
                    <button
                      key={mode.id}
                      type="button"
                      role="radio"
                      aria-checked={onChainRank === mode.id}
                      className={`trending-tier-pill${onChainRank === mode.id ? ' is-active' : ''}`}
                      onClick={() => setOnChainRank(mode.id)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                {/* Market-cap band filter — the useful half of the old tiers,
                    now a client-side filter over the real on-chain dataset. */}
                <GlassSelect
                  value={onChainMcapBand}
                  onChange={(e) => setOnChainMcapBand(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Caps' },
                    { value: 'large', label: 'Large ≥$500M' },
                    { value: 'mid', label: 'Mid $50M–500M' },
                    { value: 'small', label: 'Small <$50M' },
                  ]}
                  ariaLabel="Market cap"
                />
                {isMobile ? (
                  <GlassSelect
                    value={onChainChainFilter}
                    onChange={(e) => setOnChainChainFilter(e.target.value)}
                    options={ONCHAIN_CHAINS.map(c => ({ value: c.id, label: c.label, icon: CHAIN_LOGOS[c.id], glyph: c.icon }))}
                    ariaLabel="Chain"
                  />
                ) : (
                  <div className="filter-group filter-group-chain-inline">
                    <div className="chain-filter-pills">
                      {ONCHAIN_CHAINS.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`chain-pill ${onChainChainFilter === c.id ? 'active' : ''}`}
                          onClick={() => setOnChainChainFilter(c.id)}
                        >
                          {/* Robinhood Chain has no CoinGecko coin logo - it
                              carries an inline glyph instead of a logo URL. */}
                          {c.icon ? (
                            <span className="chain-pill-icon chain-pill-glyph" aria-hidden>{c.icon}</span>
                          ) : CHAIN_LOGOS[c.id] ? (
                            <img className="chain-pill-icon" src={CHAIN_LOGOS[c.id]} alt="" loading="lazy" decoding="async" width="16" height="16" />
                          ) : null}
                          <span className="chain-pill-label">{c.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="onchain-timeframes" role="radiogroup" aria-label={tr('homePage.discoverySection.discovery.ariaTimeframe', "Timeframe")}>
                  {ONCHAIN_TIMEFRAMES.map(tf => (
                    <button
                      key={tf.id}
                      className={`onchain-tf${onchainTimeframe === tf.id ? ' is-active' : ''}`}
                      onClick={() => setOnchainTimeframe(tf.id)}
                      role="radio"
                      aria-checked={onchainTimeframe === tf.id}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* AI Agents: Category filter */}
            {topSectionTab === 'aiagents' && (
              <div className="discovery-filters-onchain-inline">
                {isMobile ? (
                  <GlassSelect
                    value={aiAgentCategoryFilter}
                    onChange={(e) => setAiAgentCategoryFilter(e.target.value)}
                    options={AI_AGENT_CATEGORIES.map(c => ({ value: c.id, label: c.label }))}
                    ariaLabel="Agent Category"
                  />
                ) : (
                  <div className="filter-group filter-group-chain-inline">
                    <span className="filter-label filter-label-inline">{tr('homePage.discoverySection.discovery.category', "Category")}</span>
                    <div className="filter-options">
                      {AI_AGENT_CATEGORIES.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`filter-option welcome-category-tab ${aiAgentCategoryFilter === c.id ? 'active' : ''}`}
                          onClick={() => setAiAgentCategoryFilter(c.id)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* AI Models: Category + Provider filters + View toggle */}
            {topSectionTab === 'aimodels' && (
              <div className="discovery-filters-onchain-inline ai-models-filters">
                {isMobile ? (
                  <>
                    <GlassSelect
                      value={aiModelCategoryFilter}
                      onChange={(e) => setAiModelCategoryFilter(e.target.value)}
                      options={AI_MODEL_CATEGORIES.map(c => ({ value: c.id, label: c.label }))}
                      ariaLabel="Model Category"
                    />
                    <GlassSelect
                      value={aiModelProviderFilter}
                      onChange={(e) => setAiModelProviderFilter(e.target.value)}
                      options={AI_MODEL_PROVIDERS.map(p => ({ value: p.id, label: p.label }))}
                      ariaLabel="Provider"
                    />
                  </>
                ) : (
                  <div className="ai-filters-dropdown-wrap" ref={aiFiltersRef}>
                    <button
                      type="button"
                      className={`ai-filters-trigger ${aiFiltersOpen ? 'is-open' : ''} ${aiActiveFilterCount > 0 ? 'has-active' : ''}`}
                      onClick={() => setAiFiltersOpen((v) => !v)}
                      aria-expanded={aiFiltersOpen}
                      aria-haspopup="true"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                      </svg>
                      <span>{t('common.filters', 'Filters')}</span>
                      {aiActiveFilterCount > 0 && (
                        <span className="ai-filters-count">{aiActiveFilterCount}</span>
                      )}
                      <svg className="ai-filters-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {aiActiveFilterCount > 0 && (
                      <button
                        type="button"
                        className="ai-filters-clear"
                        onClick={() => {
                          setAiModelCategoryFilter('all')
                          setAiModelProviderFilter('all')
                          setAiModelQualityFilter('all')
                        }}
                      >
                        {t('common.clear', 'Clear')}
                      </button>
                    )}
                    {aiFiltersOpen && (
                      <div className="ai-filters-popover" role="dialog" aria-label={tr('homePage.discoverySection.discovery.ariaAiModelFilters', "AI Model Filters")}>
                        <div className="ai-filters-popover-row">
                          <span className="ai-filters-popover-label">{tr('homePage.discoverySection.discovery.category', "Category")}</span>
                          <div className="ai-filters-popover-options">
                            {AI_MODEL_CATEGORIES.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                className={`ai-filter-pill ${aiModelCategoryFilter === c.id ? 'active' : ''}`}
                                onClick={() => setAiModelCategoryFilter(c.id)}
                              >
                                {c.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="ai-filters-popover-row">
                          <span className="ai-filters-popover-label">{tr('homePage.discoverySection.discovery.provider', "Provider")}</span>
                          <div className="ai-filters-popover-options">
                            {AI_MODEL_PROVIDERS.map((p) => {
                              const isActive = aiModelProviderFilter === p.id
                              const color = PROVIDER_COLORS[p.id]
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  className={`ai-filter-pill ai-filter-provider-pill ${isActive ? 'active' : ''}`}
                                  onClick={() => setAiModelProviderFilter(p.id)}
                                  style={color ? { '--pill-accent': color } : undefined}
                                >
                                  {color && <span className="ai-filter-pill-dot" style={{ background: color }} />}
                                  {p.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <div className="ai-filters-popover-row">
                          <span className="ai-filters-popover-label">{tr('homePage.discoverySection.discovery.quality', "Quality")}</span>
                          <div className="ai-filters-popover-options">
                            {AI_MODEL_QUALITY_TIERS.map((q) => (
                              <button
                                key={q.id}
                                type="button"
                                className={`ai-filter-pill ai-filter-quality-pill ai-filter-quality-${q.id} ${aiModelQualityFilter === q.id ? 'active' : ''}`}
                                onClick={() => setAiModelQualityFilter(q.id)}
                              >
                                {q.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="ai-model-view-toggle">
                  {['table', 'mindshare', 'trends'].map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`ai-model-view-btn ${aiModelViewMode === v ? 'active' : ''}`}
                      onClick={() => setAiModelViewMode(v)}
                    >
                      {v === 'table' ? 'Table' : v === 'mindshare' ? 'Mindshare' : 'Trends'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          <div className="discovery-filters-view">
            {topSectionTab === 'topcoins' && (
              <ShareXButton onClick={handleShareTopCoins} isExporting={isShareExporting} compact={isMobile} />
            )}
            {/* List/Grid toggle only matters for topcoins + onchain (which have
                both renderings). predictions/aiagents/aimodels render their own
                card layouts and ignore viewMode. */}
            {(topSectionTab === 'topcoins' || topSectionTab === 'onchain') && (
              <div className="view-toggle">
                <button
                  className={`view-btn ${(topSectionTab === 'onchain' ? onChainViewMode : viewMode) === 'list' ? 'active' : ''}`}
                  onClick={() => { topSectionTab === 'onchain' ? setOnChainViewMode('list') : setViewMode('list') }}
                  aria-label={t('discovery.listView', 'List view')}
                  aria-pressed={(topSectionTab === 'onchain' ? onChainViewMode : viewMode) === 'list'}
                  data-tooltip="List view"
                >
                  {icons.list}
                </button>
                <button
                  className={`view-btn ${(topSectionTab === 'onchain' ? onChainViewMode === 'grid' : viewMode === 'grid') ? 'active' : ''}`}
                  onClick={() => { topSectionTab === 'onchain' ? setOnChainViewMode('grid') : setViewMode('grid') }}
                  aria-label={t('discovery.gridView', 'Grid view')}
                  aria-pressed={(topSectionTab === 'onchain' ? onChainViewMode : viewMode) === 'grid'}
                  data-tooltip={topSectionTab === 'onchain' ? 'Block cards view' : 'Grid view'}
                >
                  {icons.grid}
                </button>
              </div>
            )}
          </div>
        </div>

        {topSectionTab === 'onchain' ? (
          <div className="onchain-section">
            {/* Split only wraps table/grid and chart so chart fits table height */}
            <div className={chartPanelToken ? 'discovery-section-split onchain-table-chart-split' : undefined}>
              <div className={chartPanelToken ? 'discovery-trending onchain-table-area' : undefined}>
                <div className={chartPanelToken ? `onchain-left-wrap token-list-wrap--compressed` : 'onchain-left-wrap'}>
            {onChainLoading && !sortedOnChain.length ? (
              <div className="tdt tdt-onchain tdt-loading-skeleton">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="tdt-row tdt-skeleton-row" style={{ animationDelay: `${i * 60}ms` }}>
                    <span className="tdt-rank skeleton-pulse" />
                    <span className="tdt-fav skeleton-pulse" />
                    <div className="tdt-project">
                      <div className="tdt-logo-wrap skeleton-pulse" />
                      <div className="tdt-project-text">
                        <span className="tdt-symbol skeleton-pulse" style={{ width: 48 }} />
                        <span className="tdt-name skeleton-pulse" style={{ width: 80 }} />
                      </div>
                    </div>
                    <span className="tdt-price skeleton-pulse" />
                    <span className="change-cell skeleton-pulse" />
                    <span className="change-cell skeleton-pulse" />
                    <span className="change-cell skeleton-pulse" />
                    <span className="change-cell skeleton-pulse" />
                    <span className="tdt-volume skeleton-pulse" />
                    <span className="tdt-mcap skeleton-pulse" />
                    <span className="tdt-volume skeleton-pulse" />
                    <div className="tdt-sparkline skeleton-pulse" />
                  </div>
                ))}
              </div>
            ) : sortedOnChain.length === 0 ? (
              <div className="tdt tdt-onchain">
                <div className="tdt-empty-state" role="status">
                  <span className="tdt-empty-title">{tr('homePage.discoverySection.discovery.noOnChainTokensMatch', "No on-chain tokens match")}</span>
                  <span className="tdt-empty-sub">
                    {onChainMcapBand !== 'all'
                      ? 'Try a different market-cap band or chain.'
                      : 'No trending DEX tokens on this chain right now.'}
                  </span>
                  {(onChainMcapBand !== 'all' || onChainChainFilter !== 'all') && (
                    <button
                      type="button"
                      className="tdt-empty-reset"
                      onClick={() => { setOnChainMcapBand('all'); setOnChainChainFilter('all') }}
                    >
                      {tr('homePage.discoverySection.discovery.resetFilters', "Reset filters")}
                    </button>
                  )}
                </div>
              </div>
            ) : onChainViewMode === 'grid' ? (
              <div className="tdt-grid tdt-grid-onchain">
                {displaySortedOnChain.map((row, index) => {
                  const logo = row.logo || TOKEN_LOGOS[row.symbol] || null
                  const chainLogo = CHAIN_LOGOS[row.networkId] || null
                  const change5m = row.change5m ?? 0
                  const change1h = row.change1h ?? 0
                  const change4h = row.change4h ?? 0
                  const change24h = row.change24h ?? 0
                  return (
                    <div
                      key={`${row.id || row.address || row.symbol || 'row'}-${index}`}
                      className="tdt-card"
                      style={{ '--card-index': index }}
                      onClick={() => handleOnChainCoinClick(row)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && handleOnChainCoinClick(row)}
                      aria-label={`Preview chart for ${row.symbol}`}
                    >
                      <div className="tdt-card-head">
                        <div className="tdt-card-rank-area">
                          <span className="tdt-card-rank">#{(isMobile ? (safeOnchainPage - 1) * ONCHAIN_PAGE_SIZE : 0) + index + 1}</span>
                          {row.age && <span className="tdt-age-badge">{row.age}</span>}
                        </div>
                        <div className="tdt-card-identity">
                          <div className="tdt-logo-wrap">
                            {logo
                              ? <img className="tdt-logo" src={logo} alt="" loading="lazy" decoding="async" width="32" height="32" onError={e => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex' }} />
                              : null}
                            <span className="tdt-logo-fallback" style={logo ? { display: 'none' } : {}}>{row.symbol?.slice(0, 2)}</span>
                            {chainLogo && <img className="tdt-chain-badge" src={chainLogo} alt="" loading="lazy" decoding="async" width="14" height="14" title={row.networkId} />}
                          </div>
                          <span className="tdt-symbol">{row.symbol}</span>
                          <span className="tdt-name">{row.name}</span>
                        </div>
                      </div>
                      <div className="tdt-card-price">
                        <span className="tdt-price">{fmtPrice(row.price)}</span>
                        <span className={`change-cell ${change24h >= 0 ? (change24h === 0 ? 'neutral' : 'bull') : 'bear'}`}>
                          {change24h >= 0 ? '+' : ''}{formatChange(change24h)}%
                        </span>
                      </div>
                      <div className="tdt-card-chart">
                        <Sparkline
                          data={row.sparkline_7d || row.sparkline || generateSeededSparkline(change24h, row.address || row.symbol)}
                          positive={change24h >= 0}
                          width={260}
                          height={48}
                        />
                      </div>
                      <div className="tdt-card-changes">
                        <div className="tdt-card-change">
                          <span className="tdt-card-change-label">5M</span>
                          <span className={`change-cell ${change5m >= 0 ? (change5m === 0 ? 'neutral' : 'bull') : 'bear'}`}>{change5m >= 0 ? '+' : ''}{formatChange(change5m)}%</span>
                        </div>
                        <div className="tdt-card-change">
                          <span className="tdt-card-change-label">1H</span>
                          <span className={`change-cell ${change1h >= 0 ? (change1h === 0 ? 'neutral' : 'bull') : 'bear'}`}>{change1h >= 0 ? '+' : ''}{formatChange(change1h)}%</span>
                        </div>
                        <div className="tdt-card-change">
                          <span className="tdt-card-change-label">4H</span>
                          <span className={`change-cell ${change4h >= 0 ? (change4h === 0 ? 'neutral' : 'bull') : 'bear'}`}>{change4h >= 0 ? '+' : ''}{formatChange(change4h)}%</span>
                        </div>
                      </div>
                      <div className="tdt-card-stats">
                        <div className="tdt-card-stat">
                          <span className="tdt-card-stat-label">{tr('homePage.discoverySection.discovery.vol', "Vol")}</span>
                          <span className="tdt-card-stat-value">{fmtLarge(row.volume)}</span>
                        </div>
                        <div className="tdt-card-stat">
                          <span className="tdt-card-stat-label">{tr('homePage.discoverySection.discovery.liq', "Liq")}</span>
                          <span className="tdt-card-stat-value">{fmtLarge(row.liquidity)}</span>
                        </div>
                      </div>
                      {row.boost != null && <span className="tdt-boost-badge">⚡{row.boost}</span>}
                    </div>
                  )
                })}
              </div>
            ) : (
            <div className="tdt tdt-onchain">
              {/* Sticky header — 12 columns */}
              <div className="tdt-header">
                <span className="th th-rank th-sortable" onClick={() => handleOnchainSort('rank')}>
                  # {effCol === 'rank' && <span className="sort-arrow">{effDir === 'asc' ? '↑' : '↓'}</span>}
                </span>
                <span className="th th-fav" />
                <span className="th th-project th-sortable" onClick={() => handleOnchainSort('name')}>
                  {t('topSection.token')} {effCol === 'name' && <span className="sort-arrow">{effDir === 'asc' ? '↑' : '↓'}</span>}
                </span>
                <span className="th th-price th-sortable" onClick={() => handleOnchainSort('price')}>
                  {t('topSection.price')} {effCol === 'price' && <span className="sort-arrow">{effDir === 'asc' ? '↑' : '↓'}</span>}
                </span>
                <span className={`th th-change th-sortable${onchainTimeframe === '5m' ? ' th-active' : ''}`} onClick={() => handleOnchainSort('change5m')}>
                  5M {effCol === 'change5m' && <span className="sort-arrow">{effDir === 'asc' ? '↑' : '↓'}</span>}
                </span>
                <span className={`th th-change th-sortable${onchainTimeframe === '1h' ? ' th-active' : ''}`} onClick={() => handleOnchainSort('change1h')}>
                  1H {effCol === 'change1h' && <span className="sort-arrow">{effDir === 'asc' ? '↑' : '↓'}</span>}
                </span>
                <span className={`th th-change th-sortable${onchainTimeframe === '4h' ? ' th-active' : ''}`} onClick={() => handleOnchainSort('change4h')}>
                  4H {effCol === 'change4h' && <span className="sort-arrow">{effDir === 'asc' ? '↑' : '↓'}</span>}
                </span>
                <span className={`th th-change th-sortable${onchainTimeframe === '24h' ? ' th-active' : ''}`} onClick={() => handleOnchainSort('change24h')}>
                  24H {effCol === 'change24h' && <span className="sort-arrow">{effDir === 'asc' ? '↑' : '↓'}</span>}
                </span>
                <span className="th th-volume th-sortable" onClick={() => handleOnchainSort('volume')}>
                  {t('topSection.volume')} {effCol === 'volume' && <span className="sort-arrow">{effDir === 'asc' ? '↑' : '↓'}</span>}
                </span>
                <span className="th th-mcap th-sortable" onClick={() => handleOnchainSort('mcap')}>
                  {t('topSection.mcap')} {effCol === 'mcap' && <span className="sort-arrow">{effDir === 'asc' ? '↑' : '↓'}</span>}
                </span>
                <span className="th th-volume th-sortable" onClick={() => handleOnchainSort('liquidity')}>
                  {t('topSection.liquidity')} {effCol === 'liquidity' && <span className="sort-arrow">{effDir === 'asc' ? '↑' : '↓'}</span>}
                </span>
                <span className="th th-sparkline">{tr('homePage.discoverySection.discovery.last7d', "LAST 7D")}</span>
              </div>

              {/* Data rows */}
              {displaySortedOnChain.map((row, index) => {
                const logo = row.logo || TOKEN_LOGOS[row.symbol] || null
                const chainLogo = CHAIN_LOGOS[row.networkId] || null
                // Codex hands back names already HTML-escaped, so Robinhood
                // equities rendered literally as "SPDR S&amp;P 500 ETF Trust".
                const rowName = typeof row.name === 'string' && row.name.includes('&')
                  ? decodeHtmlEntities(row.name)
                  : row.name
                const change5m = row.change5m ?? 0
                const change1h = row.change1h ?? 0
                const change4h = row.change4h ?? 0
                const change24h = row.change24h ?? 0
                return (
                  <div
                    key={`${row.id || row.address || row.symbol || 'row'}-${index}`}
                    className={`tdt-row${tabsOn && chartPanelToken?.symbol === row.symbol ? ' active' : ''}`}
                    style={{ animationDelay: `${index * 40}ms` }}
                    onClick={() => handleRowClick(() => handleOnChainCoinClick(row))}
                    onDoubleClick={(e) => handleRowDoubleClick(row, e)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleOnChainCoinClick(row)}
                    aria-label={`Preview chart for ${row.symbol}`}
                  >
                    {/* Heart burst animation overlay */}
                    {heartBurst?.id === (row.address || row.symbol) && (
                      <span className="dbl-heart-burst" key={heartBurst.key}>{icons.heartFilled}</span>
                    )}

                    {/* Rank — on mobile we slice by page, so offset the local index
                        so ranks stay absolute (page 2 shows 26…50 not 1…25). */}
                    <span className="tdt-rank">
                      {(isMobile ? (safeOnchainPage - 1) * ONCHAIN_PAGE_SIZE : 0) + index + 1}
                    </span>

                    {/* Favorite (watchlist) */}
                    <span className="tdt-fav">
                      {addToWatchlist && (
                        <button
                          type="button"
                          className={`topcoin-favorite-btn${checkIsInWatchlist(row) ? ' in-watchlist' : ''}`}
                          data-tooltip={checkIsInWatchlist(row) ? 'Remove from watchlist' : 'Add to watchlist'}
                          onClick={e => {
                            e.stopPropagation()
                            if (checkIsInWatchlist(row)) {
                              removeFromWatchlist && removeFromWatchlist(row.address || row.symbol)
                            } else {
                              addToWatchlist({ symbol: row.symbol, name: row.name, address: row.address, logo, price: row.price, change: change24h, marketCap: row.mcap, pinned: false })
                            }
                          }}
                        >
                          {checkIsInWatchlist(row) ? icons.heartFilled : icons.heart}
                        </button>
                      )}
                    </span>

                    {/* Mobile-only persistent star button. Rendered ONLY on mobile so
                        the desktop row has exactly 12 grid children (matching the header),
                        otherwise compressed-mode CSS targeting `:nth-child(7/10/11/12)`
                        hides the wrong columns and the sparkline lands under "VOLUME". */}
                    {isMobile && addToWatchlist && (
                      <button
                        type="button"
                        className={`tdt-onchain-star${checkIsInWatchlist(row) ? ' is-active' : ''}`}
                        onClick={e => {
                          e.stopPropagation()
                          if (checkIsInWatchlist(row)) {
                            removeFromWatchlist && removeFromWatchlist(row.address || row.symbol)
                          } else {
                            addToWatchlist({ symbol: row.symbol, name: row.name, address: row.address, logo, price: row.price, change: change24h, marketCap: row.mcap, pinned: false })
                          }
                        }}
                        aria-label={checkIsInWatchlist(row) ? 'Remove from watchlist' : 'Add to watchlist'}
                        aria-pressed={checkIsInWatchlist(row)}
                      >
                        {/* 13px glyph + stroke weights copied from MobileTokenList's
                            StarGlyph so the Top Coins and On-Chain stars match. */}
                        <svg viewBox="0 0 24 24" width="13" height="13"
                          fill={checkIsInWatchlist(row) ? 'currentColor' : 'none'}
                          stroke="currentColor"
                          strokeWidth={checkIsInWatchlist(row) ? '1.5' : '1.8'}
                          strokeLinecap="round" strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </button>
                    )}

                    {/* Project: logo with chain badge + names */}
                    <div className="tdt-project">
                      <div className="tdt-logo-wrap">
                        {logo
                          ? <img className="tdt-logo" src={logo} alt="" loading="lazy" onError={e => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex' }} />
                          : null}
                        <span className="tdt-logo-fallback" style={logo ? { display: 'none' } : {}}>{row.symbol?.slice(0, 2)}</span>
                        {chainLogo && <img className="tdt-chain-badge" src={chainLogo} alt="" title={row.networkId} />}
                      </div>
                      <div className="tdt-project-text">
                        <span className="tdt-symbol">
                          {row.symbol}
                          {row.age && <span className="tdt-age-badge">{row.age}</span>}
                        </span>
                        <span className="tdt-name">
                          {rowName}
                          {row.boost != null && <span className="tdt-boost-badge">⚡{row.boost}</span>}
                        </span>
                      </div>
                      <button className="token-list-info-btn" data-tooltip="Info" onClick={e => { e.stopPropagation(); openTopCoinInfo(row.symbol, e) }}>
                        {icons.info}
                      </button>
                    </div>

                    {/* Price */}
                    <span className="tdt-price">{fmtPrice(row.price)}</span>

                    {/* Change columns */}
                    <span className={`change-cell ${change5m >= 0 ? (change5m === 0 ? 'neutral' : 'bull') : 'bear'}${onchainTimeframe === '5m' ? ' change-active' : ''}`}>
                      {change5m >= 0 ? '+' : ''}{formatChange(change5m)}%
                    </span>
                    <span className={`change-cell ${change1h >= 0 ? (change1h === 0 ? 'neutral' : 'bull') : 'bear'}${onchainTimeframe === '1h' ? ' change-active' : ''}`}>
                      {change1h >= 0 ? '+' : ''}{formatChange(change1h)}%
                    </span>
                    <span className={`change-cell ${change4h >= 0 ? (change4h === 0 ? 'neutral' : 'bull') : 'bear'}${onchainTimeframe === '4h' ? ' change-active' : ''}`}>
                      {change4h >= 0 ? '+' : ''}{formatChange(change4h)}%
                    </span>
                    <span className={`change-cell ${change24h >= 0 ? (change24h === 0 ? 'neutral' : 'bull') : 'bear'}${onchainTimeframe === '24h' ? ' change-active' : ''}`}>
                      {change24h >= 0 ? '+' : ''}{formatChange(change24h)}%
                    </span>

                    {/* Volume / MCap / Liquidity */}
                    <span className="tdt-volume">{fmtLarge(row.volume)}</span>
                    <span className="tdt-mcap">{fmtLarge(row.mcap)}</span>
                    <span className="tdt-volume">{fmtLarge(row.liquidity)}</span>

                    {/* Sparkline — falls back to seeded synthetic curve so on-chain
                        rows (Codex trending, no 7d history) still show momentum. */}
                    <div className="tdt-sparkline">
                      <Sparkline
                        data={row.sparkline_7d || row.sparkline || generateSeededSparkline(change24h, row.address || row.symbol)}
                        positive={change24h >= 0}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            )}
            {/* Mobile-only numbered pagination for On-Chain. Desktop keeps
                its infinite-scroll table unchanged. */}
            {isMobile && onchainTotalPages > 1 && (
              <MobilePagination
                currentPage={safeOnchainPage}
                totalPages={onchainTotalPages}
                onSelect={handleOnchainPageSelect}
                rangeLabel={onchainRangeLabel}
              />
            )}
                </div>
              </div>
              {chartPanelToken && (
                <div className="discovery-chart-side onchain-chart-side">
                  {renderChartPanel(true)}
                </div>
              )}
            </div>
          </div>
        ) : topSectionTab === 'social' ? (
          <Suspense fallback={null}>
          <SocialMindshareSection
            onTokenClick={(token) => {
              // Social rows open the AI Screener (same surface as the On-Chain
              // tab + the /x-dash table's "S" button), not the Research Zone.
              // buildOnChainTokenPayload carries cgId so majors resolve by
              // CoinGecko id and DEX tokens by contract address.
              handleOnChainCoinClick({
                symbol: token.asset,
                name: token.name || token.asset,
                address: token.address || null,
                networkId: token.networkId ?? 1,
                coingecko_id: token.coingecko_id,
                change24h: token.price_change_24h ?? 0,
                price: token.price_usd,
                logo: token.image,
              })
            }}
          />
          </Suspense>
        ) : topSectionTab === 'predictions' ? (
          <div className="predictions-section">
            <div className="predictions-section-header">
              <span className={`predictions-section-badge${predictionsLoading ? ' is-loading' : ''}`}>
                {predictionsLoading ? t('topSection.loading') : t('topSection.live')}
              </span>
              <h2 className="predictions-section-title">{t('topSection.predictionMarkets')}</h2>
              <p className="predictions-section-sub">{t('topSection.predictionSubtitle')}</p>
              <span className="predictions-view-all" onClick={() => navigate(getPathForPageId('predictions'), { state: { fromWelcome: true } })}>View All &rarr;</span>
            </div>
            <div className="predictions-grid">
              {predictionsLoading && filteredPredictions.length === 0 ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <div key={`skel-${i}`} className="predictions-card predictions-card-skeleton" style={{ '--card-index': i }} aria-hidden="true">
                    <div className="predictions-card-head">
                      <span className="predictions-card-img skeleton-shimmer" />
                      <span className="predictions-card-pill-skel skeleton-shimmer" />
                    </div>
                    <div className="predictions-card-question-skel-wrap">
                      <div className="predictions-card-question-skel skeleton-shimmer" />
                      <div className="predictions-card-question-skel predictions-card-question-skel--short skeleton-shimmer" />
                    </div>
                    <div className="predictions-bar-wrap">
                      <div className="predictions-bar skeleton-shimmer" />
                      <div className="predictions-bar-labels">
                        <span className="predictions-bar-label-skel skeleton-shimmer" />
                        <span className="predictions-bar-label-skel predictions-bar-label-skel--right skeleton-shimmer" />
                      </div>
                    </div>
                    <div className="predictions-card-meta">
                      <span className="predictions-card-meta-skel skeleton-shimmer" />
                      <span className="predictions-card-meta-skel predictions-card-meta-skel--mid skeleton-shimmer" />
                      <span className="predictions-card-meta-skel predictions-card-meta-skel--short skeleton-shimmer" />
                    </div>
                  </div>
                ))
              ) : filteredPredictions.map((row, index) => {
                const noPct = 100 - (row.yesPct ?? 50)
                const rowUrl = row.url || 'https://polymarket.com'
                const cat = (row.category || 'other').toLowerCase()
                const CAT_LABELS = { economy: 'Stocks', crypto: 'Crypto', politics: 'Politics', sports: 'Sports', science: 'Science', culture: 'Culture', other: 'Other' }
                const catLabel = CAT_LABELS[cat] || (row.category ? row.category.charAt(0).toUpperCase() + row.category.slice(1) : 'Other')
                const hasImage = row.image && row.image.startsWith('http')
                const slug = rowUrl.split('/event/')[1]?.split('/')[0]
                return (
                  <div
                    key={row.id}
                    className="predictions-card"
                    style={{ '--card-index': index }}
                    onClick={() => {
                      if (slug) {
                        navigate(`/predictions/${slug}`, { state: { fromWelcome: true } })
                      } else {
                        window.open(rowUrl, '_blank')
                      }
                    }}
                  >
                    <div className="predictions-card-head">
                      {hasImage ? (
                        <img src={row.image} alt="" className="predictions-card-img" loading="lazy" />
                      ) : (
                        <span className={`predictions-card-img predictions-card-img--fallback predictions-card-img--${cat}`}>
                          {(row.category || '?')[0]}
                        </span>
                      )}
                      <span className={`predictions-card-pill predictions-pill-${cat}`}>{catLabel}</span>
                    </div>
                    <p className="predictions-card-question">{row.question}</p>
                    <div className="predictions-bar-wrap">
                      <div className="predictions-bar">
                        <div className="predictions-bar-yes" style={{ width: `${row.yesPct}%` }} />
                      </div>
                      <div className="predictions-bar-labels">
                        <span className="predictions-bar-label predictions-bar-label--yes">Yes {row.yesPct}%</span>
                        <span className="predictions-bar-label predictions-bar-label--no">No {noPct}%</span>
                      </div>
                    </div>
                    <div className="predictions-card-meta">
                      <span className="predictions-card-stat">{fmtLarge(row.volume)} vol</span>
                      <span className="predictions-card-dot">&middot;</span>
                      <span className="predictions-card-stat">{fmtLarge(row.liquidity || row.volume)} liq</span>
                      <span className="predictions-card-dot">&middot;</span>
                      <span className="predictions-card-stat">{row.endDate}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : topSectionTab === 'aiagents' ? (
          <div className="ai-agents-section">
            {/* 2026-05-26 beta-quality fix: empty-state until real agent feed wired */}
            {filteredAiAgents.length === 0 ? (
              <div className="welcome-market-ai-placeholder" style={{ padding: '48px 24px', textAlign: 'center' }}>
                AI agent intelligence is coming soon. Live revenue, x402 payments, and agent demand data will appear here.
              </div>
            ) : isMobile ? (
              /* ── Mobile: compact card rows ── */
              <div className="ai-agents-mobile-list">
                {filteredAiAgents.map((agent, index) => (
                  <div key={agent.id} className="ai-agent-mobile-row">
                    <span className="ai-agent-mobile-rank">{index + 1}</span>
                    <span className="ai-agent-avatar">
                      {AI_AGENT_LOGOS[agent.name] && (
                        <img
                          src={AI_AGENT_LOGOS[agent.name]}
                          alt=""
                          className="ai-agent-logo-img"
                          loading="lazy"
                          onError={(e) => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex' }}
                        />
                      )}
                      <span
                        className="ai-agent-initials"
                        style={AI_AGENT_LOGOS[agent.name] ? { display: 'none' } : {}}
                      >
                        {agent.name.slice(0, 2).toUpperCase()}
                      </span>
                    </span>
                    <span className="ai-agent-mobile-info">
                      <span className="ai-agent-mobile-top">
                        <span className="ai-agent-name">{agent.name}</span>
                        {agent.modelUsed && <span className="ai-agent-model-badge">{agent.modelUsed}</span>}
                      </span>
                      <span className="ai-agent-mobile-bottom">
                        <span className="ai-agent-creator">{agent.creator}</span>
                        <span className="ai-agent-mobile-dot">·</span>
                        <span className="ai-category-badge">{agent.category}</span>
                      </span>
                    </span>
                    <span className="ai-agent-mobile-stats">
                      <span className="ai-agent-mobile-revenue">{fmtLarge(agent.revenue30d)}</span>
                      <span className={`ai-growth-pill ${agent.growthPct >= 0 ? 'positive' : 'negative'}`}>
                        {agent.growthPct >= 0 ? '+' : ''}{agent.growthPct.toFixed(1)}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              /* ── Desktop: full table ── */
              <div className="ai-agents-table-wrap token-list-wrap">
                <div className="ai-agents-table token-list-screener">
                  <div className="ai-agents-table-header token-list-header">
                    <span className="list-col ai-rank-col">#</span>
                    <span className="list-col ai-agent-col ai-sortable" onClick={() => toggleAgentSort('name')}>
                      Agent {aiAgentSortBy === 'name' && <span className="ai-sort-arrow">{aiAgentSortDir === 'asc' ? '↑' : '↓'}</span>}
                    </span>
                    <span className="list-col ai-category-col">{tr('homePage.discoverySection.discovery.category', "Category")}</span>
                    <span className="list-col ai-revenue-col ai-sortable" onClick={() => toggleAgentSort('revenue30d')}>
                      Revenue 30d {aiAgentSortBy === 'revenue30d' && <span className="ai-sort-arrow">{aiAgentSortDir === 'asc' ? '↑' : '↓'}</span>}
                    </span>
                    <span className="list-col ai-x402-col ai-sortable" onClick={() => toggleAgentSort('x402Payments')}>
                      x402 Payments {aiAgentSortBy === 'x402Payments' && <span className="ai-sort-arrow">{aiAgentSortDir === 'asc' ? '↑' : '↓'}</span>}
                    </span>
                    <span className="list-col ai-users-col ai-sortable" onClick={() => toggleAgentSort('dailyUsers')}>
                      Daily Users {aiAgentSortBy === 'dailyUsers' && <span className="ai-sort-arrow">{aiAgentSortDir === 'asc' ? '↑' : '↓'}</span>}
                    </span>
                    <span className="list-col ai-growth-col ai-sortable" onClick={() => toggleAgentSort('growthPct')}>
                      Growth {aiAgentSortBy === 'growthPct' && <span className="ai-sort-arrow">{aiAgentSortDir === 'asc' ? '↑' : '↓'}</span>}
                    </span>
                    <span className="list-col ai-status-col">{tr('homePage.discoverySection.discovery.status', "Status")}</span>
                  </div>
                  {filteredAiAgents.map((agent, index) => (
                    <div key={agent.id} className="ai-agents-table-row token-list-row">
                      <span className="list-col ai-rank-col">{index + 1}</span>
                      <span className="list-col ai-agent-col">
                        <span className="ai-agent-avatar">
                          {AI_AGENT_LOGOS[agent.name] && (
                            <img
                              src={AI_AGENT_LOGOS[agent.name]}
                              alt=""
                              className="ai-agent-logo-img"
                              loading="lazy"
                              onError={(e) => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex' }}
                            />
                          )}
                          <span
                            className="ai-agent-initials"
                            style={AI_AGENT_LOGOS[agent.name] ? { display: 'none' } : {}}
                          >
                            {agent.name.slice(0, 2).toUpperCase()}
                          </span>
                        </span>
                        <span className="ai-agent-meta">
                          <span className="ai-agent-name-row">
                            <span className="ai-agent-name">{agent.name}</span>
                            {agent.modelUsed && <span className="ai-agent-model-badge">{agent.modelUsed}</span>}
                          </span>
                          <span className="ai-agent-creator">{agent.creator}</span>
                        </span>
                      </span>
                      <span className="list-col ai-category-col">
                        <span className="ai-category-badge">{agent.category}</span>
                      </span>
                      <span className="list-col ai-revenue-col">{fmtLarge(agent.revenue30d)}</span>
                      <span className="list-col ai-x402-col">{agent.x402Payments.toLocaleString()}</span>
                      <span className="list-col ai-users-col">{agent.dailyUsers >= 1000 ? `${(agent.dailyUsers / 1000).toFixed(1)}K` : agent.dailyUsers.toLocaleString()}</span>
                      <span className="list-col ai-growth-col">
                        <span className={`ai-growth-pill ${agent.growthPct >= 0 ? 'positive' : 'negative'}`}>
                          {agent.growthPct >= 0 ? '+' : ''}{agent.growthPct.toFixed(1)}%
                        </span>
                      </span>
                      <span className="list-col ai-status-col">
                        <span className={`ai-status-dot ai-status-${agent.status}`} />
                        <span className="ai-status-label">{agent.status}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : topSectionTab === 'aimodels' ? (
          <div className="ai-models-section">
            {/* 2026-05-26 beta-quality fix: empty-state until real model leaderboard wired */}
            {filteredAiModels.length === 0 ? (
              <div className="welcome-market-ai-placeholder" style={{ padding: '48px 24px', textAlign: 'center' }}>
                AI model leaderboard is coming soon. Live ELO, request volume, mindshare, and pricing will appear here.
              </div>
            ) : isMobile ? (
              /* ── Mobile: compact card rows ── */
              <div className="ai-models-mobile-list">
                {filteredAiModels.map((model, index) => (
                  <div key={model.id} className="ai-model-mobile-row">
                    <span className="ai-model-mobile-rank">{index + 1}</span>
                    <span className="ai-model-provider-avatar">
                      {AI_PROVIDER_LOGOS[model.provider] ? (
                        <img src={AI_PROVIDER_LOGOS[model.provider]} alt="" className="ai-provider-logo-img" loading="lazy" />
                      ) : (
                        <span className="ai-provider-dot" style={{ background: PROVIDER_COLORS[model.provider] || '#888' }} />
                      )}
                    </span>
                    <span className="ai-model-mobile-info">
                      <span className="ai-model-mobile-top">
                        <span className="ai-model-name">{model.name}</span>
                        {model.trending && <span className="ai-trending-badge">{tr('homePage.discoverySection.discovery.trending', "trending")}</span>}
                      </span>
                      <span className="ai-model-mobile-bottom">
                        <span>{model.provider}</span>
                        <span className="ai-model-mobile-dot">·</span>
                        <span className="ai-category-badge">{model.category}</span>
                      </span>
                    </span>
                    <span className="ai-model-mobile-stats">
                      <span className="ai-model-mobile-elo">{model.elo > 0 ? model.elo : '-'}</span>
                      <span className="ai-model-mobile-requests">{model.dailyRequests >= 1e6 ? `${(model.dailyRequests / 1e6).toFixed(1)}M req` : model.dailyRequests >= 1000 ? `${(model.dailyRequests / 1000).toFixed(0)}K req` : `${model.dailyRequests} req`}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : aiModelViewMode === 'table' ? (
              <div className="ai-models-table-wrap token-list-wrap">
                <div className="ai-models-table token-list-screener">
                  <div className="ai-models-table-header token-list-header">
                    <span className="list-col ai-rank-col">#</span>
                    <span className="list-col ai-model-col ai-sortable" onClick={() => toggleModelSort('name')}>
                      Model {aiModelSortBy === 'name' && <span className="ai-sort-arrow">{aiModelSortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
                    </span>
                    <span className="list-col ai-provider-col">{tr('homePage.discoverySection.discovery.provider', "Provider")}</span>
                    <span className="list-col ai-mcategory-col">{tr('homePage.discoverySection.discovery.type', "Type")}</span>
                    <span className="list-col ai-elo-col ai-sortable" onClick={() => toggleModelSort('elo')}>
                      ELO {aiModelSortBy === 'elo' && <span className="ai-sort-arrow">{aiModelSortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
                    </span>
                    <span className="list-col ai-requests-col ai-sortable" onClick={() => toggleModelSort('dailyRequests')}>
                      Requests {aiModelSortBy === 'dailyRequests' && <span className="ai-sort-arrow">{aiModelSortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
                    </span>
                    <span className="list-col ai-agentdemand-col ai-sortable" onClick={() => toggleModelSort('agentDemandPct')}>
                      Agent Demand {aiModelSortBy === 'agentDemandPct' && <span className="ai-sort-arrow">{aiModelSortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
                    </span>
                    <span className="list-col ai-mindshare-col ai-sortable" onClick={() => toggleModelSort('mindsharePct')}>
                      Mindshare {aiModelSortBy === 'mindsharePct' && <span className="ai-sort-arrow">{aiModelSortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
                    </span>
                    <span className="list-col ai-quality-col ai-sortable" onClick={() => toggleModelSort('qualityScore')}>
                      Quality {aiModelSortBy === 'qualityScore' && <span className="ai-sort-arrow">{aiModelSortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
                    </span>
                    <span className="list-col ai-cost-col ai-sortable" onClick={() => toggleModelSort('costPer1M')}>
                      $/1M tok {aiModelSortBy === 'costPer1M' && <span className="ai-sort-arrow">{aiModelSortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
                    </span>
                  </div>
                  {filteredAiModels.map((model, index) => (
                    <div key={model.id} className={`ai-models-table-row token-list-row ${model.trending ? 'ai-model-trending' : ''}`}>
                      <span className="list-col ai-rank-col">{index + 1}</span>
                      <span className="list-col ai-model-col">
                        <span className="ai-model-provider-avatar">
                          {AI_PROVIDER_LOGOS[model.provider] ? (
                            <img src={AI_PROVIDER_LOGOS[model.provider]} alt="" className="ai-provider-logo-img" loading="lazy" />
                          ) : (
                            <span className="ai-provider-dot" style={{ background: PROVIDER_COLORS[model.provider] || '#888' }} />
                          )}
                        </span>
                        <span className="ai-model-name">{model.name}</span>
                        {model.trending && <span className="ai-trending-badge">{tr('homePage.discoverySection.discovery.trending', "trending")}</span>}
                      </span>
                      <span className="list-col ai-provider-col">
                        <span
                          className="ai-provider-badge"
                          style={{
                            '--provider-color': PROVIDER_COLORS[model.provider] || '#888',
                          }}
                        >
                          <span className="ai-provider-dot-mini" style={{ background: PROVIDER_COLORS[model.provider] || '#888' }} />
                          {AI_MODEL_PROVIDERS.find((p) => p.id === model.provider)?.label || model.provider}
                        </span>
                      </span>
                      <span className="list-col ai-mcategory-col">
                        <span className="ai-category-badge">{model.category}</span>
                      </span>
                      <span className="list-col ai-elo-col">{model.elo > 0 ? model.elo : '-'}</span>
                      <span className="list-col ai-requests-col">{model.dailyRequests >= 1e6 ? `${(model.dailyRequests / 1e6).toFixed(1)}M` : model.dailyRequests >= 1000 ? `${(model.dailyRequests / 1000).toFixed(0)}K` : model.dailyRequests.toLocaleString()}</span>
                      <span className="list-col ai-agentdemand-col">
                        <span className={`ai-agentdemand-wrap${model.agentDemandPct >= 50 ? ' is-high' : model.agentDemandPct < 15 ? ' is-low' : ' is-mid'}`}>
                          <span className="ai-agentdemand-bar-track">
                            <span className="ai-agentdemand-bar-fill" style={{ width: `${model.agentDemandPct}%` }} />
                          </span>
                          <span className="ai-agentdemand-value">{model.agentDemandPct}%</span>
                        </span>
                      </span>
                      <span className="list-col ai-mindshare-col">
                        <span className="ai-mindshare-bar-wrap">
                          <span className="ai-mindshare-bar-track">
                            <span className="ai-mindshare-bar" style={{ width: `${Math.min(100, model.mindsharePct * 4)}%`, background: PROVIDER_COLORS[model.provider] || '#888' }} />
                          </span>
                          <span className="ai-mindshare-value">{model.mindsharePct}%</span>
                        </span>
                      </span>
                      <span className="list-col ai-quality-col">
                        <span className={`ai-quality-score ai-quality-${model.qualityScore >= 90 ? 'elite' : model.qualityScore >= 80 ? 'high' : model.qualityScore >= 70 ? 'mid' : 'low'}`}>
                          {model.qualityScore}
                        </span>
                        <span className="ai-quality-max">/100</span>
                      </span>
                      <span className={`list-col ai-cost-col${model.costPer1M === 0 ? ' is-free' : ''}`}>{model.costPer1M > 0 ? `$${model.costPer1M}` : 'Free'}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : aiModelViewMode === 'mindshare' ? (
              <div className="ai-models-mindshare">
                <div className="ai-mindshare-chart-wrap">
                  {(() => {
                    const sorted = [...filteredAiModels].sort((a, b) => b.mindsharePct - a.mindsharePct).slice(0, 12)
                    const maxPct = Math.max(...sorted.map(m => m.mindsharePct))
                    return sorted.map((model) => (
                      <div key={model.id} className="ai-mindshare-bar-row">
                        <span className="ai-mindshare-bar-label">
                          {AI_PROVIDER_LOGOS[model.provider] && (
                            <img src={AI_PROVIDER_LOGOS[model.provider]} alt="" className="ai-mindshare-bar-logo" loading="lazy" />
                          )}
                          {model.name}
                        </span>
                        <div className="ai-mindshare-bar-track">
                          <div
                            className="ai-mindshare-bar-fill"
                            style={{ width: `${(model.mindsharePct / maxPct) * 100}%`, background: PROVIDER_COLORS[model.provider] || '#888' }}
                          />
                        </div>
                        <span className="ai-mindshare-bar-pct">{model.mindsharePct}%</span>
                      </div>
                    ))
                  })()}
                </div>
                <div className="ai-mindshare-grid">
                  {[...filteredAiModels].sort((a, b) => b.mindsharePct - a.mindsharePct).map((model) => (
                    <div key={model.id} className="ai-mindshare-card">
                      <div className="ai-mindshare-card-header">
                        <span className="ai-mindshare-card-avatar">
                          {AI_PROVIDER_LOGOS[model.provider] ? (
                            <img src={AI_PROVIDER_LOGOS[model.provider]} alt="" className="ai-provider-logo-img" loading="lazy" />
                          ) : (
                            <span className="ai-provider-dot" style={{ background: PROVIDER_COLORS[model.provider] || '#888' }} />
                          )}
                        </span>
                        <span className="ai-mindshare-card-name">{model.name}</span>
                      </div>
                      <div className="ai-mindshare-card-stats">
                        <span className="ai-mindshare-card-pct">{model.mindsharePct}%</span>
                        <span className="ai-mindshare-card-label">{tr('homePage.discoverySection.discovery.mindshare', "mindshare")}</span>
                      </div>
                      <div className="ai-mindshare-card-meta">
                        <span>{model.dailyRequests >= 1e6 ? `${(model.dailyRequests / 1e6).toFixed(1)}M` : model.dailyRequests >= 1000 ? `${(model.dailyRequests / 1000).toFixed(0)}K` : model.dailyRequests.toLocaleString()} req/day</span>
                        <span>ELO {model.elo > 0 ? model.elo : 'N/A'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="ai-models-trends">
                <div className="ai-trends-chart-wrap">
                  <div className="ai-trends-table">
                    <div className="ai-trends-table-header">
                      <span className="ai-trends-col ai-trends-model-col">{tr('homePage.discoverySection.discovery.model', "Model")}</span>
                      {aiModelEloTrends.map((d) => (
                        <span key={d.month} className="ai-trends-col ai-trends-month-col">{d.month}</span>
                      ))}
                      <span className="ai-trends-col ai-trends-change-col">{tr('homePage.discoverySection.discovery.change', "Change")}</span>
                    </div>
                    {[
                      { name: 'Claude Opus 4.6', color: '#D97757' },
                      { name: 'GPT-4o', color: '#10A37F' },
                      { name: 'Gemini 2.5 Pro', color: '#4285F4' },
                      { name: 'GPT-o3', color: '#34D399' },
                      { name: 'Claude Sonnet 4.6', color: '#F59E0B' },
                      { name: 'DeepSeek R1', color: '#4D6BFE' },
                    ].map(({ name, color }) => {
                      const first = aiModelEloTrends[0]?.[name] || 0
                      const last = aiModelEloTrends[aiModelEloTrends.length - 1]?.[name] || 0
                      const change = last - first
                      return (
                        <div key={name} className="ai-trends-table-row">
                          <span className="ai-trends-col ai-trends-model-col">
                            <span className="ai-trends-legend-dot" style={{ background: color }} />
                            {name}
                          </span>
                          {aiModelEloTrends.map((d) => (
                            <span key={d.month} className="ai-trends-col ai-trends-month-col ai-trends-elo-val">
                              {d[name]}
                            </span>
                          ))}
                          <span className={`ai-trends-col ai-trends-change-col ${change >= 0 ? 'positive' : 'negative'}`}>
                            {change >= 0 ? '+' : ''}{change}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="ai-trends-legend">
                  <span className="ai-trends-legend-item"><span className="ai-trends-legend-dot" style={{ background: '#D97757' }} />{tr('homePage.discoverySection.discovery.claudeOpus46', "Claude Opus 4.6")}</span>
                  <span className="ai-trends-legend-item"><span className="ai-trends-legend-dot" style={{ background: '#10A37F' }} />{tr('homePage.discoverySection.discovery.gpt4o', "GPT-4o")}</span>
                  <span className="ai-trends-legend-item"><span className="ai-trends-legend-dot" style={{ background: '#4285F4' }} />{tr('homePage.discoverySection.discovery.gemini25Pro', "Gemini 2.5 Pro")}</span>
                  <span className="ai-trends-legend-item"><span className="ai-trends-legend-dot" style={{ background: '#34D399' }} />{tr('homePage.discoverySection.discovery.gptO3', "GPT-o3")}</span>
                  <span className="ai-trends-legend-item"><span className="ai-trends-legend-dot" style={{ background: '#F59E0B' }} />{tr('homePage.discoverySection.discovery.claudeSonnet46', "Claude Sonnet 4.6")}</span>
                  <span className="ai-trends-legend-item"><span className="ai-trends-legend-dot" style={{ background: '#4D6BFE' }} />{tr('homePage.discoverySection.discovery.deepseekR1', "DeepSeek R1")}</span>
                </div>
              </div>
            )}
          </div>
        ) : topSectionTab === 'warroom' ? (
          <WarRoomTab topCoinPrices={topCoinPrices} fearGreed={fearGreed} isStocks={isStocks} watchlist={watchlist} />
        ) : (
        <>
        {/* ── Mobile: MobileTokenList replaces desktop table/grid ── */}
        {isMobile && (
          <MobileTokenList
            tokens={displayTopCoins}
            loading={(topCoinsLoading && displayTopCoins.length === 0) || (loading && tokens.length === 0)}
            onSelect={isStocks ? handleStockClick : handleTopCoinClick}
            onAddToWatchlist={addToWatchlist ? (token) => {
              const sym = (token.symbol || '').toUpperCase()
              const normalizedToken = { ...token, symbol: sym }
              if (checkIsInWatchlist(normalizedToken)) {
                removeFromWatchlist && removeFromWatchlist(token.address || sym)
              } else {
                addToWatchlist({ symbol: sym, name: token.name, address: token.address, logo: token.logo || token.image, price: token.price, change: token.change ?? token.priceChange24h, marketCap: token.marketCap, pinned: false })
              }
            } : undefined}
            isInWatchlist={(token) => checkIsInWatchlist({ ...token, symbol: (token?.symbol || '').toUpperCase() })}
            // The Favorites pill renders the watchlist itself, not a filter of
            // the loaded top-coins page — otherwise a starred coin outside that
            // page is in your watchlist but absent from Favorites.
            favoriteTokens={watchlistWithLiveData?.length ? watchlistWithLiveData : watchlist}
            dayMode={dayMode}
            pageOffset={0}
            // Mobile scrolls the page through the list (CMC) instead of
            // paging it — the server-page jump props are desktop-only now.
            onLoadNextPage={!isStocks && !showWatchlist ? loadNextTopCoinsPage : undefined}
            hasMorePages={hasMorePages}
            isLoadingMore={topCoinsLoading && displayTopCoins.length > 0}
          />
        )}

        {/* ── Desktop: existing table/grid ── */}
        {!isMobile && (
        <div className={tabsOn && chartPanelToken ? 'discovery-section-split' : undefined}>
          <div className={tabsOn && chartPanelToken ? 'discovery-trending' : undefined}>
            <div className={`token-list-wrap ${tabsOn && chartPanelToken ? 'token-list-wrap--compressed' : ''} ${topCoinsLoading && displayTopCoins.length > 0 ? 'token-list-loading' : ''}`}>
        {(topCoinsLoading && displayTopCoins.length === 0) || (loading && tokens.length === 0) ? (
          showWatchlist ? (
            <div className="loading-state">
              <div className="animate-shimmer" style={{ width: '100%', height: 48, borderRadius: 'var(--radius-sm)' }}></div>
              <span>{tr('homePage.discoverySection.discovery.noWatchlistTokensFound', "No watchlist tokens found")}</span>
            </div>
          ) : (
            /* Row skeleton matching the tdt-top-coins column grid (mirrors the
               On-Chain tab's loading skeleton) instead of a single shimmer bar -
               the table shape is visible before data lands, so the cold-load
               feels faster and there's no layout jump. */
            <div className="tdt tdt-top-coins tdt-loading-skeleton">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="tdt-row tdt-skeleton-row" style={{ animationDelay: `${i * 60}ms` }}>
                  <span className="tdt-rank skeleton-pulse" />
                  <span className="tdt-fav skeleton-pulse" />
                  <div className="tdt-project">
                    <div className="tdt-logo-wrap skeleton-pulse" />
                    <div className="tdt-project-text">
                      <span className="tdt-symbol skeleton-pulse" style={{ width: 48 }} />
                      <span className="tdt-name skeleton-pulse" style={{ width: 80 }} />
                    </div>
                  </div>
                  <span className="tdt-price skeleton-pulse" />
                  <span className="change-cell skeleton-pulse" />
                  <span className="change-cell skeleton-pulse" />
                  <span className="change-cell skeleton-pulse" />
                  <span className="change-cell skeleton-pulse" />
                  <span className="tdt-mcap skeleton-pulse" />
                  <span className="tdt-volume skeleton-pulse" />
                  <div className="tdt-sparkline skeleton-pulse" />
                </div>
              ))}
            </div>
          )
        ) : (viewMode === 'grid') ? (
          <div className="tdt-grid">
            {displayTopCoins.map((token, index) => (
              <div
                key={`${token.symbol}-${token.rank}-${index}`}
                className={`tdt-card${compareMode && isTokenSelected(token.address || token.symbol) ? ' is-selected' : ''}`}
                onClick={() => compareMode ? toggleCompareToken(token, { stopPropagation: () => {} }) : (isStocks ? handleStockClick(token) : handleTopCoinClick(token))}
                style={{ animationDelay: `${index * 50}ms` }}
                {...(!isStocks && !compareMode ? hoverIntent(() => {
                  if (!allowDataPrefetch()) return
                  prewarmResearchZone(token.symbol)
                  prefetchRoute('research-zone')
                }) : {})}
              >
                {/* Head: rank + identity */}
                <div className="tdt-card-head">
                  <div className="tdt-card-rank-area">
                    {compareMode && (
                      <label className="tdt-checkbox" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isTokenSelected(token.address || token.symbol)} onChange={() => toggleCompareToken(token, { stopPropagation: () => {} })} />
                        <span className="tdt-check-mark" />
                      </label>
                    )}
                    <span className="tdt-card-rank">
                      #{token.rank || (topCoinsPage - 1) * TOP_COINS_PAGE_SIZE + index + 1}
                      {token.globalRank != null && token.globalRank !== token.rank && (
                        <span className="tdt-rank-global"> · #{token.globalRank}</span>
                      )}
                    </span>
                  </div>
                  <div className="tdt-card-identity">
                    <img className="tdt-logo" src={token.logo || TOKEN_LOGOS[token.symbol?.toUpperCase()] || TOKEN_LOGOS[token.name] || `https://assets.coingecko.com/coins/images/1/small/bitcoin.png`} alt=""
                         loading="lazy"
                         decoding="async"
                         width="32"
                         height="32"
                         onError={e => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex' }} />
                    <span className="tdt-logo-fallback" style={{ display: 'none' }}>{getTokenInitials(token.symbol)}</span>
                    <div className="tdt-card-names">
                      <span className="tdt-symbol">{token.symbol}</span>
                      <span className="tdt-name">{token.name}</span>
                    </div>
                  </div>
                </div>

                {/* Price + change pill */}
                <div className="tdt-card-price">
                  <span className="tdt-price">{fmtPrice(token.price)}</span>
                  <span className={`change-cell ${(token.change || 0) >= 0 ? ((token.change || 0) === 0 ? 'neutral' : 'bull') : 'bear'}`}>
                    {(token.change || 0) >= 0 ? '+' : ''}{formatChange(token.change || 0)}%
                  </span>
                </div>

                {/* Chart — real CoinGecko 7d sparkline, with seeded synthetic
                    fallback when CG didn't return one for this coin. Color
                    matches the 7d trend so a green line never paints red and
                    vice versa. */}
                <div className="tdt-card-chart">
                  {(() => {
                    const hasReal = Array.isArray(token.sparkline_7d) && token.sparkline_7d.length > 1
                    const sparkData = hasReal
                      ? token.sparkline_7d
                      : generateSeededSparkline(token.change || 0, token.address || token.symbol)
                    const colorChange = hasReal
                      ? (token.change7d != null ? Number(token.change7d) : (token.change || 0))
                      : (token.change || 0)
                    return <Sparkline data={sparkData} positive={colorChange >= 0} width={400} height={80} />
                  })()}
                </div>

                {/* Stats footer */}
                <div className="tdt-card-stats">
                  <div className="tdt-card-stat">
                    <span className="tdt-card-stat-label">{tr('homePage.discoverySection.discovery.vol', "Vol")}</span>
                    <span className="tdt-card-stat-value">{fmtLarge(token.volume)}</span>
                  </div>
                  <div className="tdt-card-stat">
                    <span className="tdt-card-stat-label">{tr('homePage.discoverySection.discovery.mcap', "MCap")}</span>
                    <span className="tdt-card-stat-value">{fmtLarge(token.marketCap)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          (() => {
          // Compressed (chart panel open): cap the custom table to its first 4
          // data columns — the legacy nth-child hide rules assume the fixed
          // 8-column layout and would blank arbitrary user-chosen columns.
          const compressedTable = tabsOn && !!chartPanelToken
          const renderCols = !isStocks && compressedTable
            ? topcoinCols.filter((c) => c !== 'sparkline').slice(0, 4)
            : topcoinCols
          return (
          <div
            className={`tdt tdt-top-coins${!isStocks ? ' tdt-cols-custom' : ''}`}
            style={!isStocks ? {
              '--tdt-cols': compressedTable
                ? `30px 24px 140px repeat(${renderCols.length}, minmax(0, 1fr))`
                : `40px 24px 180px repeat(${renderCols.length}, minmax(0, 1fr))`,
            } : undefined}
          >
            {/* Sticky header */}
            <div className="tdt-header">
              <span className="th th-rank th-sortable" onClick={() => handleSort('rank')}>
                # {sortColumn === 'rank' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
              </span>
              <span className="th th-fav" />
              <span className="th th-project th-sortable" onClick={() => handleSort('name')}>
                {t('topSection.name')} {sortColumn === 'name' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
              </span>
              {isStocks ? (
                <>
                  <span className="th th-price th-sortable" onClick={() => handleSort('price')}>
                    {t('topSection.price')} {sortColumn === 'price' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </span>
                  <span className="th th-change th-sortable" onClick={() => handleSort('change')}>
                    {t('topSection.chgPercent')} {sortColumn === 'change' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </span>
                  <span className="th th-change th-sortable" onClick={() => handleSort('change7d')}>
                    {t('topSection.sectorCol')} {sortColumn === 'change7d' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </span>
                  <span className="th th-change th-sortable" onClick={() => handleSort('change30d')}>
                    {t('topSection.peRatio')} {sortColumn === 'change30d' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </span>
                  <span className="th th-change th-sortable" onClick={() => handleSort('change1y')}>
                    {t('topSection.exchange')} {sortColumn === 'change1y' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </span>
                  <span className="th th-mcap th-sortable" onClick={() => handleSort('marketCap')}>
                    {t('topSection.marketCap')} {sortColumn === 'marketCap' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </span>
                  <span className="th th-volume th-sortable" onClick={() => handleSort('volume')}>
                    {t('topSection.volume')} {sortColumn === 'volume' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </span>
                  <span className="th th-sparkline">{t('topSection.trend')}</span>
                </>
              ) : (
                renderCols.map((colId) => {
                  const def = TOPCOIN_COLS_BY_ID[colId]
                  if (!def) return null
                  if (!def.sort) {
                    return <span key={colId} className={`th ${def.th}`}>{def.label(t)}</span>
                  }
                  return (
                    <span key={colId} className={`th ${def.th} th-sortable`} onClick={() => handleSort(def.sort)}>
                      {def.label(t)} {sortColumn === def.sort && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </span>
                  )
                })
              )}
            </div>

            {/* Data rows */}
            {displayTopCoins.map((token, index) => {
              const globalRank = token.rank || (topCoinsPage - 1) * TOP_COINS_PAGE_SIZE + index + 1
              // Category/chain views: `rank` is the in-category position; show
              // the token's true CG rank under it when they differ.
              const trueRank = token.globalRank != null && token.globalRank !== token.rank ? token.globalRank : null
              return (
                <div
                  key={`${token.symbol}-${token.rank}-${index}`}
                  className={`tdt-row${compareMode && isTokenSelected(token.address || token.symbol) ? ' selected' : ''}${tabsOn && chartPanelToken?.symbol === token.symbol ? ' active' : ''}`}
                  onClick={() => handleRowClick(() => compareMode ? toggleCompareToken(token, { stopPropagation: () => {} }) : (tabsOn ? openChartOnly(token) : (isStocks ? handleStockClick(token) : handleTopCoinClick(token))))}
                  onDoubleClick={(e) => handleRowDoubleClick(token, e)}
                  {...(!isStocks && !compareMode ? hoverIntent(() => {
                    if (!allowDataPrefetch()) return
                    prewarmResearchZone(token.symbol)
                    prefetchRoute('research-zone')
                  }) : {})}
                >
                  {/* Heart burst animation overlay */}
                  {heartBurst?.id === (token.address || token.symbol) && (
                    <span className="dbl-heart-burst" key={heartBurst.key}>{icons.heartFilled}</span>
                  )}

                  {/* Rank (+ true global rank in category/chain views) */}
                  <span className="tdt-rank">
                    {globalRank}
                    {trueRank != null && <span className="tdt-rank-global">#{trueRank}</span>}
                  </span>

                  {/* Favorite (watchlist) */}
                  <span className="tdt-fav">
                    {addToWatchlist && (
                      <button
                        type="button"
                        className={`topcoin-favorite-btn${checkIsInWatchlist(token) ? ' in-watchlist' : ''}`}
                        data-tooltip={checkIsInWatchlist(token) ? 'Remove from watchlist' : 'Add to watchlist'}
                        onClick={e => {
                          e.stopPropagation()
                          if (checkIsInWatchlist(token)) {
                            removeFromWatchlist && removeFromWatchlist(token.address || token.symbol)
                          } else {
                            addToWatchlist({ symbol: token.symbol, name: token.name, address: token.address, logo: token.logo, price: token.price, change: token.change, marketCap: token.marketCap, pinned: false })
                          }
                        }}
                      >
                        {checkIsInWatchlist(token) ? icons.heartFilled : icons.heart}
                      </button>
                    )}
                  </span>

                  {/* Project: logo + names + action buttons */}
                  <div className="tdt-project">
                    {compareMode && (
                      <label className="tdt-checkbox" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isTokenSelected(token.address || token.symbol)} onChange={() => toggleCompareToken(token, { stopPropagation: () => {} })} />
                        <span className="tdt-check-mark" />
                      </label>
                    )}
                    <img className="tdt-logo" src={token.logo || TOKEN_LOGOS[token.symbol?.toUpperCase()] || TOKEN_LOGOS[token.name] || `https://assets.coingecko.com/coins/images/1/small/bitcoin.png`} alt=""
                         loading="lazy"
                         decoding="async"
                         width="32"
                         height="32"
                         onError={e => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex' }} />
                    <span className="tdt-logo-fallback" style={{ display: 'none' }}>{getTokenInitials(token.symbol)}</span>
                    <div className="tdt-project-text">
                      <span className="tdt-symbol">{token.symbol}</span>
                      <span className="tdt-name">{token.name}</span>
                    </div>
                    <button className="token-list-info-btn" data-tooltip="Info" onClick={e => { e.stopPropagation(); openTopCoinInfo(token.symbol, e) }}>
                      {icons.info}
                    </button>
                  </div>

                  {isStocks ? (
                    <>
                      <span className="tdt-price">{fmtPrice(token.price || 0)}</span>
                      <span className={`change-cell ${(token.change || 0) >= 0 ? ((token.change || 0) === 0 ? 'neutral' : 'bull') : 'bear'}`}>
                        {(token.change || 0) >= 0 ? '+' : ''}{formatChange(token.change || 0)}%
                      </span>
                      <span className="change-cell neutral">{token.sector || '-'}</span>
                      <span className="change-cell neutral">{token.pe ? token.pe.toFixed(1) : '-'}</span>
                      <span className="change-cell neutral">{token.exchange || '-'}</span>
                      <span className="tdt-mcap">{fmtLarge(token.marketCap)}</span>
                      <span className="tdt-volume">{fmtLarge(token.volume)}</span>
                      <div className="tdt-sparkline">
                        {(() => {
                          const hasReal = Array.isArray(token.sparkline_7d) && token.sparkline_7d.length > 1
                          const sparkData = hasReal
                            ? token.sparkline_7d
                            : generateSeededSparkline(token.change || 0, token.address || token.symbol)
                          return <Sparkline data={sparkData} positive={(token.change || 0) >= 0} />
                        })()}
                      </div>
                    </>
                  ) : (
                    (() => {
                      const renderWindow = (v, key) => {
                        if (v == null || !Number.isFinite(Number(v))) {
                          return <span key={key} className="change-cell neutral">—</span>
                        }
                        const n = Number(v)
                        const cls = n > 0 ? 'bull' : n < 0 ? 'bear' : 'neutral'
                        return (
                          <span key={key} className={`change-cell ${cls}`}>
                            {n >= 0 ? '+' : ''}{formatChange(n)}%
                          </span>
                        )
                      }
                      return renderCols.map((colId) => {
                        switch (colId) {
                          case 'price':
                            return <span key={colId} className="tdt-price">{fmtPrice(token.price || 0)}</span>
                          case 'change1h':
                            return renderWindow(token.change1h, colId)
                          case 'change24h':
                            return renderWindow(token.change ?? 0, colId)
                          case 'change7d':
                            return renderWindow(token.change7d, colId)
                          case 'change30d':
                            return renderWindow(token.change30d, colId)
                          case 'change1y':
                            return renderWindow(token.change1y ?? token.change365, colId)
                          case 'marketCap':
                            return <span key={colId} className="tdt-mcap">{fmtLarge(token.marketCap)}</span>
                          case 'fdv':
                            return <span key={colId} className="tdt-mcap">{token.fdv > 0 ? fmtLarge(token.fdv) : '—'}</span>
                          case 'volume':
                            return <span key={colId} className="tdt-volume">{fmtLarge(token.volume)}</span>
                          case 'volMcap': {
                            const r = token.marketCap > 0 ? ((token.volume || 0) / token.marketCap) * 100 : null
                            return <span key={colId} className="tdt-volume">{r != null ? `${r.toFixed(2)}%` : '—'}</span>
                          }
                          case 'circSupply':
                            return (
                              <span key={colId} className="tdt-volume">
                                {token.circulatingSupply > 0 ? `${fmtSupplyShort(token.circulatingSupply)} ${token.symbol || ''}` : '—'}
                              </span>
                            )
                          case 'athPct':
                            return renderWindow(token.athChangePct, colId)
                          case 'sparkline':
                            // Real CG 7d when present, seeded synthetic otherwise.
                            // Color follows the 7d trend so it matches the line direction.
                            return (
                              <div key={colId} className="tdt-sparkline">
                                {(() => {
                                  const hasReal = Array.isArray(token.sparkline_7d) && token.sparkline_7d.length > 1
                                  const sparkData = hasReal
                                    ? token.sparkline_7d
                                    : generateSeededSparkline(token.change || 0, token.address || token.symbol)
                                  const colorChange = hasReal
                                    ? (token.change7d != null ? Number(token.change7d) : (token.change || 0))
                                    : (token.change || 0)
                                  return <Sparkline data={sparkData} positive={colorChange >= 0} />
                                })()}
                              </div>
                            )
                          default:
                            return null
                        }
                      })
                    })()
                  )}
                </div>
              )
            })}
          </div>
          )
          })()
        )}

        {/* Top Coins pagination: user-selectable page size, up to 2000 coins */}
        {topSectionTab === 'topcoins' && !isStocks && (() => {
          // Category / chain / range-filter views page client-side over a
          // 250-row universe; only the plain "all" view pages server-side.
          const clientPaged = categoryFilter !== 'all'
            || (topCoinsChain && topCoinsChain !== 'all')
            || countActiveTopCoinsRanges(topCoinsRanges) > 0
          const maxPage = !clientPaged
            ? TOTAL_TOP_COINS_PAGES
            : (totalCategoryPages || null)
          const knownMax = maxPage != null
          const atFirst = topCoinsPage <= 1
          const atLast = knownMax
            ? topCoinsPage >= maxPage
            : !hasMorePages
          const scrollTop = () => document.querySelector('.discovery-section .tdt')?.scrollTo(0, 0)
          const goTo = (n) => {
            const target = knownMax ? Math.min(maxPage, Math.max(1, n)) : Math.max(1, n)
            jumpToTopCoinsPage(target)
            scrollTop()
          }
          return (
          <div className="topcoins-pagination" aria-label={tr('homePage.discoverySection.discovery.ariaTopCoinsPagination', "Top Coins pagination")}>
            <button
              type="button"
              className="topcoins-pagination-btn topcoins-pagination-btn--icon"
              disabled={atFirst || topCoinsLoading}
              onClick={() => goTo(1)}
              aria-label={t('discovery.firstPage', 'First page')}
              title={t('discovery.firstPage', 'First page')}
            >
              «
            </button>
            <button
              type="button"
              className="topcoins-pagination-btn"
              disabled={atFirst || topCoinsLoading}
              onClick={() => goTo(topCoinsPage - 1)}
              aria-label={t('discovery.previousPage', 'Previous page')}
            >
              ‹ {t('discovery.previous', 'Previous')}
            </button>
            <span className="topcoins-pagination-info">
              {knownMax
                ? `Page ${topCoinsPage} of ${maxPage}`
                : `Page ${topCoinsPage}`}
            </span>
            <PageJump
              currentPage={topCoinsPage}
              maxPage={knownMax ? maxPage : null}
              disabled={topCoinsLoading}
              onJump={goTo}
              t={t}
            />
            <button
              type="button"
              className="topcoins-pagination-btn"
              disabled={atLast || topCoinsLoading}
              onClick={() => goTo(topCoinsPage + 1)}
              aria-label={t('discovery.nextPage', 'Next page')}
            >
              {t('discovery.next', 'Next')} ›
            </button>
            <button
              type="button"
              className="topcoins-pagination-btn topcoins-pagination-btn--icon"
              disabled={!knownMax || atLast || topCoinsLoading}
              onClick={() => knownMax && goTo(maxPage)}
              aria-label={t('discovery.lastPage', 'Last page')}
              title={t('discovery.lastPage', 'Last page')}
            >
              »
            </button>
            {setTopCoinsPageSize && Array.isArray(TOP_COINS_PAGE_SIZE_OPTIONS) && (
              <PageSizeSelect
                value={topCoinsPageSize || TOP_COINS_PAGE_SIZE}
                options={TOP_COINS_PAGE_SIZE_OPTIONS}
                onChange={(n) => setTopCoinsPageSize(n)}
                disabled={false}
                t={t}
              />
            )}
          </div>
          )
        })()}

            </div>
          </div>
          {tabsOn && chartPanelToken && (
            <div className="discovery-chart-side">
              {renderChartPanel(true)}
            </div>
          )}
        </div>
        )}

        {/* Chain Volume, Smart Money, AI Intelligence removed - Smart Money moved to Market Analytics */}
        </>
        )}
      </section>
      </div>

      {/* Chart overlay: modal only when tabs off (Top Coins or Predictions); On-Chain uses same inline right panel as Top Coins */}
      {chartPanelToken && !tabsOn && (topSectionTab === 'topcoins' || topSectionTab === 'predictions') && createPortal(
        <div
          className="welcome-chart-overlay-backdrop"
          onClick={() => setChartPanelToken(null)}
          role="dialog"
          aria-modal="true"
          aria-label={t('discovery.chartOverlay', 'Chart overlay')}
        >
          {renderChartPanel(false)}
          {/*
            <button
              type="button"
              className="welcome-chart-overlay-close"
              onClick={() => setChartPanelToken(null)}
              aria-label={t('discovery.closeChart', 'Close chart')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <div className="welcome-chart-overlay-header">
              <div className="welcome-chart-overlay-token-info">
                {chartPanelToken.logo ? <img src={chartPanelToken.logo} alt="" className="welcome-chart-overlay-logo" loading="lazy" decoding="async" width="32" height="32" /> : <span className="welcome-chart-overlay-logo-placeholder">{chartPanelToken.symbol?.[0]}</span>}
                <div>
                  <span className="welcome-chart-panel-token">{chartPanelToken.symbol}</span>
                  <span className="welcome-chart-panel-name">{chartPanelToken.name}</span>
                </div>
              </div>
            </div>
            {/* Timeframe tabs: 1m, 30m, 1h, 1d, All Time, 24h, 7d, 30d */}
            <div className="welcome-chart-overlay-timeframe-row">
              <div className="welcome-chart-overlay-tabs">
                {OVERLAY_TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.id}
                    type="button"
                    className={`welcome-chart-overlay-tab ${chartOverlayTimeframe === tf.id ? 'active' : ''}`}
                    onClick={() => setChartOverlayTimeframe(tf.id)}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
              <div className="welcome-chart-overlay-toolbar">
                <button type="button" className="welcome-chart-overlay-tool-btn" data-tooltip="Indicators"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M7 16l4-8 4 4 4-8"/></svg></button>
                <button type="button" className="welcome-chart-overlay-tool-btn" data-tooltip="Drawing"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg></button>
                <button type="button" className="welcome-chart-overlay-tool-btn" data-tooltip="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg></button>
              </div>
            </div>
            <div className="welcome-chart-panel-chart welcome-chart-overlay-chart-area">
              {(() => {
                const change24 = chartPanelToken.change != null ? Number(chartPanelToken.change) : 0
                const scale = chartOverlayTimeframe === '1h' || chartOverlayTimeframe === '1m' ? 0.25 : chartOverlayTimeframe === '7d' || chartOverlayTimeframe === '30d' ? 1.4 : 1
                const scaledChange = change24 * scale
                const points = getHistorySparkline(chartPanelToken.price, scaledChange)
                if (!points.length) return <span className="welcome-chart-overlay-chart-placeholder">{chartPanelToken.symbol} {chartOverlayTimeframe} CRYPTO - No data</span>
                const w = 400
                const h = 280
                const min = Math.min(...points)
                const max = Math.max(...points)
                const range = max - min || 1
                const d = points.map((v, i) => `${(i / (points.length - 1)) * w},${h - ((v - min) / range) * (h - 20)}`).join(' ')
                return (
                  <svg viewBox={`0 0 ${w} ${h}`} className="welcome-chart-overlay-sparkline">
                    <defs>
                      <linearGradient id="chart-overlay-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(180, 180, 190, 0.2)" />
                        <stop offset="100%" stopColor="rgba(180, 180, 190, 0)" />
                      </linearGradient>
                    </defs>
                    <polygon fill="url(#chart-overlay-grad)" points={`0,${h} ${d} ${w},${h}`} />
                    <polyline fill="none" stroke="rgba(180, 180, 190, 0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={d} />
                  </svg>
                )
              })()}
            </div>
            {/* Bottom tabs: TradingView | Screener */}
            <div className="welcome-chart-overlay-bottom-tabs">
              <button type="button" className={`welcome-chart-overlay-bottom-tab ${chartOverlaySubTab === 'tradingview' ? 'active' : ''}`} onClick={() => setChartOverlaySubTab('tradingview')}>TradingView</button>
              <button type="button" className={`welcome-chart-overlay-bottom-tab ${chartOverlaySubTab === 'screener' ? 'active' : ''}`} onClick={() => setChartOverlaySubTab('screener')}>{tr('homePage.discoverySection.discovery.screener', "Screener")}</button>
            </div>
            {chartOverlaySubTab === 'tradingview' && (
              <div className="welcome-chart-overlay-project-info">
                <p className="welcome-chart-overlay-project-desc">
                  {COIN_DESCRIPTIONS[chartPanelToken.symbol] || `Token info for ${chartPanelToken.name}. Price and on-chain data.`}
                </p>
                <div className="welcome-chart-overlay-project-links">
                  <a href="#" className="welcome-chart-overlay-link">Website</a>
                  <a href="#" className="welcome-chart-overlay-link">X</a>
                  <a href="#" className="welcome-chart-overlay-link">Telegram</a>
                </div>
              </div>
            )}
            {chartPanelToken.address && selectToken && (
              <button type="button" className="welcome-chart-overlay-view-details" onClick={() => { setChartPanelToken(null); selectToken(chartPanelToken) }}>
                {tr('homePage.discoverySection.discovery.viewFullDetails', "View full details")}
              </button>
            )}
        </div>,
        document.body
      )}

      {!discoverOnly && (
        <>
      {/* Quick Actions */}
      <section className="quick-actions">
        <button className="action-btn">
          {icons.search}
          <span>{t('common.search', 'Search')}</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          className={`action-btn ${compareMode ? 'active' : ''}`}
          onClick={() => compareMode ? exitCompareMode() : setCompareMode(true)}
        >
          {icons.compare}
          <span>{compareMode ? t('discovery.exitCompare', 'Exit Compare') : t('discovery.compare', 'Compare')}</span>
          {compareMode && compareTokens.length > 0 && <span className="action-count">{compareTokens.length}</span>}
        </button>
        <button className="action-btn disabled">
          {icons.bell}
          <span>{t('discovery.alerts', 'Alerts')}</span>
          <span className="action-badge">{t('discovery.soon', 'Soon')}</span>
        </button>
        <button className="action-btn disabled">
          {icons.portfolio}
          <span>{t('discovery.portfolio', 'Portfolio')}</span>
          <span className="action-badge">{t('discovery.soon', 'Soon')}</span>
        </button>
      </section>
        </>
      )}
  <ShareXModal
    open={shareModalOpen}
    onClose={() => { setShareModalOpen(false); setShareImageUrl(null) }}
    imageUrl={shareImageUrl}
    defaultDescription={shareDescription}
    filename={`top${(sortedTopCoins || []).length > 10 ? 10 : (sortedTopCoins || []).length}_${isStocks ? 'stocks' : 'crypto'}_spectre.png`}
  />
  </>
  )
}

export default DiscoverySection
