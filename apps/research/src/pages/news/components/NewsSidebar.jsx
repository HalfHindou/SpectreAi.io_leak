/**
 * NewsSidebar — Perplexity Discover-style right sidebar
 * Premium glass panels. SVG icons only — no emojis.
 */

/* ── SVG Icon Components ── */

function IconTech({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
    </svg>
  )
}

function IconAI({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" /><path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z" /><circle cx="12" cy="6" r="1" fill={color || 'currentColor'} />
    </svg>
  )
}

function IconScience({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6v6l4 8H5l4-8V3z" /><path d="M10 3h4" />
    </svg>
  )
}

function IconBusiness({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><path d="M12 12h.01" />
    </svg>
  )
}

function IconFinance({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" />
    </svg>
  )
}

function IconWorld({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function IconCrypto({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042.348-1.97M7.48 15.93l3.94.694m0 0-.346 1.965m.346-1.965-3.94-.694" />
    </svg>
  )
}

function IconHealth({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7 7-7z" />
    </svg>
  )
}

function IconEnergy({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
}

function IconTokenized({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /><circle cx="16" cy="15" r="2" />
    </svg>
  )
}

function IconRWA({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /><path d="M9 9h.01" /><path d="M15 9h.01" /><path d="M9 13h.01" /><path d="M15 13h.01" />
    </svg>
  )
}

const ICON_MAP = {
  tech: IconTech,
  ai: IconAI,
  science: IconScience,
  business: IconBusiness,
  finance: IconFinance,
  world: IconWorld,
  crypto: IconCrypto,
  health: IconHealth,
  energy: IconEnergy,
  'tokenized-assets': IconTokenized,
  rwa: IconRWA,
}

import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/contexts/I18nCurrencyContext'

/* ── Interest Options ── i18n labels come from `news.sidebar.interests.<key>` */
const INTEREST_OPTIONS = [
  { key: 'tech', labelKey: 'tech', fallback: 'Tech', color: '#3B82F6' },
  { key: 'ai', labelKey: 'ai', fallback: 'AI', color: '#8B5CF6' },
  { key: 'science', labelKey: 'science', fallback: 'Science', color: '#10B981' },
  { key: 'business', labelKey: 'business', fallback: 'Business', color: '#F59E0B' },
  { key: 'finance', labelKey: 'finance', fallback: 'Finance', color: '#22C55E' },
  { key: 'world', labelKey: 'world', fallback: 'World', color: '#EF4444' },
  { key: 'crypto', labelKey: 'crypto', fallback: 'Crypto', color: '#F7931A' },
  { key: 'tokenized-assets', labelKey: 'tokenizedAssets', fallback: 'Tokenized Assets', color: '#14B8A6' },
  { key: 'rwa', labelKey: 'rwa', fallback: 'RWA', color: '#0EA5E9' },
  { key: 'health', labelKey: 'health', fallback: 'Health', color: '#06B6D4' },
  { key: 'energy', labelKey: 'energy', fallback: 'Energy', color: '#F97316' },
]

function fmtChange(change) {
  if (change == null || isNaN(change)) return '0.00%'
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}%`
}

function fgColor(value) {
  if (value <= 20) return '#EF4444'
  if (value <= 40) return '#F97316'
  if (value <= 60) return '#EAB308'
  if (value <= 80) return '#84CC16'
  return '#22C55E'
}

const TOKEN_LOGOS = {
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
}

function wireAgo(dateStr) {
  const then = new Date(dateStr).getTime()
  if (!then || isNaN(then)) return ''
  const mins = Math.floor(Math.max(0, Date.now() - then) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function NewsSidebar({ prices, fearGreed, trendingTopics, interests, onToggleInterest, dayMode, macroWire, onOpenWireItem, onOpenWireTab }) {
  const { t } = useTranslation()
  const { fmtPrice } = useCurrency()
  return (
    <div className="sn-sidebar-inner">

      {/* ── Macro Wire — live desk feed, RSS-style rows ── */}
      {macroWire && macroWire.length > 0 && (
        <div className="sn-widget sn-widget--wire">
          <h3 className="sn-widget__title sn-widget__title--wire">
            <img src="/icon-192x192.png" alt="" width="20" height="20" className="sn-wire__mark" />
            {t('news.sidebar.macroWire', 'Macro Wire')}
            <span className="sn-wire__live">{t('news.sidebar.live', 'LIVE')}</span>
          </h3>
          <ul className="sn-wire">
            {macroWire.map(item => (
              <li key={item.id} className="sn-wire__item" onClick={() => onOpenWireItem?.(item)}>
                <img src={item.imageUrl} alt="" className="sn-wire__thumb" loading="lazy" width="52" height="40" onError={(e) => { e.target.style.visibility = 'hidden' }} />
                <div className="sn-wire__body">
                  <span className="sn-wire__headline">{item.title}</span>
                  <span className="sn-wire__meta">
                    {item.laneLabel && (
                      <span className={`sn-wire__impact${item.laneLabel === 'Macro Shock' ? ' sn-wire__impact--hot' : ' sn-wire__impact--warm'}`}>
                        {Number.isFinite(item.importance) ? `${item.importance} · ` : ''}{item.laneLabel}
                      </span>
                    )}
                    {!item.laneLabel && item.kindLabel && (
                      <span className="sn-wire__kind" style={{ color: item.kindColor }}>{item.kindLabel}</span>
                    )}
                    {wireAgo(item.publishedAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="sn-wire__all" onClick={() => onOpenWireTab?.()}>
            {t('news.sidebar.viewWire', 'View the full wire')}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></svg>
          </button>
        </div>
      )}

      {/* ── Your Topics ── */}
      <div className="sn-widget sn-widget--topics">
        <h3 className="sn-widget__title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="15" height="15">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {t('news.sidebar.topics', 'Topics')}
        </h3>
        <div className="sn-interests">
          {INTEREST_OPTIONS.map(opt => {
            const active = interests?.includes(opt.key)
            const Icon = ICON_MAP[opt.key]
            return (
              <button
                key={opt.key}
                type="button"
                className={`sn-interest-chip ${active ? 'sn-interest-chip--active' : ''}`}
                onClick={() => onToggleInterest?.(opt.key)}
              >
                <span className="sn-interest-chip__icon">
                  {Icon && <Icon size={14} />}
                </span>
                <span className="sn-interest-chip__label">{t(`news.sidebar.interests.${opt.labelKey}`, opt.fallback)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Trending Topics ── */}
      {trendingTopics && trendingTopics.length > 0 && (
        <div className="sn-widget sn-widget--trending">
          <h3 className="sn-widget__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="15" height="15">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
            </svg>
            {t('news.sidebar.trending', 'Trending')}
          </h3>
          <ul className="sn-trending">
            {trendingTopics.map((tt, i) => (
              <li key={tt.topic} className="sn-trending__item">
                <span className="sn-trending__rank">{i + 1}</span>
                <span className="sn-trending__topic">{tt.topic}</span>
                <span className="sn-trending__bar">
                  <span
                    className="sn-trending__bar-fill"
                    style={{ width: `${Math.min(100, (tt.count / (trendingTopics[0]?.count || 1)) * 100)}%` }}
                  />
                </span>
                <span className="sn-trending__count">{tt.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Market Pulse ── */}
      <div className="sn-widget sn-widget--market">
        <h3 className="sn-widget__title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="15" height="15">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          {t('news.sidebar.marketPulse', 'Market Pulse')}
        </h3>
        <div className="sn-market-grid">
          {prices.length > 0 ? prices.map(p => (
            <div key={p.symbol} className="sn-market-card">
              <div className="sn-market-card__head">
                <img src={TOKEN_LOGOS[p.symbol]} alt="" className="sn-market-card__logo" width="20" height="20" />
                <span className="sn-market-card__symbol">{p.symbol}</span>
              </div>
              <span className="sn-market-card__price">{fmtPrice(p.price)}</span>
              <span className={`sn-market-card__change ${p.change >= 0 ? 'sn-market-card__change--up' : 'sn-market-card__change--down'}`}>
                {fmtChange(p.change)}
              </span>
            </div>
          )) : (
            <div className="sn-market-card sn-market-card--skeleton"><span className="sn-skeleton" style={{ width: '100%', height: 48 }} /></div>
          )}
        </div>
        {fearGreed && (
          <div className="sn-fg-bar-widget">
            <div className="sn-fg-bar-widget__head">
              <span className="sn-fg-bar-widget__label">{t('news.sidebar.sentiment', 'Sentiment')}</span>
              <span className="sn-fg-bar-widget__class" style={{ color: fgColor(fearGreed.value) }}>
                {fearGreed.classification}
              </span>
            </div>
            <div className="sn-fg-bar-widget__track">
              <div
                className="sn-fg-bar-widget__fill"
                style={{ width: `${fearGreed.value}%`, background: fgColor(fearGreed.value) }}
              />
              <div
                className="sn-fg-bar-widget__marker"
                style={{ left: `${fearGreed.value}%` }}
              />
            </div>
            <div className="sn-fg-bar-widget__labels">
              <span>{t('news.sidebar.extremeFear', 'Extreme Fear')}</span>
              <span style={{ color: fgColor(fearGreed.value), fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                {fearGreed.value}
              </span>
              <span>{t('news.sidebar.extremeGreed', 'Extreme Greed')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
