import React from 'react'
import { shortExchange } from '@/lib/exchange-label'
import { useTranslation } from 'react-i18next'
import { DEFAULT_SYMBOL } from '../data/rz-constants'
import { shortAddress, buildContractEntries } from '../data/rz-contract-utils'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import { getStockLogoUrl, getStockLogoFallback, FALLBACK_STOCK_DATA } from '@/services/stockApi'
import spectreIcons from '@/icons/spectreIcons'
import useTokenBrandColor from '@/hooks/useTokenBrandColor'
import { RzInfoIcon } from './rz-pro-shared'

// Tooltip dictionary for sections + metrics in the token panel.
// Strings are intentionally English literals (no i18n) to match surrounding RZ copy.
const TIPS = {
  marketCap: 'Total value of all tokens in circulation. Calculated as price × circulating supply.',
  volume24h: 'Total trading volume across tracked exchanges over the last 24 hours.',
  fdv: 'Fully Diluted Valuation — what the market cap would be if every token from max supply was already in circulation.',
  volMcap: 'Ratio of 24h volume to market cap. Higher values mean more active trading relative to size.',
  circSupply: 'Tokens currently in circulation and tradeable on the open market.',
  totalSupply: 'Maximum number of tokens that will ever exist for this asset.',
  holders: 'Unique on-chain wallets currently holding this token.',
  pe: 'Price ÷ Earnings per share. Higher values mean investors pay more per dollar of profit.',
  eps: 'Earnings Per Share — net profit divided by total outstanding shares.',
  sector: 'Industry sector the company belongs to.',
  exchange: 'Primary exchange this stock is listed on.',
  avgVolume: 'Average daily trading volume across recent sessions.',
  categories: 'Themes and sectors this token is associated with.',
  converter: 'Convert between this token and USD at the live price.',
  pricePerformance: 'Price change across multiple time windows — gives a quick read of momentum.',
  weekRange: '52-week price range — the lowest and highest price over the past year.',
  allTime: 'All-time high and all-time low prices since this asset launched.',
  keyLevels: 'AI-detected support and resistance — key price zones where reactions are likely.',
  aiInsight: 'Spectre AI synthesis of current trend, volume, and sentiment for this token.',
  keyStatistics: 'Core trading statistics for this stock — open, close, ranges, ratios.',
  companyProfile: 'Background information about the company — IPO, leadership, location, industry.',
}

/** Reusable skeleton block */
const Skeleton = ({ className, style }) => <span className={`rz-skeleton ${className || ''}`} style={style} />

