/**
 * LensPage — Spectre Lens history & status (desktop only)
 * Glass design law, CoinGecko routing, click-to-research,
 * hover route hints, platform badges.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getSpectreSearch } from '@/services/spectreMarketApi'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { useTimeAgo } from '@/lib/timeAgo'
import './lens-page.css'

const isDesktop = typeof window !== 'undefined' && window.spectre?.isDesktop

function verdictClass(v) {
  const upper = (v || '').toUpperCase()
  if (upper.includes('BULL') || upper.includes('BUY')) return 'bull'
  if (upper.includes('BEAR') || upper.includes('SELL')) return 'bear'
  return 'neutral'
}

export default function LensPage() {
  const { t } = useTranslation()
  const { fmtPrice } = useCurrency()
  const fmtAgo = useTimeAgo()
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const cgCache = useRef({})

  useEffect(() => {
    if (!isDesktop) { setLoading(false); return }
    const loadHistory = async () => {
      try {
        const data = await window.spectre.store.get('lens.history')
        setHistory(data || [])
      } catch (err) {
        // silently handled
      }
      setLoading(false)
    }
    loadHistory()
  }, [])

  const handleClear = useCallback(async () => {
    if (!isDesktop) return
    try {
      await window.spectre.store.set('lens.history', [])
      setHistory([])
    } catch (err) {
      // silently handled
    }
  }, [])

  // CoinGecko lookup — determines routing
  async function checkCoinGecko(ticker) {
    if (cgCache.current[ticker] !== undefined) return cgCache.current[ticker]
    try {
      const data = await getSpectreSearch(ticker, 10)
      const hit  = data.coins?.some(c => c.symbol?.toLowerCase() === ticker.toLowerCase())
      cgCache.current[ticker] = hit
      return hit
    } catch {
      cgCache.current[ticker] = true
      return true
    }
  }

  async function handleItemClick(item) {
    const ticker = item.ticker || item.symbol
    if (!ticker) return

    if (isDesktop) {
      // In desktop, open deep dive via IPC
      window.spectre.send('lens:open-deep-dive', { symbol: ticker })
    } else {
      // In web, route based on CoinGecko listing
      const onCoinGecko = await checkCoinGecko(ticker)
      if (onCoinGecko) {
        navigate(`/search?q=${ticker}&mode=deep&source=lens`)
      } else {
        navigate(`/search-engine?q=${ticker}&source=lens&mode=codex`)
      }
    }
  }

  async function handleItemHover(item) {
    const ticker = item.ticker || item.symbol
    if (ticker && cgCache.current[ticker] === undefined) {
      await checkCoinGecko(ticker)
    }
  }

  const isMac = typeof window !== 'undefined' && window.spectre?.platform === 'darwin'
  const modKey = isMac ? '\u2318' : 'Ctrl'
  const shortcutLabel = `${modKey}+Shift+L`

  // Web-only fallback
  if (!isDesktop) {
    return (
      <div className="lens-page">
        <div className="lens-page-header-row">
          <div className="lens-page-dot" />
          <h1 className="lens-page-title">{t('lens.title', 'Spectre Lens')}</h1>
        </div>
        <p className="lens-page-sub">{t('lens.desktopOnly', 'Desktop only')}</p>
        <div className="lens-page-web-only">
          <p>
            {t(
              'lens.webOnlyDescription',
              'Spectre Lens is a screen analysis tool available exclusively in the Spectre Desktop app. Download the desktop app to scan any token or stock on your screen with a single shortcut.'
            )}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="lens-page">
      {/* Header */}
      <div className="lens-page-header-row">
        <div className="lens-page-dot" />
        <h1 className="lens-page-title">{t('lens.title', 'Spectre Lens')}</h1>
        <span className="lens-shortcut-badge">{shortcutLabel}</span>
      </div>
      <p className="lens-page-sub">{t('lens.subtitle', 'AI screen analysis & intelligence history')}</p>

      {/* Status card */}
      <div className="lens-status-card">
        <div className="lens-status-left">
          <div className="lens-status-dot" />
          <div>
            <span className="lens-status-label">{t('lens.status.active', 'Lens Active')}</span>
            <span className="lens-status-sub">{t('lens.status.scanning', 'Passively scanning every 12s')}</span>
          </div>
        </div>
      </div>

      {/* History section */}
      <div className="lens-section-header">
        <span className="lens-section-title">{t('lens.history.title', 'Scan History')}</span>
        <span className="lens-count-badge">{history.length}</span>
        <div style={{ flex: 1 }} />
        {history.length > 0 && (
          <button className="lens-clear-btn" onClick={handleClear}>
            {t('lens.history.clear', 'Clear')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="lens-empty">
          <p>{t('lens.history.loading', 'Loading history...')}</p>
        </div>
      ) : history.length === 0 ? (
        <div className="lens-empty">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.24)" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <p>{t('lens.history.empty', 'No scans yet')}</p>
          <span>
            {t('lens.history.emptyHint', 'Press {{shortcut}} to scan your screen', { shortcut: shortcutLabel })}
          </span>
        </div>
      ) : (
        <div className="lens-history-list">
          {history.map((item, i) => {
            const ticker = item.ticker || item.symbol || '???'
            const onCg = cgCache.current[ticker]
            const routeHint = onCg === false
              ? t('lens.route.screener', 'Screener \u2192')
              : t('lens.route.research', 'Research \u2192')
            return (
              <div
                key={`${ticker}-${item.detectedAt || item.timestamp}-${i}`}
                className="lens-history-item"
                onClick={() => handleItemClick(item)}
                onMouseEnter={() => handleItemHover(item)}
              >
                <span className="lhi-ticker">{ticker}</span>
                <span className="lhi-name">{item.name || '\u2014'}</span>
                {item.platform && (
                  <span className="lhi-platform">{item.platform}</span>
                )}
                <span className="lhi-price">{item.price == null || isNaN(Number(item.price)) ? '--' : fmtPrice(item.price)}</span>
                {item.verdict && (
                  <span className={`lhi-verdict ${verdictClass(item.verdict)}`}>
                    {item.verdict}
                  </span>
                )}
                <span className="lhi-time">{fmtAgo(item.detectedAt || item.timestamp)}</span>
                <span className="lhi-route">{routeHint}</span>
                <span className="lhi-chevron">&rsaquo;</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
