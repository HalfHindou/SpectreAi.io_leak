import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import { getStockLogoUrl, getStockLogoFallback } from '@/services/stockApi'
import { useTokenSearch } from '@/hooks/codex/useTokenSearch'
import useSettingsStore from '@/store/useSettingsStore'
import useProThemeSkin from '@/components/pro-theme/use-pro-theme-skin'
import './rz-quick-switcher.css'

function formatTimeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function RzQuickSwitcher({
  open,
  onClose,
  history = [],
  currentSymbol,
  onSelect,
  onClear,
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)
  const dayMode = useSettingsStore((s) => s.dayMode)
  const navSidebarCollapsed = useSettingsStore((s) => s.navSidebarCollapsed)
  const { className: proThemeClass } = useProThemeSkin()

  // With a query, the switcher becomes a real token search (not just a filter
  // of the recently-viewed list) so you can jump to ANY token, not only ones
  // you've already opened. Empty query still shows recents. Reuses the same
  // search service the header uses.
  const trimmed = query.trim()
  const { results: searchResults, loading: searchLoading } = useTokenSearch(trimmed, 250)

  const filtered = useMemo(() => {
    if (!trimmed) return history
    const q = trimmed.toUpperCase()
    // Dedup key strips the "$" prefix on-chain tickers carry — a live "$PAAL"
    // result and a recent "PAAL" are the same asset; raw keys showed both.
    const keyOf = (s) => String(s || '').toUpperCase().replace(/^\$+/, '')
    const seen = new Set()
    const out = []
    // Recently-viewed matches first (fastest to reach, carry a timestamp).
    for (const item of history) {
      if (item.symbol?.toUpperCase().includes(q) || item.name?.toUpperCase().includes(q)) {
        const key = keyOf(item.symbol)
        if (key && !seen.has(key)) { seen.add(key); out.push(item) }
      }
    }
    // Then live search results, deduped by symbol against the recents above.
    for (const r of searchResults) {
      const key = keyOf(r.symbol)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(r)
    }
    return out
  }, [history, searchResults, trimmed])

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      // focus input next tick
      const id = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(id)
    }
  }, [open])

  // Clamp active index when filter shrinks
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1))
  }, [filtered.length, activeIdx])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => Math.min(filtered.length - 1, i + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => Math.max(0, i - 1))
        return
      }
      if (e.key === 'Enter') {
        const target = filtered[activeIdx]
        if (target) {
          e.preventDefault()
          onSelect?.(target)
          onClose?.()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, activeIdx, onSelect, onClose])

  if (!open) return null
  if (typeof document === 'undefined') return null

  /* The switcher lives inside `.app-main-content`, which is
     `position: relative; z-index: 1` — a stacking context. Its own z-index
     therefore resolved INSIDE that context and could never beat the fixed
     header (`--z-header: 300`), so on a phone the header painted over the
     modal's search row: "the top is cut" (founder 08-17). Portalling to
     document.body is the only fix; a bigger z-index cannot escape a stacking
     context. The wrapper is box-less (`display: contents`) and carries the
     theme classes, because every day-mode / PRO-skin rule is scoped `.app…`
     and would silently drop outside the app root — same pattern as the X-Dash
     drawers. */
  const portalClass = [
    'rz-qs-portal-root',
    'app',
    'nav-sidebar-open',
    navSidebarCollapsed ? 'nav-sidebar-collapsed' : '',
    dayMode ? 'app-day-mode' : '',
    proThemeClass.trim(),
  ].filter(Boolean).join(' ')

  return createPortal(
    <div className={portalClass}>
    <div className="rz-qs-backdrop" onClick={onClose}>
      <div className="rz-qs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('researchPro.quickSwitcher.rzquickswitcher.ariaRecentTokens', "Recent tokens")}>
        <div className="rz-qs-header">
          <svg className="rz-qs-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            /* ui-bare-input — the header row is the field; see app-store-ready.css */
            className="rz-qs-input ui-bare-input"
            placeholder={t('researchPro.quickSwitcher.rzquickswitcher.placeholderSearchAnyTokenOrFilterRe', "Search any token, or filter recent...")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="rz-qs-kbd rz-qs-kbd--esc">{t('researchPro.quickSwitcher.rzquickswitcher.esc', "esc")}</span>
          <button
            type="button"
            className="rz-qs-close"
            onClick={onClose}
            aria-label={t('researchPro.quickSwitcher.rzquickswitcher.ariaClose', "Close")}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="rz-qs-list" role="listbox">
          {filtered.length === 0 ? (
            <div className="rz-qs-empty">
              {trimmed
                ? (searchLoading ? 'Searching…' : `No matches for "${query}"`)
                : 'No recently viewed tokens yet — they’ll appear here as you browse.'}
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isActive = idx === activeIdx
              const isCurrent = String(item.symbol || '').toUpperCase().replace(/^\$+/, '')
                === String(currentSymbol || '').toUpperCase().replace(/^\$+/, '')
              const tc = TOKEN_ROW_COLORS[item.symbol]
              const logoSrc = item.isStock
                ? getStockLogoUrl(item.symbol)
                : item.logo
              return (
                <button
                  key={item.symbol}
                  type="button"
                  className={`rz-qs-item${isActive ? ' rz-qs-item--active' : ''}${isCurrent ? ' rz-qs-item--current' : ''}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => { onSelect?.(item); onClose?.() }}
                  role="option"
                  aria-selected={isActive}
                >
                  <span className="rz-qs-item-logo" style={tc ? { background: `rgba(${tc.bg}, 0.15)` } : undefined}>
                    {logoSrc ? (
                      <img
                        src={logoSrc}
                        alt=""
                        onError={item.isStock ? (e) => { e.target.onerror = null; e.target.src = getStockLogoFallback(item.symbol) } : (e) => {
                          const parent = e.target.parentElement
                          e.target.remove()
                          if (parent) {
                            const span = document.createElement('span')
                            span.className = 'rz-qs-item-fallback'
                            span.textContent = item.symbol.charAt(0).toUpperCase()
                            parent.appendChild(span)
                          }
                        }}
                      />
                    ) : (
                      <span className="rz-qs-item-fallback">{item.symbol.charAt(0)}</span>
                    )}
                  </span>
                  <span className="rz-qs-item-meta">
                    <span className="rz-qs-item-name">{item.name || item.symbol}</span>
                    <span className="rz-qs-item-sub">
                      <span className="rz-qs-item-symbol">{item.symbol}</span>
                      {/* recents carry a timestamp; live search results show the chain instead */}
                      {(() => {
                        const secondary = item.lastViewedAt
                          ? formatTimeAgo(item.lastViewedAt)
                          : (typeof item.network === 'string' ? item.network : '')
                        return secondary ? (
                          <>
                            <span className="rz-qs-item-dot">·</span>
                            <span className="rz-qs-item-time">{secondary}</span>
                          </>
                        ) : null
                      })()}
                      {isCurrent && <span className="rz-qs-item-badge">{t('researchPro.quickSwitcher.rzquickswitcher.current', "current")}</span>}
                    </span>
                  </span>
                  {isActive && (
                    <span className="rz-qs-item-enter" aria-hidden>↵</span>
                  )}
                </button>
              )
            })
          )}
        </div>

        <div className="rz-qs-footer">
          <span className="rz-qs-hint">
            <span className="rz-qs-kbd">↑</span><span className="rz-qs-kbd">↓</span> {t('researchPro.quickSwitcher.rzquickswitcher.navigate', "navigate")}
            <span className="rz-qs-sep" />
            <span className="rz-qs-kbd">↵</span> {t('researchPro.quickSwitcher.rzquickswitcher.open', "open")}
            <span className="rz-qs-sep" />
            <span className="rz-qs-kbd">{t('researchPro.quickSwitcher.rzquickswitcher.alt', "alt")}</span><span className="rz-qs-kbd">H</span> {t('researchPro.quickSwitcher.rzquickswitcher.toggle', "toggle")}
          </span>
          {history.length > 0 && (
            <button type="button" className="rz-qs-clear" onClick={onClear}>{t('researchPro.quickSwitcher.rzquickswitcher.clearHistory', "Clear history")}</button>
          )}
        </div>
      </div>
    </div>
    </div>,
    document.body
  )
}
