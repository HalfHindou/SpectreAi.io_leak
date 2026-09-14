/**
 * SectorsTabPanel — Crypto Sector Performance tab for the Command Center.
 *
 * Apple Cinematic design language — information-dense, zero ornament.
 * Shows sector rotation, performance grid, and AI-derived signals.
 *
 * Data: own useSectorData call. This panel is lazy-mounted by the Command
 * Center, so the 3 underlying fetches (categories + signals + top movers)
 * only fire when the user actually opens the Sectors tab.
 */
import { memo, useEffect, useMemo, useState, useCallback, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'
import { isMajorToken } from '@/constants/majorTokens'
import { sanitizeAiText } from '@/lib/sanitizeAiText'
import { getPathForPageId } from '@/constants/pageRoutes'
import useSectorData from '@/hooks/useSectorData'
import useNarrativeAttention from './use-narrative-attention'
import SecAttention from './sec-attention'
import { getSectorSnapshot } from '@/services/sectorSnapshot'
import { trackUi } from '@/services/analytics'
import { TOKEN_LOGOS } from './welcome-page-constants'
import './sectors-tab-panel.css'

const SectorCompareChart = lazy(() => import('@/components/sector-compare-chart'))
// The AI Charts compare board, reused here as the third Sectors view: chains,
// sectors and tokens on one normalised axis, with the Fear & Greed overlay.
const CompareChart = lazy(() => import('@/pages/ai-charts/components/compare-chart'))

// Warm the snapshot cache the moment the Sectors tab mounts. The lazy chunk
// download for SectorCompareChart and this fetch then race in parallel
// instead of running sequentially (mount → chunk → fetch). By the time the
// chart paints, the snapshot is usually already in the 5min client cache.
const SC_PREFETCH_SLUGS = ['meme-token', 'layer-1', 'decentralized-finance-defi', 'layer-2', 'gaming', 'artificial-intelligence', 'privacy-coins']

const INITIAL_VISIBLE = 10
const LANE_ROWS = 5

// The four rotation states, in reading order: what is working, what is starting
// to work, what is breaking, what nobody is touching.
const ROTATION_LANES = [
  { id: 'leaders',  label: 'Leaders',  up: true,  meaning: 'up, on heavy volume' },
  { id: 'emerging', label: 'Emerging', up: true,  meaning: 'up, on lighter volume' },
  { id: 'fading',   label: 'Fading',   up: false, meaning: 'down, volume still there' },
  { id: 'lagging',  label: 'Lagging',  up: false, meaning: 'down, and nobody is trading it' },
]

const fmtCount = (n) => (Number(n) >= 1000 ? Number(n).toLocaleString('en-US') : String(Number(n) || 0))

function fmtVolume(v) {
  if (!v || v === 0) return '$0'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v}`
}

const STAGE_ORDER = { Growth: 0, Established: 1, Mature: 2, Early: 0, 'Early-Mid': 1, Mid: 2, 'Mid-Late': 3, Late: 4 }

const SectorsTabPanel = ({ onOpenResearchZone, onOpenAIScreener, topCoinPrices }) => {
  const { t } = useTranslation()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const navigate = useNavigate()
  // Two views, and the chart is the one that opens (founder, 08-18): the
  // performance chart IS the sector tab's headline, so it can't sit below an
  // attention board where nobody scrolls to it. Attention is one tap away.
  const [view, setView] = useState('performance')

  // Lazy-mounted: this hook only fires when the user actually opens the
  // Sectors tab. Previously it lived in useMarketIntelligence and ran on
  // every Welcome page mount.
  const { sectors: sectorPerformance, aiAnalysis: sectorAiAnalysis, loading: sectorLoading } = useSectorData({ sectorLimit: 40 })

  // ATTENTION is what this tab leads with now (founder, 08-18): which narratives
  // are moving, which have momentum, which are fading — read off the X Dash
  // narrative feed, which is live and hourly, rather than off the category feed
  // that answers a price question and had been frozen since 13 May.
  const { narratives, summary: attentionSummary, loading: attentionLoading, window: attentionWindow } = useNarrativeAttention()

  // Kick off the SectorCompareChart snapshot fetch in parallel with the
  // lazy chunk download — fire-and-forget, the service module-caches +
  // dedupes so the chart's own fetch just hits the warm cache.
  useEffect(() => { getSectorSnapshot(SC_PREFETCH_SLUGS).catch(() => {}) }, [])

  // Navigate to Categories page with the tapped sector pre-selected.
  // Uses the same sessionStorage handshake as MindshareTabPanel — categories-page
  // reads `spectre-category-target` on mount and auto-opens the matching category.
  const openCategoryPage = useCallback((sector) => {
    if (!sector) return
    const id = sector.id || sector.sector_id || null
    const name = sector.name || null
    try {
      sessionStorage.setItem('spectre-category-target', JSON.stringify({ id, name, ts: Date.now() }))
    } catch (_) { /* storage may be disabled */ }
    navigate(getPathForPageId('categories'))
  }, [navigate])

  // A name inside an opened narrative. The X Dash feed carries the CoinGecko id
  // for every one of them, so Research Zone can render it directly; the AI
  // Screener is the fallback for a pure on-chain row with no CG listing.
  const openNarrativeToken = useCallback((leader) => {
    if (!leader?.symbol) return
    trackUi('sectors_narrative_token', leader.symbol)
    const tokenData = {
      symbol: leader.symbol,
      name: leader.name || leader.symbol,
      price: 0,
      change: leader.change24 ?? 0,
      logo: leader.image || TOKEN_LOGOS[leader.symbol] || null,
      token_id: leader.cgId || null,
      cgId: leader.cgId || null,
      address: leader.address || null,
      networkId: leader.chain || null,
    }
    if (leader.cgId || isMajorToken(leader.symbol)) {
      if (onOpenResearchZone) return onOpenResearchZone(tokenData)
    }
    if (onOpenAIScreener) return onOpenAIScreener(tokenData)
    if (onOpenResearchZone) onOpenResearchZone(tokenData)
  }, [onOpenResearchZone, onOpenAIScreener])

  const sectors = useMemo(() => {
    if (sectorPerformance && sectorPerformance.length >= 3) return sectorPerformance
    return []
  }, [sectorPerformance])

  const [showAll, setShowAll] = useState(false)

  // Derive rotation signal from sector data
  const rotationSignal = useMemo(() => {
    if (sectors.length === 0) return { label: 'Neutral', bias: 'neutral', breadth: 0 }
    const advancing = sectors.filter(s => s.avgChange > 0).length
    const breadth = Math.round((advancing / sectors.length) * 100)
    const avgAll = sectors.reduce((s, sec) => s + sec.avgChange, 0) / sectors.length
    if (avgAll > 3) return { label: 'Risk-On', bias: 'bullish', breadth }
    if (avgAll > 0.5) return { label: 'Selective', bias: 'bullish', breadth }
    if (avgAll > -0.5) return { label: 'Mixed', bias: 'neutral', breadth }
    if (avgAll > -3) return { label: 'Defensive', bias: 'bearish', breadth }
    return { label: 'Risk-Off', bias: 'bearish', breadth }
  }, [sectors])

  // Max absolute change for bar scaling
  const maxAbsChange = useMemo(() => {
    return Math.max(...sectors.map(s => Math.abs(s.avgChange)), 1)
  }, [sectors])

  // Lifecycle legend filter for grid rows
  const [stageFilter, setStageFilter] = useState(null)

  // Sort state for performance grid
  const [sortKey, setSortKey] = useState('change')
  const [sortDir, setSortDir] = useState('desc')

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  // Row matches the current Performance filter? Same rule the row render uses,
  // lifted so sortedSectors can promote matches to the top of the list.
  const matchesPerformanceFilter = useCallback((s) => {
    if (stageFilter == null) return true
    const changeBucket = s.avgChange >= 1 ? 'green' : s.avgChange <= -1 ? 'red' : 'yellow'
    return s.color === stageFilter || changeBucket === stageFilter
  }, [stageFilter])

  const sortedSectors = useMemo(() => {
    const base = sortKey
      ? [...sectors].sort((a, b) => {
          const dir = sortDir === 'desc' ? -1 : 1
          if (sortKey === 'change') return dir * ((a.avgChange || 0) - (b.avgChange || 0))
          if (sortKey === 'volume') return dir * ((a.totalVolume || 0) - (b.totalVolume || 0))
          if (sortKey === 'lifecycle') return dir * ((STAGE_ORDER[a.stageLabel] ?? 2) - (STAGE_ORDER[b.stageLabel] ?? 2))
          return 0
        })
      : sectors
    // When a Performance filter is active, bubble matching rows to the top
    // (preserving the within-group sort order) so the user doesn't have to
    // scroll past dimmed rows to find their selection.
    if (stageFilter == null) return base
    const matches = []
    const rest = []
    for (const s of base) {
      if (matchesPerformanceFilter(s)) matches.push(s)
      else rest.push(s)
    }
    return [...matches, ...rest]
  }, [sectors, sortKey, sortDir, stageFilter, matchesPerformanceFilter])

  const visibleSectors = useMemo(() => {
    if (showAll) return sortedSectors
    return sortedSectors.slice(0, INITIAL_VISIBLE)
  }, [sortedSectors, showAll])

  const handleSectorClick = (sector) => {
    if (!sector.topMover) return
    const symbol = sector.topMover
    const m = sector.topMoverData
    const data = topCoinPrices?.[symbol] || topCoinPrices?.[symbol?.toUpperCase?.()] || {}
    const tokenData = {
      symbol,
      name: m?.name || data.name || symbol,
      price: m?.price || data.price || 0,
      change: m?.change_24h ?? data.change ?? sector.avgChange ?? 0,
      logo: m?.logo || TOKEN_LOGOS[symbol],
      token_id: m?.token_id || null,
      cgId: m?.token_id || null,
      address: m?.address || null,
      networkId: m?.network_id || m?.networkId || null,
    }
    // If CoinGecko knows the token (token_id present) OR it's a hardcoded major,
    // Research Zone can render it reliably. Fall back to AI Screener only for
    // pure on-chain movers with no CG listing at all.
    const hasCgId = !!m?.token_id
    const isMajor = isMajorToken((symbol || '').toUpperCase())
    if (hasCgId || isMajor) {
      if (onOpenResearchZone) return onOpenResearchZone(tokenData)
    }
    if (onOpenAIScreener) return onOpenAIScreener(tokenData)
    if (onOpenResearchZone) onOpenResearchZone(tokenData)
  }

  // ROTATION LANES — what the quadrant bubble map was trying to say, said in
  // words. The bubble field drew 24 gold circles with 3-letter codes and
  // colliding chips; the founder read it as noise (08-18). Same classification,
  // same median-volume split, rendered as four named lanes you can actually
  // read: momentum sign on one axis, volume against the median on the other.
  const rotationLanes = useMemo(() => {
    if (sectors.length === 0) return []
    const vols = sectors.map(s => s.totalVolume || 0).sort((a, b) => a - b)
    const medianVol = vols.length ? vols[Math.floor(vols.length / 2)] : 0
    const buckets = { leaders: [], emerging: [], fading: [], lagging: [] }
    for (const s of sectors) {
      const up = (s.avgChange || 0) >= 0
      const heavy = (s.totalVolume || 0) >= medianVol
      buckets[up && heavy ? 'leaders' : up ? 'emerging' : heavy ? 'fading' : 'lagging'].push(s)
    }
    return ROTATION_LANES.map((lane) => ({
      ...lane,
      // Strongest move first in the two up lanes, weakest first in the two down
      // lanes — each lane leads with the sector that most defines it.
      items: buckets[lane.id].sort((a, b) => (lane.up ? (b.avgChange || 0) - (a.avgChange || 0) : (a.avgChange || 0) - (b.avgChange || 0))),
    }))
  }, [sectors])

  const laneMaxVol = useMemo(
    () => Math.max(...sectors.map(s => s.totalVolume || 0), 1),
    [sectors]
  )

  // AI analysis — prefer API data, fall back to rule-based derivation
  const analysis = useMemo(() => {
    // Use API-provided AI analysis when available
    if (sectorAiAnalysis) {
      const ctx = sectorAiAnalysis.market_context
      return {
        rotationText: sanitizeAiText(sectorAiAnalysis['AI Analysis'] || ''),
        volConcentration: sanitizeAiText(sectorAiAnalysis['Volume Flow'] || ''),
        dispersionText: sanitizeAiText(sectorAiAnalysis['Sector Dispersion'] || ''),
        positioning: sanitizeAiText(sectorAiAnalysis['Positioning'] || ''),
        marketContext: ctx || null,
      }
    }

    // Fallback: derive from sector data when API unavailable
    if (sectors.length === 0) return null

    const advancing = sectors.filter(s => s.avgChange > 0)
    const declining = sectors.filter(s => s.avgChange < 0)
    const strongSectors = sectors.filter(s => s.performance === 'strong' || s.performance === 'very_strong')
    const totalVol = sectors.reduce((sum, s) => sum + (s.totalVolume || 0), 0)
    const avgChange = sectors.reduce((sum, s) => sum + s.avgChange, 0) / sectors.length
    const sorted = [...sectors].sort((a, b) => b.avgChange - a.avgChange)
    const topSector = sorted[0]
    const worstSector = sorted[sorted.length - 1]
    const volLeader = [...sectors].sort((a, b) => (b.totalVolume || 0) - (a.totalVolume || 0))[0]

    // Capital rotation direction
    let rotationText = ''
    const growthStrong = sectors.filter(s => s.lifecycle === 'growth' && s.color === 'green')
    const matureWeak = sectors.filter(s => s.lifecycle === 'mature' && s.color === 'red')

    if (growthStrong.length >= 3) {
      rotationText = `Smart money rotating into growth-phase narratives. ${growthStrong.slice(0, 3).map(s => s.name).join(', ')} showing strength - characteristic of early-stage capital deployment before mainstream awareness.`
    } else if (matureWeak.length >= 2) {
      rotationText = `Mature sectors showing weakness. ${matureWeak.slice(0, 2).map(s => s.name).join(' and ')} underperforming - typical of distribution phases where early participants exit into retail demand.`
    } else if (strongSectors.length > sectors.length * 0.6) {
      rotationText = `Broad-based strength across ${strongSectors.length} sectors. Risk appetite is elevated with capital flowing into both established and growth narratives simultaneously.`
    } else {
      rotationText = `Capital rotating selectively across narratives. ${advancing.length}/${sectors.length} sectors advancing — monitor for emerging leaders as the market establishes directional bias.`
    }

    // Volume concentration
    const volConcentration = volLeader && totalVol > 0
      ? `${volLeader.name} captures ${((volLeader.totalVolume / totalVol) * 100).toFixed(0)}% of total sector volume ($${(totalVol / 1e9).toFixed(1)}B), indicating concentrated market attention.`
      : ''

    // Spread analysis
    const spread = topSector && worstSector
      ? Math.abs(topSector.avgChange - worstSector.avgChange).toFixed(1)
      : '0'
    let dispersionText = ''
    if (parseFloat(spread) > 10) {
      dispersionText = `High sector dispersion (${spread}% spread between ${topSector.name} and ${worstSector.name}). Divergence of this magnitude signals strong narrative conviction - sector selection matters more than broad market exposure.`
    } else if (parseFloat(spread) > 5) {
      dispersionText = `Moderate sector dispersion (${spread}% spread). ${topSector.name} leading while ${worstSector.name} underperforms. Focus on relative strength over absolute direction.`
    } else {
      dispersionText = `Low sector dispersion (${spread}% spread). Sectors moving in tandem, suggesting macro-driven price action over narrative-driven rotation.`
    }

    // Actionable positioning
    let positioning = ''
    if (avgChange > 3) {
      positioning = `${advancing.length}/${sectors.length} sectors advancing. Risk-on conditions favor exposure to growth-lifecycle sectors with volume confirmation. Watch for momentum traps in mature narratives showing volume without follow-through.`
    } else if (avgChange > 0) {
      positioning = `${advancing.length}/${sectors.length} sectors positive but conviction is mixed. Favor sectors in growth-to-established lifecycle stages with above-average volume. Trim laggards showing declining momentum.`
    } else if (avgChange > -2) {
      positioning = `Only ${advancing.length}/${sectors.length} sectors green. Narrow breadth warrants reduced exposure. Prioritize capital preservation and monitor for breadth expansion before adding risk.`
    } else {
      positioning = `Broad weakness with ${declining.length}/${sectors.length} sectors declining. Defensive positioning warranted. Preserve capital and watch for capitulation volume as a potential reversal signal.`
    }

    return { rotationText, volConcentration, dispersionText, positioning }
  }, [sectors, sectorAiAnalysis])

  // Loading state — the attention feed carries the panel now, so only shimmer
  // when neither feed has anything to paint.
  if (sectorLoading && attentionLoading && sectors.length === 0 && narratives.length === 0) {
    return (
      <div className="sec">
        <div className="sec-loading">
          <div className="sec-loading-bar animate-shimmer" />
          <div className="sec-loading-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`sec-loading-row animate-shimmer stagger-${(i % 5) + 1}`} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (sectors.length === 0 && narratives.length === 0) return null

  return (
    <div className="sec">
      {/* Tab rail — the chart is the first tab, the crowd is the second. */}
      <div className={`sec-signal bias-${rotationSignal.bias}`}>
        <div className="sec-signal-left">
          <div className="sec-tabs" role="tablist" aria-label={t('sectorsTab.sectorViews', 'Sector views')}>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'performance'}
              className={`sec-tab ui-glass${view === 'performance' ? ' is-active' : ''}`}
              onClick={() => { setView('performance'); trackUi('sectors_view', 'performance') }}
            >
              {t('sectorsTab.performance', 'Performance')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'attention'}
              className={`sec-tab ui-glass${view === 'attention' ? ' is-active' : ''}`}
              onClick={() => { setView('attention'); trackUi('sectors_view', 'attention') }}
            >
              {t('sectorsTab.attention', 'Attention')}
              {attentionSummary?.topLabel && <em className="sec-tab-hint">{attentionSummary.topLabel}</em>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'compare'}
              className={`sec-tab ui-glass${view === 'compare' ? ' is-active' : ''}`}
              onClick={() => { setView('compare'); trackUi('sectors_view', 'compare') }}
            >
              {t('sectorsTab.compare', 'Compare')}
            </button>
          </div>
        </div>
        <div className="sec-signal-right">
          {view === 'compare' ? (
            <span className="sec-signal-regime">
              {t('sectorsTab.compareHint', 'Up to 5 chains, sectors or tokens')}
            </span>
          ) : view === 'performance' ? (
            <>
              <span className="sec-signal-dot" />
              <span className="sec-signal-regime">{rotationSignal.label}</span>
              <span className="sec-signal-sep" />
              <span className="sec-signal-breadth-label">{t('sectorsTab.breadth', 'Breadth')}</span>
              <div className="sec-signal-bar">
                <div className="sec-signal-bar-fill" style={{ width: `${rotationSignal.breadth}%` }} />
              </div>
              <span className="sec-signal-breadth-value">{rotationSignal.breadth}%</span>
            </>
          ) : (
            attentionSummary && (
              <span className="sec-signal-regime">
                {fmtCount(attentionSummary.totalMentions)}{' '}
                {attentionWindow === '7d'
                  ? t('sectorsTab.mentions7d', 'mentions · 7d')
                  : t('sectorsTab.mentions24h', 'mentions · 24h')}
              </span>
            )
          )}
        </div>
      </div>

      {/* ATTENTION — the crowd view. Every narrative opens onto its names. */}
      {view === 'attention' && (
        <SecAttention
          compact
          narratives={narratives}
          summary={attentionSummary}
          loading={attentionLoading}
          feedWindow={attentionWindow}
          onOpen={(n) => trackUi('sectors_narrative', n?.id || '')}
          onOpenToken={openNarrativeToken}
        />
      )}

      {/* COMPARE — the AI Charts board, same component, embedded compact. */}
      {view === 'compare' && (
        <div className="sec-compare-wrap">
          <Suspense fallback={<div className="sec-chart-loading animate-shimmer" />}>
            <CompareChart dayMode={dayMode} compact />
          </Suspense>
        </div>
      )}

      {/* Sector Performance Chart — first thing in the first tab. */}
      {view === 'performance' && (
        <div className="sec-chart-wrap">
          <Suspense fallback={<div className="sec-chart-loading animate-shimmer" />}>
            <SectorCompareChart dayMode={dayMode} compact />
          </Suspense>
        </div>
      )}

      {view === 'performance' && <>
      {/* Rotation board — four lanes, real sector names, no code golf. */}
      <div className="sec-rot">
        <div className="sec-rot-head">
          <span className="sec-rot-title">{t('sectorsTab.rotation', 'Rotation')}</span>
          <span className="sec-rot-note">{t('sectorsTab.rotationNote', 'Momentum against 24h volume, split at the median')}</span>
        </div>
        <div className="sec-rot-lanes">
          {rotationLanes.map((lane) => (
            <div key={lane.id} className={`sec-rot-lane lane-${lane.id}`}>
              <div className="sec-rot-lane-head">
                <span className="sec-rot-lane-dot" />
                <span className="sec-rot-lane-name">{t(`sectorsTab.${lane.id}`, lane.label)}</span>
                <span className="sec-rot-lane-count">{lane.items.length}</span>
                <span className="sec-rot-lane-meaning">{lane.meaning}</span>
              </div>
              {lane.items.length === 0 ? (
                <div className="sec-rot-empty">{t('sectorsTab.laneEmpty', 'Nothing here right now')}</div>
              ) : (
                <div className="sec-rot-rows">
                  {lane.items.slice(0, LANE_ROWS).map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className="sec-rot-row"
                      onClick={() => openCategoryPage(s)}
                      title={`${s.name} — ${(s.avgChange || 0) >= 0 ? '+' : ''}${(s.avgChange || 0).toFixed(1)}% — ${fmtVolume(s.totalVolume)}`}
                    >
                      <span className="sec-rot-row-name">{s.name}</span>
                      <span className="sec-rot-row-vol">
                        <span className="sec-rot-row-vol-bar" style={{ width: `${Math.max(4, Math.round(((s.totalVolume || 0) / laneMaxVol) * 100))}%` }} />
                      </span>
                      <span className="sec-rot-row-volnum">{fmtVolume(s.totalVolume)}</span>
                      <span className={`sec-rot-row-chg ${(s.avgChange || 0) >= 0 ? 'pos' : 'neg'}`}>
                        {(s.avgChange || 0) >= 0 ? '+' : ''}{(s.avgChange || 0).toFixed(1)}%
                      </span>
                    </button>
                  ))}
                  {lane.items.length > LANE_ROWS && (
                    <span className="sec-rot-more">
                      {t('sectorsTab.laneMore', '+{{count}} more below', { count: lane.items.length - LANE_ROWS })}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Sector Performance Grid */}
      <div className="sec-grid">
        <div className="sec-grid-header">
          <span className="sec-grid-col sec-col-name">{t('sectorsTab.sector', 'Sector')}</span>
          <span
            className={`sec-grid-col sec-col-change sortable${sortKey === 'change' ? ' sort-active' : ''}`}
            onClick={() => handleSort('change')}
          >
            {t('sectorsTab.change24h', '24h')}
            {sortKey === 'change' && <span className="sec-grid-sort-arrow">{sortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>}
          </span>
          <span className="sec-grid-col sec-col-bar">{t('sectorsTab.performance', 'Performance')}</span>
          <span
            className={`sec-grid-col sec-col-vol sortable${sortKey === 'volume' ? ' sort-active' : ''}`}
            onClick={() => handleSort('volume')}
          >
            {t('sectorsTab.volume', 'Volume')}
            {sortKey === 'volume' && <span className="sec-grid-sort-arrow">{sortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>}
          </span>
          <span
            className={`sec-grid-col sec-col-stage sortable${sortKey === 'lifecycle' ? ' sort-active' : ''}`}
            onClick={() => handleSort('lifecycle')}
          >
            {t('sectorsTab.lifecycle', 'Lifecycle')}
            {sortKey === 'lifecycle' && <span className="sec-grid-sort-arrow">{sortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>}
          </span>
        </div>
        {visibleSectors.map((s) => {
          const barWidth = Math.abs(s.avgChange) / maxAbsChange * 100
          const isPositive = s.avgChange >= 0
          // Reuse the same matcher that sortedSectors promotes by, so row
          // styling and row order stay in sync (matches stay highlighted as
          // they bubble to the top).
          const matchesFilter = matchesPerformanceFilter(s)
          return (
            <div
              key={s.id}
              className={`sec-grid-row${stageFilter && !matchesFilter ? ' dimmed' : ''}${stageFilter && matchesFilter ? ' highlighted' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => openCategoryPage(s)}
            >
              <span className="sec-grid-name">
                {/* No lifecycle dot: on the live data path `color` is just the
                    |change| bucket, so the dot restated the % beside it in a
                    third colour language. */}
                <span className="sec-grid-name-text">{s.name}</span>
              </span>
              <span className={`sec-grid-change ${isPositive ? 'pos' : 'neg'}`}>
                {isPositive ? '+' : ''}{s.avgChange.toFixed(1)}%
              </span>
              <span className="sec-grid-bar-cell">
                <div className="sec-grid-bar-track">
                  {isPositive ? (
                    <div
                      className="sec-grid-bar-fill pos"
                      style={{ width: `${barWidth}%`, marginLeft: '50%' }}
                    />
                  ) : (
                    <div
                      className="sec-grid-bar-fill neg"
                      style={{ width: `${barWidth}%`, marginLeft: `${50 - barWidth}%` }}
                    />
                  )}
                  <div className="sec-grid-bar-zero" />
                </div>
              </span>
              <span className="sec-grid-vol">{fmtVolume(s.totalVolume)}</span>
              <span className={`sec-grid-stage stage-${s.color}`}>{s.stageLabel}</span>
            </div>
          )
        })}

        {/* Show more / less toggle */}
        {sortedSectors.length > INITIAL_VISIBLE && (
          <div className="sec-grid-toggle" onClick={() => setShowAll(v => !v)}>
            <span>{showAll ? t('sectorsTab.showLess', 'Show less') : t('sectorsTab.showAllSectors', 'Show all {{count}} sectors', { count: sortedSectors.length })}</span>
          </div>
        )}
      </div>

      {/* Lifecycle Legend */}
      <div className="sec-legend">
        <span className="sec-legend-label">{t('sectorsTab.performance', 'Performance')}</span>
        <div className="sec-legend-items">
          <div className={`sec-legend-all clickable${stageFilter === null ? ' active' : ''}`} onClick={() => setStageFilter(null)}>
            <span>{t('common.all', 'All')}</span>
          </div>
          <div className={`sec-legend-item clickable${stageFilter === 'green' ? ' active' : ''}`} onClick={() => setStageFilter(f => f === 'green' ? null : 'green')}>
            <span className="sec-legend-dot stage-green" />
            <span className="sec-legend-stage">{t('sectorsTab.strong', 'Strong')}</span>
            <span className="sec-legend-sep" />
            <span className="sec-legend-desc">{t('sectorsTab.strongDesc', 'Outperforming, momentum building')}</span>
          </div>
          <div className={`sec-legend-item clickable${stageFilter === 'yellow' ? ' active' : ''}`} onClick={() => setStageFilter(f => f === 'yellow' ? null : 'yellow')}>
            <span className="sec-legend-dot stage-yellow" />
            <span className="sec-legend-stage">{t('sectorsTab.neutral', 'Neutral')}</span>
            <span className="sec-legend-sep" />
            <span className="sec-legend-desc">{t('sectorsTab.neutralDesc', 'Flat or moderate movement')}</span>
          </div>
          <div className={`sec-legend-item clickable${stageFilter === 'red' ? ' active' : ''}`} onClick={() => setStageFilter(f => f === 'red' ? null : 'red')}>
            <span className="sec-legend-dot stage-red" />
            <span className="sec-legend-stage">{t('sectorsTab.weak', 'Weak')}</span>
            <span className="sec-legend-sep" />
            <span className="sec-legend-desc">{t('sectorsTab.weakDesc', 'Underperforming, declining momentum')}</span>
          </div>
        </div>
      </div>

      {/* Top Movers — sectors with top mover token data from API */}
      {sectors.some(s => s.topMoverData) && (
        <div className="sec-movers">
          <div className="sec-movers-title">{t('sectorsTab.topMoversBySector', 'Top Movers by Sector')}</div>
          <div className="sec-movers-grid">
            {sectors.filter(s => s.topMoverData).slice(0, 20).map((s) => {
              const m = s.topMoverData
              const mChange = m.change_24h ?? 0
              const mPositive = mChange >= 0
              return (
                <div key={s.id} className="sec-mover-chip" onClick={() => handleSectorClick(s)}>
                  {m.logo && <img src={m.logo} alt="" loading="lazy" decoding="async" width="18" height="18" className="sec-mover-logo" />}
                  <div className="sec-mover-info">
                    <span className="sec-mover-symbol">{m.ticker}</span>
                    <span className="sec-mover-name">{m.name}</span>
                  </div>
                  <div className="sec-mover-stats">
                    <span className={`sec-mover-change ${mPositive ? 'pos' : 'neg'}`}>
                      {mPositive ? '+' : ''}{mChange.toFixed(1)}%
                    </span>
                    <span className="sec-mover-sector">{s.name}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* AI Analysis */}
      {analysis && (
        <div className={`sec-analysis bias-${rotationSignal.bias}`}>
          <div className="sec-analysis-glow" />
          <div className="sec-analysis-header">
            <div className="sec-analysis-header-left">
              <span className="sec-analysis-pulse" />
              <span className="sec-analysis-title">{t('sectorsTab.aiAnalysis', 'AI Analysis')}</span>
            </div>
            <span className="sec-analysis-badge">{t('homePage.sectorsTabPanel.sectorstabpanel.spectreAi', "Spectre AI")}</span>
          </div>
          <p className="sec-analysis-text">{analysis.rotationText}</p>

          <div className="sec-analysis-cards">
            {analysis.volConcentration && (
              <div className="sec-analysis-card">
                <div className="sec-analysis-card-content">
                  <div className="sec-analysis-card-title">{t('sectorsTab.volumeFlow', 'Volume Flow')}</div>
                  <p className="sec-analysis-card-text">{analysis.volConcentration}</p>
                </div>
              </div>
            )}

            <div className="sec-analysis-card">
              <div className="sec-analysis-card-content">
                <div className="sec-analysis-card-title">{t('sectorsTab.sectorDispersion', 'Sector Dispersion')}</div>
                <p className="sec-analysis-card-text">{analysis.dispersionText}</p>
              </div>
            </div>

            <div className="sec-analysis-card">
              <div className="sec-analysis-card-content">
                <div className="sec-analysis-card-title">{t('sectorsTab.positioning', 'Positioning')}</div>
                <p className="sec-analysis-card-text">{analysis.positioning}</p>
              </div>
            </div>
          </div>
        </div>
      )}
      </>}
    </div>
  )
}

export default memo(SectorsTabPanel)
