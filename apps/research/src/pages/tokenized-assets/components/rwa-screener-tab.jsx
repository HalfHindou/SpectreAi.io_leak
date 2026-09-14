import React, { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { ScreenerChips } from './shared'
import TaSelect from './shared/ta-select'
import { TA_CATEGORICAL } from './shared/ta-tokens'
import { classifyProtocol } from './rwa-shared'

/* ── Preset definitions (labels resolved at render via t()) ── */
const PRESETS = [
  { id: 'treasury',    labelKey: 'tokenizedAssets.screener.presets.treasury',    labelFallback: 'Treasury Management' },
  { id: 'yields',      labelKey: 'tokenizedAssets.screener.presets.yields',      labelFallback: 'Yields' },
  { id: 'growth',      labelKey: 'tokenizedAssets.screener.presets.growth',      labelFallback: 'Growth' },
  { id: 'stablecoins', labelKey: 'tokenizedAssets.screener.presets.stablecoins', labelFallback: 'Stablecoins' },
  { id: 'credit',      labelKey: 'tokenizedAssets.screener.presets.credit',      labelFallback: 'Credit Opportunities' },
]

const MIN_AUM_TIERS = [
  { id: 'any',  label: 'Any',    value: 0 },
  { id: '1m',   label: '$1M+',   value: 1e6 },
  { id: '10m',  label: '$10M+',  value: 1e7 },
  { id: '100m', label: '$100M+', value: 1e8 },
  { id: '1b',   label: '$1B+',   value: 1e9 },
]

const SORT_OPTIONS = [
  { id: 'aum',        labelKey: 'tokenizedAssets.screener.sortAum',       labelFallback: 'Highest AUM' },
  { id: 'change_7d',  labelKey: 'tokenizedAssets.screener.sortGrowth7d',  labelFallback: 'Growth 7D' },
  { id: 'change_30d', labelKey: 'tokenizedAssets.screener.sortGrowth30d', labelFallback: 'Growth 30D' },
]

const ASSET_CLASSES = ['Treasuries', 'Credit', 'Commodities', 'Other RWA']

function fmtDelta(v) {
  if (v == null) return '--'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

/* ── Applied preset → filter combo ── */
function applyPreset(presetId) {
  switch (presetId) {
    case 'treasury':
      return { assetClasses: ['Treasuries'], minAum: '100m', sort: 'aum' }
    case 'yields':
      return { assetClasses: [], minAum: 'any', sort: 'change_7d' }
    case 'growth':
      return { assetClasses: [], minAum: '10m', sort: 'change_30d' }
    case 'stablecoins':
      return { assetClasses: ['Stablecoins'], minAum: 'any', sort: 'aum', source: 'stablecoins' }
    case 'credit':
      return { assetClasses: ['Credit'], minAum: 'any', sort: 'aum' }
    default:
      return null
  }
}

/* Coarse momentum micro-trend, reconstructed from the real change_30d/7d/1d
   deltas: relative TVL N days ago = now / (1 + changeN/100). This is a shape
   cue (3-4 points), NOT high-res history — the list payload ships no series. */
function CardSparkline({ change_1d, change_7d, change_30d }) {
  const rel = []
  if (change_30d != null) rel.push(1 / (1 + change_30d / 100))
  if (change_7d != null) rel.push(1 / (1 + change_7d / 100))
  if (change_1d != null) rel.push(1 / (1 + change_1d / 100))
  rel.push(1) // now
  if (rel.length < 2) return null
  const min = Math.min(...rel), max = Math.max(...rel)
  const span = max - min || 1
  const W = 56, H = 20, pad = 2
  const pts = rel.map((v, i) => {
    const x = pad + (i / (rel.length - 1)) * (W - pad * 2)
    const y = pad + (1 - (v - min) / span) * (H - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const dir = change_7d ?? change_30d ?? 0
  const color = dir >= 0 ? 'var(--bull)' : 'var(--bear)'
  return (
    <svg className="ta-screener-card-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/* ── Asset card ── */
function AssetCard({ asset, onClick, t, fmtMoney }) {
  const color = TA_CATEGORICAL[(asset.__rank || 0) % TA_CATEGORICAL.length]
  return (
    <button
      type="button"
      className="ta-screener-card"
      onClick={() => onClick?.(asset.slug)}
    >
      <div className="ta-screener-card-head">
        <img
          className="ta-screener-card-logo"
          src={asset.logo}
          alt=""
          loading="lazy"
          onError={e => {
            e.target.style.display = 'none'
            const fb = e.target.nextSibling
            if (fb) fb.style.display = 'inline-flex'
          }}
        />
        <span
          className="ta-screener-card-logo-fb"
          style={{ display: 'none', background: color }}
        >
          {(asset.name || '?')[0]}
        </span>
        <div className="ta-screener-card-title">
          <span className="ta-screener-card-name">{asset.name}</span>
          <span className="ta-screener-card-pill">{asset.assetClass}</span>
        </div>
        <CardSparkline change_1d={asset.change_1d} change_7d={asset.change_7d} change_30d={asset.change_30d} />
      </div>
      <div className="ta-screener-card-metrics">
        <div className="ta-screener-card-metric">
          <span className="ta-screener-card-metric-label">{t('tokenizedAssets.kpi.aum', 'AUM')}</span>
          <span className="ta-screener-card-metric-value mono">{fmtMoney(asset.tvl)}</span>
        </div>
        <div className="ta-screener-card-metric">
          <span className="ta-screener-card-metric-label">7D</span>
          <span
            className={`ta-screener-card-metric-value mono${asset.change_7d != null ? (asset.change_7d >= 0 ? ' bull' : ' bear') : ''}`}
          >
            {fmtDelta(asset.change_7d)}
          </span>
        </div>
      </div>
      {asset.description && (
        <p className="ta-screener-card-desc">{asset.description}</p>
      )}
      {asset.chains?.length > 0 && (
        <div className="ta-screener-card-chains">
          {asset.chains.slice(0, 4).map((c) => (
            <span key={c} className="ta-screener-card-chain">{c}</span>
          ))}
          {asset.chains.length > 4 && (
            <span className="ta-screener-card-chain ta-screener-card-chain--more">
              +{asset.chains.length - 4}
            </span>
          )}
        </div>
      )}
    </button>
  )
}

/* ── Main ── */
export default function RwaScreenerTab({ protocols, stablecoins, loading, onAssetOpen }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (v) => (v == null || !isFinite(v) ? '--' : fmtLargeShort(v))
  const [preset, setPreset] = useState(null)
  const [minAum, setMinAum] = useState('any')
  const [assetClasses, setAssetClasses] = useState([])
  const [chain, setChain] = useState('all')
  const [sort, setSort] = useState('aum')
  const [visible, setVisible] = useState(30)
  const [source, setSource] = useState('protocols') // 'protocols' | 'stablecoins'

  /* ── Unique chains for dropdown ── */
  const chainOptions = useMemo(() => {
    const set = new Set()
    for (const p of protocols || []) {
      for (const c of p.chains || []) set.add(c)
    }
    return ['all', ...Array.from(set).sort()]
  }, [protocols])

  /* ── Base pool ── */
  const pool = useMemo(() => {
    if (source === 'stablecoins') {
      return (stablecoins || []).map((sc, i) => ({
        __rank: i,
        slug: sc.slug || (sc.name || sc.symbol || '').toLowerCase().replace(/\s+/g, '-'),
        name: sc.name || sc.symbol || '--',
        assetClass: 'Stablecoins',
        tvl: sc.circulating?.peggedUSD ?? sc.mcap ?? 0,
        change_1d: sc.change_1d ?? null,
        change_7d: sc.change_7d ?? null,
        change_30d: sc.change_30d ?? null,
        description: sc.symbol,
        // `chains` is the lightweight name array kept in the core bundle; the
        // heavy per-chain `chainCirculating` map is no longer shipped to the
        // page paint (lazy-loaded by the Stablecoins tab only).
        chains: sc.chains || [],
        logo: `https://icons.llama.fi/icons/coins/${(sc.symbol || '').toLowerCase()}.png`,
      }))
    }
    return (protocols || []).map((p, i) => ({
      __rank: i,
      slug: p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-'),
      name: p.name,
      assetClass: classifyProtocol(p),
      tvl: p.tvl || 0,
      change_1d: p.change_1d ?? null,
      change_7d: p.change_7d ?? null,
      change_30d: p.change_30d ?? null,
      description: p.description,
      chains: p.chains || [],
      logo: `https://icons.llama.fi/protocols/${p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-')}`,
    }))
  }, [protocols, stablecoins, source])

  /* ── Apply filters ── */
  const filtered = useMemo(() => {
    const tier = MIN_AUM_TIERS.find(t => t.id === minAum)
    const minValue = tier?.value ?? 0

    let out = pool.filter(a => a.tvl >= minValue)
    if (assetClasses.length > 0) {
      out = out.filter(a => assetClasses.includes(a.assetClass))
    }
    if (chain !== 'all') {
      out = out.filter(a => a.chains.includes(chain))
    }

    // Sort
    const getSortVal = (a) => {
      if (sort === 'change_7d') return a.change_7d ?? -Infinity
      if (sort === 'change_30d') return a.change_30d ?? -Infinity
      return a.tvl
    }
    out = [...out].sort((a, b) => getSortVal(b) - getSortVal(a))
    return out
  }, [pool, minAum, assetClasses, chain, sort])

  /* ── Handlers ── */
  const handlePresetChange = useCallback(({ preset: nextPreset }) => {
    setPreset(nextPreset)
    setVisible(30)
    if (!nextPreset) {
      // Clearing preset — don't auto-clear filters; user may have tweaked them.
      return
    }
    const combo = applyPreset(nextPreset)
    if (!combo) return
    setMinAum(combo.minAum)
    setAssetClasses(combo.assetClasses || [])
    setSort(combo.sort)
    setSource(combo.source || 'protocols')
  }, [])

  const handleAumTierChange = useCallback((id) => {
    setMinAum(id)
    setVisible(30)
  }, [])

  const toggleAssetClass = useCallback((cls) => {
    setAssetClasses(prev => prev.includes(cls) ? prev.filter(c => c !== cls) : [...prev, cls])
    setVisible(30)
  }, [])

  const handleChainChange = useCallback((e) => {
    setChain(e.target.value)
    setVisible(30)
  }, [])

  const handleSortChange = useCallback((e) => {
    setSort(e.target.value)
    setVisible(30)
  }, [])

  const activeFilters = useMemo(() => {
    const chips = []
    if (preset) {
      const p = PRESETS.find(p => p.id === preset)
      const label = p ? t(p.labelKey, p.labelFallback) : preset
      chips.push({ id: `preset:${preset}`, label: `${t('tokenizedAssets.screener.presetPrefix', 'Preset')}: ${label}`, clear: () => { setPreset(null); setAssetClasses([]); setMinAum('any'); setSort('aum'); setSource('protocols') } })
    }
    if (minAum !== 'any') chips.push({ id: `aum:${minAum}`, label: `${t('tokenizedAssets.kpi.aum', 'AUM')} ${MIN_AUM_TIERS.find(tier => tier.id === minAum)?.label}`, clear: () => setMinAum('any') })
    for (const cls of assetClasses) {
      chips.push({ id: `cls:${cls}`, label: cls, clear: () => toggleAssetClass(cls) })
    }
    if (chain !== 'all') chips.push({ id: `chain:${chain}`, label: `${t('tokenizedAssets.slicer.chain', 'Chain')}: ${chain}`, clear: () => setChain('all') })
    if (sort !== 'aum') {
      const s = SORT_OPTIONS.find(s => s.id === sort)
      const label = s ? t(s.labelKey, s.labelFallback) : sort
      chips.push({ id: `sort:${sort}`, label: `${t('tokenizedAssets.screener.sortPrefix', 'Sort')}: ${label}`, clear: () => setSort('aum') })
    }
    return chips
  }, [preset, minAum, assetClasses, chain, sort, toggleAssetClass, t])

  const clearAll = useCallback(() => {
    setPreset(null)
    setMinAum('any')
    setAssetClasses([])
    setChain('all')
    setSort('aum')
    setSource('protocols')
    setVisible(30)
  }, [])

  const visibleResults = filtered.slice(0, visible)
  const hasMore = filtered.length > visibleResults.length

  return (
    <div className="ta-tab-content ta-screener">
      {/* 1. Preset chips + AUM tiers */}
      <div className="ta-screener-presets">
        <ScreenerChips
          preset={preset}
          minAum={minAum}
          onChange={({ preset: np, minAum: nAum }) => {
            if (np !== preset) handlePresetChange({ preset: np })
            if (nAum !== minAum) handleAumTierChange(nAum)
          }}
          presets={PRESETS}
        />
      </div>

      {/* 2. Filter bar */}
      <div className="ta-screener-filters">
        <div className="ta-screener-filter">
          <span className="ta-screener-filter-label">{t('tokenizedAssets.screener.assetClass', 'Asset Class')}</span>
          <div className="ta-screener-multi">
            {ASSET_CLASSES.map((cls) => (
              <button
                key={cls}
                type="button"
                className={`ta-screener-multi-btn${assetClasses.includes(cls) ? ' active' : ''}`}
                onClick={() => toggleAssetClass(cls)}
              >
                {cls}
              </button>
            ))}
          </div>
        </div>
        <div className="ta-screener-filter">
          <span className="ta-screener-filter-label">{t('tokenizedAssets.slicer.chain', 'Chain')}</span>
          <TaSelect
            ariaLabel={t('tokenizedAssets.slicer.chain', 'Chain')}
            value={chain}
            onChange={handleChainChange}
            options={chainOptions.map((c) => ({
              value: c,
              label: c === 'all' ? t('tokenizedAssets.screener.allChains', 'All chains') : c,
            }))}
          />
        </div>
        <div className="ta-screener-filter">
          <span className="ta-screener-filter-label">{t('tokenizedAssets.screener.sortBy', 'Sort By')}</span>
          <TaSelect
            ariaLabel={t('tokenizedAssets.screener.sortBy', 'Sort By')}
            value={sort}
            onChange={handleSortChange}
            options={SORT_OPTIONS.map((s) => ({
              value: s.id,
              label: t(s.labelKey, s.labelFallback),
            }))}
          />
        </div>
      </div>

      {/* 3. Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="ta-screener-active">
          {activeFilters.map((f) => (
            <button
              key={f.id}
              type="button"
              className="ta-screener-chip-active"
              onClick={f.clear}
            >
              <span>{f.label}</span>
              <span className="ta-screener-chip-x">{'\u00D7'}</span>
            </button>
          ))}
          <button
            type="button"
            className="ta-screener-chip-clear"
            onClick={clearAll}
          >
            {t('tokenizedAssets.screener.clearN', 'Clear {{count}} filters', { count: activeFilters.length })}
          </button>
        </div>
      )}

      {/* 4. Result count */}
      <div className="ta-screener-count-row">
        <span className="ta-screener-count mono">{filtered.length.toLocaleString()}</span>
        <span className="ta-screener-count-label">
          {source === 'stablecoins' ? t('tokenizedAssets.screener.stablecoinsWord', 'stablecoins') : t('tokenizedAssets.screener.assetsWord', 'assets')}
        </span>
      </div>

      {/* 5. Results grid */}
      {loading && !filtered.length ? (
        <div className="ta-screener-grid">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className={`ta-screener-card-skel animate-shimmer stagger-${(i % 5) + 1}`} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="ta-screener-empty">
          {t('tokenizedAssets.screener.emptyMatch', 'No assets match your filters.')} <button type="button" className="ta-screener-empty-clear" onClick={clearAll}>{t('tokenizedAssets.screener.clearAll', 'Clear all')}</button>
        </div>
      ) : (
        <>
          <div className="ta-screener-grid">
            {visibleResults.map((a) => (
              <AssetCard key={a.slug} asset={a} onClick={onAssetOpen} t={t} fmtMoney={fmtMoney} />
            ))}
          </div>
          {hasMore && (
            <div className="ta-screener-more">
              <button
                type="button"
                className="ta-screener-more-btn"
                onClick={() => setVisible(v => v + 30)}
              >
                {t('tokenizedAssets.screener.loadMore', 'Load more')} <span className="mono">({t('tokenizedAssets.screener.leftCount', '{{count}} left', { count: filtered.length - visibleResults.length })})</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
