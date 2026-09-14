/**
 * WhisperResults - Displays AI-interpreted search results for Whisper mode
 *
 * Shows: interpretation bar, filter pills, compact results table, skeleton loading
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'

// ── Formatting helpers ──────────────────────────────────────────────────────

function formatChange(val) {
  if (val == null || isNaN(val)) return '-'
  const sign = val >= 0 ? '+' : ''
  return `${sign}${val.toFixed(2)}%`
}

// ── Filter pill labels ──────────────────────────────────────────────────────

const CATEGORY_LABEL_KEYS = {
  'meme-token': 'whisper.catMeme',
  'decentralized-finance-defi': 'whisper.catDeFi',
  'layer-1': 'whisper.catLayer1',
  'layer-2': 'whisper.catLayer2',
  'artificial-intelligence': 'whisper.catAI',
  'gaming': 'whisper.catGaming',
  'real-world-assets': 'whisper.catRWA',
  'decentralized-physical-infrastructure-networks': 'whisper.catDePIN',
  'solana-ecosystem': 'whisper.catSolana',
  'ethereum-ecosystem': 'whisper.catEthereum',
  'base-ecosystem': 'whisper.catBase',
}

const SORT_LABEL_KEYS = {
  price_asc: 'whisper.sortPriceUp',
  price_desc: 'whisper.sortPriceDown',
  change_asc: 'whisper.sortChangeUp',
  change_desc: 'whisper.sortChangeDown',
  market_cap_desc: 'whisper.sortMcapDown',
  market_cap_asc: 'whisper.sortMcapUp',
  volume_desc: 'whisper.sortVolumeDown',
}

function buildFilterPills(filters, assetClass, fmtLarge, t) {
  if (!filters) return []
  const pills = []
  if (assetClass) pills.push({ key: 'asset', label: assetClass === 'stocks' ? `📈 ${t('nav.stocks')}` : `🪙 ${t('nav.crypto')}` })
  if (filters.category) {
    const catKey = CATEGORY_LABEL_KEYS[filters.category]
    pills.push({ key: 'cat', label: catKey ? t(catKey) : filters.category })
  }
  if (filters.sector) pills.push({ key: 'sector', label: `${t('whisper.sector')}: ${filters.sector}` })
  if (filters.minPrice != null) pills.push({ key: 'minP', label: `${t('whisper.min')} ${fmtLarge(filters.minPrice)}` })
  if (filters.maxPrice != null) pills.push({ key: 'maxP', label: `${t('whisper.max')} ${fmtLarge(filters.maxPrice)}` })
  if (filters.minChange24h != null) pills.push({ key: 'minC', label: `${t('whisper.change')} ≥ ${filters.minChange24h}%` })
  if (filters.maxChange24h != null) pills.push({ key: 'maxC', label: `${t('whisper.change')} ≤ ${filters.maxChange24h}%` })
  if (filters.minMarketCap != null) pills.push({ key: 'minMC', label: `${t('whisper.mcap')} ≥ ${fmtLarge(filters.minMarketCap)}` })
  if (filters.maxMarketCap != null) pills.push({ key: 'maxMC', label: `${t('whisper.mcap')} ≤ ${fmtLarge(filters.maxMarketCap)}` })
  if (filters.minVolume != null) pills.push({ key: 'minV', label: `${t('whisper.vol')} ≥ ${fmtLarge(filters.minVolume)}` })
  if (filters.sort) {
    const sortKey = SORT_LABEL_KEYS[filters.sort]
    pills.push({ key: 'sort', label: sortKey ? t(sortKey) : filters.sort })
  }
  return pills
}

// ── Skeleton loading state ──────────────────────────────────────────────────

function WhisperSkeleton() {
  return (
    <div className="whisper-results whisper-skeleton">
      <div className="whisper-interpretation skeleton-bar" style={{ width: '85%', height: 20 }} />
      <div className="whisper-filter-pills">
        <span className="skeleton-pill" style={{ width: 60 }} />
        <span className="skeleton-pill" style={{ width: 80 }} />
        <span className="skeleton-pill" style={{ width: 50 }} />
      </div>
      <div className="whisper-table">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="whisper-table-row skeleton-row" style={{ animationDelay: `${i * 80}ms` }}>
            <span className="skeleton-bar" style={{ width: '100%', height: 36 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

const WhisperResults = ({ data, loading, error, onSelectToken, onSelectStock }) => {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()

  // Loading state
  if (loading) return <WhisperSkeleton />

  // Error state
  if (error) {
    return (
      <div className="whisper-results whisper-error-state">
        <div className="whisper-error-msg">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
        <p className="whisper-error-hint">{t('whisper.errorHint')}</p>
      </div>
    )
  }

  // Empty / no data state
  if (!data) {
    return (
      <div className="whisper-results whisper-empty-state">
        <div className="whisper-empty-icon">✦</div>
        <p className="whisper-empty-text">{t('whisper.askAnything')}</p>
        <p className="whisper-empty-examples">
          {t('whisper.tryExamples')}
        </p>
      </div>
    )
  }

  const { interpretation, assetClass, filters, results } = data
  const pills = buildFilterPills(filters, assetClass, fmtLarge, t)
  const isCrypto = assetClass !== 'stocks'

  return (
    <div className="whisper-results">
      {/* Interpretation bar */}
      {interpretation && (
        <div className="whisper-interpretation">
          <span className="whisper-interp-icon">✦</span>
          <span className="whisper-interp-text">{interpretation}</span>
        </div>
      )}

      {/* Filter pills */}
      {pills.length > 0 && (
        <div className="whisper-filter-pills">
          {pills.map((pill, i) => (
            <span
              key={pill.key}
              className="whisper-pill"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {pill.label}
            </span>
          ))}
        </div>
      )}

      {/* Results table */}
      {results && results.length > 0 ? (
        <div className="whisper-table">
          <div className="whisper-table-header">
            <span className="wt-col wt-rank">#</span>
            <span className="wt-col wt-name">{t('common.name')}</span>
            <span className="wt-col wt-price">{t('common.price')}</span>
            <span className="wt-col wt-change">{t('common.change24h')}</span>
            <span className="wt-col wt-mcap">{t('common.marketCap')}</span>
            <span className="wt-col wt-volume">{t('common.volume')}</span>
          </div>
          {results.map((item, i) => (
            <div
              key={item.symbol + i}
              className="whisper-table-row"
              style={{ animationDelay: `${i * 50}ms` }}
              onClick={() => {
                if (isCrypto && onSelectToken) {
                  onSelectToken({
                    symbol: item.symbol,
                    name: item.name,
                    id: item.id,
                    logo: item.logo,
                    price: item.price,
                    change: item.change24h,
                    marketCap: item.marketCap,
                  })
                } else if (!isCrypto && onSelectStock) {
                  onSelectStock({
                    symbol: item.symbol,
                    name: item.name,
                    price: item.price,
                    change: item.change24h,
                    marketCap: item.marketCap,
                  })
                }
              }}
            >
              <span className="wt-col wt-rank">{item.rank || i + 1}</span>
              <span className="wt-col wt-name">
                {isCrypto && item.logo && (
                  <img
                    className="wt-logo"
                    src={item.logo}
                    alt=""
                    width={24}
                    height={24}
                    loading="lazy"
                    onError={(e) => { e.target.style.display = 'none' }}
                  />
                )}
                <span className="wt-name-text">
                  <strong>{item.symbol}</strong>
                  <span className="wt-name-full">{item.name}</span>
                </span>
              </span>
              <span className="wt-col wt-price">{fmtPrice(item.price)}</span>
              <span className={`wt-col wt-change ${(item.change24h || 0) >= 0 ? 'positive' : 'negative'}`}>
                {formatChange(item.change24h)}
              </span>
              <span className="wt-col wt-mcap">{fmtLarge(item.marketCap)}</span>
              <span className="wt-col wt-volume">{fmtLarge(item.volume)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="whisper-no-results">
          <p>{t('whisper.noResults')}</p>
          <p className="whisper-no-results-hint">{t('whisper.noResultsHint')}</p>
        </div>
      )}

      {/* Footer */}
      {results && results.length > 0 && (
        <div className="whisper-footer">
          <span className="whisper-count">{t('whisper.resultCount', { count: results.length })}</span>
        </div>
      )}
    </div>
  )
}

export default React.memo(WhisperResults)