function formatRelativeTime(date) {
  if (!date) return null
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function formatDate(str) {
  if (!str) return '-'
  const d = new Date(str)
  if (isNaN(d.getTime())) return str
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Contract-address helpers shared with mobile (data/rz-contract-utils.js).

/** Single copy button with its own "copied" feedback. */
const CopyButton = ({ value }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  const handleCopy = () => {
    try {
      navigator.clipboard?.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {}
  }
  return (
    <button
      type="button"
      className="research-zone-lite-contract-copy"
      onClick={handleCopy}
      aria-label={t('researchPro.tokenPanel.copybutton.ariaCopyContractAddress', "Copy contract address")}
      title={copied ? 'Copied' : 'Copy address'}
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  )
}

/** Contract address row(s) with copy. Expands to a per-chain list when multi-chain. */
const RzContractRow = ({ address, platforms }) => {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const entries = React.useMemo(() => buildContractEntries(address, platforms), [address, platforms])
  if (entries.length === 0) return null

  const primary = entries[0]
  const extraCount = entries.length - 1

  return (
    <div className="research-zone-lite-contract-wrap">
      <div className="research-zone-lite-contract">
        <span className="research-zone-lite-contract-label">{t('researchPro.tokenPanel.rzcontractrow.contract', "Contract")}</span>
        <code className="research-zone-lite-contract-addr mono">{shortAddress(primary.address)}</code>
        <CopyButton value={primary.address} />
        {extraCount > 0 && (
          <button
            type="button"
            className={`research-zone-lite-contract-more${open ? ' is-open' : ''}`}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Hide other networks' : `Show ${extraCount} other network${extraCount === 1 ? '' : 's'}`}
          >
            +{extraCount}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
        )}
      </div>
      {open && extraCount > 0 && (
        <div className="research-zone-lite-contract-list">
          {entries.map((e) => (
            <div key={e.address} className="research-zone-lite-contract-chain">
              <span className="research-zone-lite-contract-chain-label">{e.label}</span>
              <code className="research-zone-lite-contract-chain-addr mono">{shortAddress(e.address)}</code>
              <CopyButton value={e.address} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Expandable company description for stock profile */
const StockDescription = ({ text }) => {
  const [expanded, setExpanded] = React.useState(false)
  const truncated = text.length > 160 ? text.slice(0, 160) + '...' : text
  return (
    <div className="rz-stock-description">
      <p className="rz-stock-description-text">{expanded ? text : truncated}</p>
      {text.length > 160 && (
        <button type="button" className="rz-stock-description-toggle" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'View Less' : 'View More'} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}
    </div>
  )
}

const fmtConvNum = (v) => {
  if (!Number.isFinite(v) || v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1) return String(parseFloat(v.toFixed(4)))
  return String(parseFloat(v.toPrecision(6)))
}

/** Simple token-to-USD converter (CMC-style) */
const TokenConverter = ({ symbol, price }) => {
  const { t } = useTranslation()
  const numericPrice = parseFloat(price) || 0
  // `side` is the row the user last typed into, so the other row is always the
  // derived one. Focusing a row empties it, so typing replaces the seeded "1"
  // instead of appending to it; leaving it empty restores the last amount.
  const [side, setSide] = React.useState('token')
  const [amount, setAmount] = React.useState('1')
  const lastRef = React.useRef({ side: 'token', amount: '1' })

  const parsed = parseFloat(amount)
  const filled = Number.isFinite(parsed)
  React.useEffect(() => { if (filled) lastRef.current = { side, amount } })

  // While a row is being edited and empty, keep showing the last committed pair
  // in the other row rather than flashing 0.
  const committed = filled ? { side, amount } : lastRef.current
  const committedNum = parseFloat(committed.amount) || 0
  const tokenNum = committed.side === 'token'
    ? committedNum
    : (numericPrice > 0 ? committedNum / numericPrice : 0)
  const usdNum = tokenNum * numericPrice

  const handleFocus = (nextSide) => { setSide(nextSide); setAmount('') }
  const handleBlur = () => {
    if (Number.isFinite(parseFloat(amount))) return
    setSide(lastRef.current.side)
    setAmount(lastRef.current.amount)
  }

  return (
    <div className="rz-converter">
      <h3 className="research-zone-lite-left-section-title">
        {symbol} to USD converter
        <RzInfoIcon tip={TIPS.converter} />
      </h3>
      <div className="rz-converter-table">
        <div className="rz-converter-row">
          <span className="rz-converter-label">{symbol}</span>
          <input
            type="number"
            className="rz-converter-input"
            value={side === 'token' ? amount : fmtConvNum(tokenNum)}
            onChange={(e) => { setSide('token'); setAmount(e.target.value) }}
            onFocus={() => handleFocus('token')}
            onBlur={handleBlur}
            min="0"
            step="any"
            aria-label={`Amount in ${symbol}`}
          />
        </div>
        <div className="rz-converter-row">
          <span className="rz-converter-label">USD</span>
          <input
            type="number"
            className="rz-converter-input"
            value={side === 'usd' ? amount : (usdNum ? usdNum.toFixed(2) : '0')}
            onChange={(e) => { setSide('usd'); setAmount(e.target.value) }}
            onFocus={() => handleFocus('usd')}
            onBlur={handleBlur}
            min="0"
            step="any"
            aria-label={t('researchPro.tokenPanel.tokenconverter.ariaAmountInUsd', "Amount in USD")}
          />
        </div>
      </div>
    </div>
  )
}

const RzTokenPanel = ({
  symbol,
  onSymbolChange,
  isStock,
  tokenData,
  livePrice,
  stockData,
  icons,
  fmtPrice,
  fmtLarge,
  formatChange,
  currencySymbol,
  displayColors,
  onOpenPopup,
  performanceData,
  aiAnalysis,
  tokenLogo,
  categories,
  coinMarketData,
  loading,
  switcherPrices,
  onChainData,
  lastUpdated,
  aboutDetails,
}) => {
  const { t } = useTranslation()

  // Resolve categories: prefer CoinGecko categories from props. Cap at 12 so
  // multi-ecosystem assets (ZIG → Cosmos / Injective / Solana / BNB / Polygon
  // / Ethereum) keep their chain tags instead of getting clipped at 6.
  const displayCategories = (!isStock && categories && categories.length > 0)
    ? categories.slice(0, 12)
    : []

  // Token brand color for --token-rgb (curated → server KV → canvas → hash).
  const brand = useTokenBrandColor(symbol, tokenLogo, tokenData?.address)
  const brandRgb = TOKEN_ROW_COLORS[symbol]?.bg || brand.rgb

  return (
    <div
      className={`research-zone-lite-token-panel symbol-${symbol.toLowerCase()} price-${tokenData.change24h >= 0 ? 'up' : 'down'}`}
      style={{ '--token-rgb': brandRgb, '--token-rgb-accent': displayColors.accent || brandRgb, '--token-rgb-accent-day': displayColors.accentDay || brandRgb }}
    >
      <div className="research-zone-lite-overview">
        {/* Metrics grid - market cap, volume, FDV etc. */}

        <div className="research-zone-lite-metrics-grid">
          {loading ? (
            // Skeleton metric cards
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="research-zone-lite-card research-zone-lite-metric-card">
                <Skeleton style={{ width: 60, height: 10 }} />
                <Skeleton className="rz-skeleton--metric" style={{ marginTop: 8 }} />
              </div>
            ))
          ) : (
            (isStock ? [
              { label: t('common.marketCap'), raw: tokenData.mcap, accent: true, tip: TIPS.marketCap },
              { label: t('common.volume24h'), raw: tokenData.volume24h, accent: true, tip: TIPS.volume24h },
              { label: t('researchLite.peRatio'), raw: null, display: tokenData.pe != null ? tokenData.pe.toFixed(1) : '-', tip: TIPS.pe },
              { label: t('researchLite.eps'), raw: null, display: tokenData.eps != null ? fmtPrice(tokenData.eps) : '-', tip: TIPS.eps },
              { label: t('researchLite.sector'), raw: null, display: tokenData.sector || '-', tip: TIPS.sector },
              { label: t('researchLite.exchange'), raw: null, display: shortExchange(tokenData.exchange) || '-', tip: TIPS.exchange },
              ...(tokenData.avgVolume != null ? [{ label: t('researchLite.avgVolume'), raw: tokenData.avgVolume, tip: TIPS.avgVolume }] : []),
            ] : [
              { label: t('common.marketCap'), raw: tokenData.mcap, accent: true, tip: TIPS.marketCap },
              { label: t('common.volume24h'), raw: tokenData.volume24h, accent: true, tip: TIPS.volume24h },
              { label: t('researchLite.fdValuation'), raw: tokenData.fdv, accent: true, tip: TIPS.fdv },
              { label: t('researchLite.volMktCap'), raw: null, display: `${tokenData.volMcapPct}%`, tip: TIPS.volMcap },
              { label: t('researchLite.circSupply'), raw: null, display: tokenData.circulating != null ? `${(tokenData.circulating / 1e6).toFixed(2)}M` : '-', tip: TIPS.circSupply },
              ...(tokenData.maxSupply != null ? [{ label: t('common.totalSupply'), raw: null, display: `${tokenData.maxSupply >= 1e9 ? (tokenData.maxSupply / 1e9).toFixed(2) + 'B' : tokenData.maxSupply >= 1e6 ? (tokenData.maxSupply / 1e6).toFixed(2) + 'M' : tokenData.maxSupply >= 1e3 ? (tokenData.maxSupply / 1e3).toFixed(2) + 'K' : tokenData.maxSupply.toLocaleString()}`, tip: TIPS.totalSupply }] : []),
              ...(onChainData?.holders > 0 ? [{ label: t('researchLite.holders', 'Holders'), raw: null, display: onChainData.holders.toLocaleString(), tip: TIPS.holders }] : []),
            ]).map((m) => {
              const formatted = m.raw != null ? fmtLarge(m.raw) : m.display
              const match = typeof formatted === 'string' ? formatted.match(/^(\$[\d,.\s]+)(B|M|K|T)$/) : null
              return (
                <div key={m.label} className="research-zone-lite-card research-zone-lite-metric-card">
                  <span className="research-zone-lite-card-label">
                    {m.label}
                    <RzInfoIcon tip={m.tip} />
                  </span>
                  <span className={`research-zone-lite-card-value${m.accent ? ' research-zone-lite-value-accent' : ''}`}>
                    {match ? (<>{match[1]}<span className="rz-metric-suffix">{match[2]}</span></>) : formatted}
                  </span>
                </div>
              )
            })
          )}
        </div>

        {!isStock && !loading && tokenData.score != null && (
          <div className="research-zone-lite-card research-zone-lite-score-card">
            <span className="research-zone-lite-card-label">{t('common.score')}</span>
            <span className="research-zone-lite-card-value research-zone-lite-score-value">{tokenData.score}/10</span>
          </div>
        )}

        {!isStock && !loading && (tokenData.address || aboutDetails?.platforms) && (
          <RzContractRow address={tokenData.address} platforms={aboutDetails?.platforms} />
        )}

        {loading ? (
          <>
            <h3 className="research-zone-lite-left-section-title">
              {t('researchLite.categories')}
              <RzInfoIcon tip={TIPS.categories} />
            </h3>
            <div className="research-zone-lite-categories">
              {[90, 110, 80].map((w, i) => <Skeleton key={i} className="rz-skeleton--category" style={{ width: w }} />)}
            </div>
          </>
        ) : (
          <>
            {!isStock && displayCategories.length > 0 && (
              <>
                <h3 className="research-zone-lite-left-section-title">
                  {t('researchLite.categories')}
                  <RzInfoIcon tip={TIPS.categories} />
                </h3>
                <div className="research-zone-lite-categories">
                  {displayCategories.map((cat) => (
                    <span key={cat} className="research-zone-lite-category-tag">{cat}</span>
                  ))}
                </div>
              </>
            )}
            {isStock && (
              <>
                <h3 className="research-zone-lite-left-section-title">
                  {t('researchLite.sector')}
                  <RzInfoIcon tip={TIPS.sector} />
                </h3>
                <div className="research-zone-lite-categories">
                  <span className="research-zone-lite-category-tag">{tokenData.sector || 'N/A'}</span>
                </div>

                {/* ── Key Statistics ── */}
                <h3 className="research-zone-lite-left-section-title">
                  {t('researchPro.tokenPanel.rztokenpanel.keyStatistics', "Key Statistics")}
                  <RzInfoIcon tip={TIPS.keyStatistics} />
                </h3>
                <div className="research-zone-lite-card rz-stock-stats-table">
                  {[
                    { label: 'Prev Close', value: tokenData.previousClose ? fmtPrice(tokenData.previousClose) : '-' },
                    { label: 'Market Cap', value: tokenData.mcap ? fmtLarge(tokenData.mcap) : '-' },
                    // Null-prone rows render only when the data exists — a
                    // wall of "-" dashes read as "empty fields" (Sunny 07-06)
                    ...(tokenData.open ? [{ label: 'Open', value: fmtPrice(tokenData.open) }] : []),
                    { label: 'P/E Ratio', value: tokenData.pe != null ? tokenData.pe.toFixed(2) : '-' },
                    { label: 'Day Range', value: tokenData.dayLow && tokenData.dayHigh ? `${fmtPrice(tokenData.dayLow)}-${fmtPrice(tokenData.dayHigh)}` : '-' },
                    ...(tokenData.dividendYield != null && tokenData.dividendYield > 0 ? [{ label: 'Dividend Yield', value: `${tokenData.dividendYield.toFixed(2)}%` }] : []),
                    { label: '52W Range', value: tokenData.week52Low && tokenData.week52High ? `${fmtPrice(tokenData.week52Low)}-${fmtPrice(tokenData.week52High)}` : '-' },
                    { label: 'EPS', value: tokenData.eps != null ? fmtPrice(tokenData.eps) : '-' },
                    ...(tokenData.sharesOutstanding > 0 ? [{ label: 'Shares Out', value: tokenData.sharesOutstanding >= 1e9 ? `${(tokenData.sharesOutstanding / 1e9).toFixed(2)}B` : `${(tokenData.sharesOutstanding / 1e6).toFixed(0)}M` }] : []),
                    // Stock volume is SHARES, not dollars — fmtLarge's "$" made
                    // AAPL read "$16.54M volume"
                    { label: 'Volume (shares)', value: tokenData.volume24h ? (tokenData.volume24h >= 1e9 ? `${(tokenData.volume24h / 1e9).toFixed(2)}B` : `${(tokenData.volume24h / 1e6).toFixed(1)}M`) : '-' },
                  ].map(({ label, value }) => (
                    <div key={label} className="rz-stock-stats-row">
                      <span className="rz-stock-stats-label">{label}</span>
                      <span className="rz-stock-stats-value">{value}</span>
                    </div>
                  ))}
                </div>

                {/* ── Company Profile ── */}
                <h3 className="research-zone-lite-left-section-title">
                  {t('researchPro.tokenPanel.rztokenpanel.companyProfile', "Company Profile")}
                  <RzInfoIcon tip={TIPS.companyProfile} />
                </h3>
                <div className="research-zone-lite-card rz-stock-profile-table">
                  {[
                    { label: 'Symbol', value: symbol },
                    ...(tokenData.ipo ? [{ label: 'IPO Date', value: tokenData.ipo }] : []),
                    ...(tokenData.ceo ? [{ label: 'CEO', value: tokenData.ceo }] : []),
                    { label: 'Employees', value: tokenData.employees ? `${(tokenData.employees / 1000).toFixed(tokenData.employees >= 1000 ? 0 : 1)}K` : '-' },
                    { label: 'Sector', value: tokenData.sector || '-' },
                    ...(tokenData.industry && tokenData.industry !== tokenData.sector ? [{ label: 'Industry', value: tokenData.industry }] : []),
                    { label: 'Country', value: tokenData.country || '-' },
                    { label: 'Exchange', value: shortExchange(tokenData.exchange) || '-' },
                  ].map(({ label, value }) => (
                    <div key={label} className="rz-stock-stats-row">
                      <span className="rz-stock-stats-label">{label}</span>
                      <span className="rz-stock-stats-value">{value}</span>
                    </div>
                  ))}
                  {tokenData.description && (
                    <StockDescription text={tokenData.description} />
                  )}
                </div>

              </>
            )}
          </>
        )}

        {/* Token to USD converter */}
        {!isStock && !loading && tokenData.price > 0 && (
          <TokenConverter symbol={symbol} price={tokenData.price} />
        )}

        <h3 className="research-zone-lite-left-section-title">
          {isStock ? t('researchLite.weekRange') : t('researchLite.pricePerformance')}
          <RzInfoIcon tip={isStock ? TIPS.weekRange : TIPS.pricePerformance} />
        </h3>
        {loading ? (
          <div className="research-zone-lite-card research-zone-lite-range-card">
            <div className="research-zone-lite-range-row">
              <Skeleton style={{ width: 50, height: 12 }} />
              <Skeleton style={{ width: 80, height: 16 }} />
            </div>
            <div className="research-zone-lite-range-row">
              <Skeleton style={{ width: 50, height: 12 }} />
              <Skeleton style={{ width: 80, height: 16 }} />
            </div>
            <Skeleton className="rz-skeleton--range-bar" />
          </div>
        ) : (
          <div className="research-zone-lite-card research-zone-lite-range-card research-zone-lite-range-card--v2">
            {(() => {
              const low = isStock ? tokenData.week52Low : tokenData.low24h
              const high = isStock ? tokenData.week52High : tokenData.high24h
              const displayPrice = (livePrice != null && Number.isFinite(livePrice) && livePrice > 0)
                ? livePrice
                : tokenData.price
              const havePrice = low != null && high != null && displayPrice && high > low
              const pct = havePrice
                ? Math.min(100, Math.max(0, ((displayPrice - low) / (high - low)) * 100))
                : null
              const change = tokenData.change24h
              const labelEdge = pct == null ? 'center' : pct < 12 ? 'left' : pct > 88 ? 'right' : 'center'
              return (
                <>
                  <div className="research-zone-lite-range-header">
                    <div className="research-zone-lite-range-header-main">
                      <span className="research-zone-lite-range-header-label">{isStock ? '52W' : '24H'}</span>
                      <span className="research-zone-lite-range-header-price">{displayPrice != null ? fmtPrice(displayPrice) : 'N/A'}</span>
                    </div>
                    {change != null && (
                      <span className={`research-zone-lite-range-header-change ${change >= 0 ? 'up' : 'down'}`}>
                        {change >= 0 ? '+' : ''}{Number(change).toFixed(2)}%
                      </span>
                    )}
                  </div>
                  <div className="research-zone-lite-range-bar-wrap">
                    {pct != null && (
                      <span
                        className="research-zone-lite-range-now-tri"
                        style={{ left: `${pct}%` }}
                      />
                    )}
                    <div className="research-zone-lite-range-bar">
                      {pct != null && (
                        <div className="research-zone-lite-range-bar-fill" style={{ width: `${pct}%` }} />
                      )}
                    </div>
                  </div>
                  <div className="research-zone-lite-range-foot">
                    <span className="research-zone-lite-range-foot-end">
                      <span className="research-zone-lite-range-foot-tag">{t('researchPro.tokenPanel.rztokenpanel.low', "LOW")}</span>
                      <span className="research-zone-lite-range-foot-val">{low != null ? fmtPrice(low) : 'N/A'}</span>
                    </span>
                    <span className="research-zone-lite-range-foot-end research-zone-lite-range-foot-end--right">
                      <span className="research-zone-lite-range-foot-tag">{t('researchPro.tokenPanel.rztokenpanel.high', "HIGH")}</span>
                      <span className="research-zone-lite-range-foot-val">{high != null ? fmtPrice(high) : 'N/A'}</span>
                    </span>
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {!isStock && !loading && performanceData && performanceData.length > 0 && (
          <div className="research-zone-lite-perf-row">
            {performanceData.map(({ label, value }) => (
              <div key={label} className="research-zone-lite-perf-chip">
                <span className="research-zone-lite-perf-label">{label}</span>
                {value != null ? (
                  <span className={`research-zone-lite-perf-value ${value >= 0 ? 'up' : 'down'}`}>
                    {value >= 0 ? '+' : ''}{value.toFixed(1)}%
                  </span>
                ) : (
                  <span className="research-zone-lite-perf-value">N/A</span>
                )}
              </div>
            ))}
          </div>
        )}
        {!isStock && loading && (
          <div className="research-zone-lite-perf-row">
            {[1,2,3,4,5].map(i => <Skeleton key={i} className="rz-skeleton--perf-chip" />)}
          </div>
        )}

        {!isStock && !loading && (tokenData.ath != null || tokenData.atl != null) && (
          <>
            <h3 className="research-zone-lite-left-section-title">
              {t('researchLite.allTime')}
              <RzInfoIcon tip={TIPS.allTime} />
            </h3>
            <div className="research-zone-lite-card research-zone-lite-ath-card">
              <div className="research-zone-lite-ath-row research-zone-lite-ath-row--ath">
                <div className="research-zone-lite-ath-main">
                  <span className="research-zone-lite-card-label">{t('researchLite.allTimeHigh')}</span>
                  <div className="research-zone-lite-ath-line">
                    <span className="research-zone-lite-card-value">{tokenData.ath != null ? fmtPrice(tokenData.ath) : 'N/A'}</span>
                    {tokenData.athDate && (
                      <span className="research-zone-lite-card-meta">{formatDate(tokenData.athDate)}</span>
                    )}
                  </div>
                </div>
                {tokenData.athChangePct != null && (
                  <span className="research-zone-lite-ath-delta down">
                    <span className="research-zone-lite-ath-delta-arrow">↓</span>
                    {formatChange(Math.abs(tokenData.athChangePct))}%
                  </span>
                )}
              </div>
              <div className="research-zone-lite-ath-divider" />
              <div className="research-zone-lite-ath-row research-zone-lite-ath-row--atl">
                <div className="research-zone-lite-ath-main">
                  <span className="research-zone-lite-card-label">{t('researchLite.allTimeLow')}</span>
                  <div className="research-zone-lite-ath-line">
                    <span className="research-zone-lite-card-value">{tokenData.atl != null ? fmtPrice(tokenData.atl) : 'N/A'}</span>
                    {tokenData.atlDate && (
                      <span className="research-zone-lite-card-meta">{formatDate(tokenData.atlDate)}</span>
                    )}
                  </div>
                </div>
                {tokenData.atlChangePct != null && (
                  <span className="research-zone-lite-ath-delta up">
                    <span className="research-zone-lite-ath-delta-arrow">↑</span>
                    {tokenData.atlChangePct >= 1000
                      ? `${Math.round((tokenData.atlChangePct / 100) + 1).toLocaleString()}×`
                      : `${formatChange(tokenData.atlChangePct)}%`}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
        {!isStock && loading && (
          <>
            <h3 className="research-zone-lite-left-section-title">
              {t('researchLite.allTime')}
              <RzInfoIcon tip={TIPS.allTime} />
            </h3>
            <div className="research-zone-lite-card research-zone-lite-ath-card">
              <div className="research-zone-lite-ath-row">
                <Skeleton style={{ width: 40, height: 12 }} />
                <Skeleton className="rz-skeleton--ath-value" />
              </div>
              <div className="research-zone-lite-ath-row">
                <Skeleton style={{ width: 40, height: 12 }} />
                <Skeleton className="rz-skeleton--ath-value" />
              </div>
            </div>
          </>
        )}

        {!isStock && !loading && aiAnalysis && (aiAnalysis.support || aiAnalysis.resistance) && (
          <div className="research-zone-lite-levels">
            <h3 className="research-zone-lite-levels-title">
              {t('researchPro.keyLevels', 'Key Levels')}
              <RzInfoIcon tip={TIPS.keyLevels} />
            </h3>
            {aiAnalysis.support && (
              <div className="research-zone-lite-level-row">
                <span className="research-zone-lite-level-dot" style={{ background: 'var(--bull, #22c55e)' }} />
                <span className="research-zone-lite-level-label">{t('researchPro.support', 'Support')}</span>
                <span className="research-zone-lite-level-value">{aiAnalysis.support}</span>
              </div>
            )}
            {aiAnalysis.resistance && (
              <div className="research-zone-lite-level-row">
                <span className="research-zone-lite-level-dot" style={{ background: 'var(--bear, #ef4444)' }} />
                <span className="research-zone-lite-level-label">{t('researchPro.resistance', 'Resistance')}</span>
                <span className="research-zone-lite-level-value">{aiAnalysis.resistance}</span>
              </div>
            )}
          </div>
        )}
        {!isStock && !loading && aiAnalysis?.trend && (
          <div className="research-zone-lite-insight">
            <div className="research-zone-lite-insight-header">
              <span className="research-zone-lite-insight-icon">{spectreIcons.sparkles}</span>
              <span>{t('researchPro.tokenPanel.rztokenpanel.aiInsight', "AI Insight")}</span>
              <RzInfoIcon tip={TIPS.aiInsight} />
            </div>
            <p className="research-zone-lite-insight-text">{aiAnalysis.trend}</p>
          </div>
        )}
        {!isStock && loading && (
          <Skeleton className="rz-skeleton--insight" style={{ marginTop: 16 }} />
        )}

      </div>
    </div>
  )
}

export default React.memo(RzTokenPanel)
