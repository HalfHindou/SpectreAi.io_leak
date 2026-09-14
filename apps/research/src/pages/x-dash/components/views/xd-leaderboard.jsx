/**
 * Leaderboard - the X Dash FRONT PAGE. Not a bare table - a composed
 * "attention terminal" that reads top -> bottom like a desk's morning brief:
 *
 *   (a) Market-read strip  - confident aggregate summary band
 *   (b) Attention map      - treemap, area = mention share, fill = Signal tier
 *   (c) The list, RECUT    - 6 synthesized columns (or the Map scatter)
 *   (d) Right rail         - Pulse (live tweets) / Narrative leaders / Emerging
 *
 * The bootstrap hook drives (a)(b)(c). The right rail fires three extra
 * fetches (token detail for Pulse, narratives, new-tokens) - all gated to
 * only run while this Leaderboard view is mounted (the shell lazy-mounts
 * views, so mounting === active).
 */
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useNavigate } from 'react-router-dom'
import { registerTokenSeeds } from '@/lib/xdash-token-seed'
import { canonicalChainKey, chainLabel, tokenMatchesChain, chainOptionsFromTokens } from '@/lib/chain-normalize'
import { useTranslation } from 'react-i18next'
import { useXDashBootstrap } from '@/hooks/useXDashBootstrap'
import { useXDashChainScan } from '@/hooks/useXDashChainScan'
import { useXDashSurface } from '@/hooks/useXDashSurface'
import { useXDashStaying } from '@/hooks/useXDashStaying'
import { useXDashThesis } from '@/hooks/useXDashThesis'
import { xdashUpdatingCopy } from '@/lib/xdash-health'
import XDTokenTable, { flattenSurfaceRow, liveMcap } from './xd-token-table'
import XDCockpit from './xd-cockpit'
import XDHeroStrip from '../xd-hero-strip'
import {
  Pagination, Shimmer, EmptyState, ErrorState, TokenCell, Num, Avatar,
  RankMove,
} from '../xd-bits'
// Charts pull recharts + d3 (~70KB gz). Both are behind toggles (attention map
// open / list mode === 'map') and never render on the default table view, so
// lazy-load them to keep recharts/d3 off the X Dash first-paint critical path.
const XDLeaderboardMap = lazy(() => import('../xd-charts').then((m) => ({ default: m.XDLeaderboardMap })))
const XDAttentionTreemap = lazy(() => import('../xd-charts').then((m) => ({ default: m.XDAttentionTreemap })))
import {
  formatNum, narrativeHeat, formatMcapShort,
} from '../x-dash-utils'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import useSettingsStore from '@/store/useSettingsStore'

/* Multi-window rows (30d / all) come from the leaderboard-rollup endpoint,
   NOT the X Dash bootstrap. Map the rollup shape into the flat row model the
   shared table already renders, so every existing column lights up. The
   KOL-only fields (top_authors / quality / fresh) aren't carried by the
   rollup — the table degrades those to a muted "—" when windowMode==='rollup'.
   velocity/novelty/clean-signal are seeded from the rollup's averages so the
   Signal Score the table computes stays coherent with the endpoint's `signal`. */
function mapRollupRow(row) {
  if (!row) return row
  return {
    ...row,
    cg_id: row.asset,
    token_id: row.asset,
    cashtag: row.symbol ? `$${row.symbol}` : undefined,
    image: row.image_small || row.image_url || row.image,
    rank_position: row.rank,
    rank_direction: 'flat',
    external_mentions_24h: row.mentions,
    unique_external_authors_24h: row.authors,
    author_count: row.authors,
    external_weighted_engagement_24h: row.weighted,
    velocity_ratio: row.velocity_avg,
    novelty_ratio: row.novelty_avg,
    clean_signal_score_24h: row.signal_avg,
  }
}

/* the leaderboard table column badges + the per-window data label. */
const WINDOW_LABEL = { '24h': '24h', '7d': '7d', '30d': '30d', all: 'all' }

/* ---------- (d) Right rail: rank movers from bootstrap only ---------- */
function RailRankMovers({ tokens = [], loading = false, onOpenToken }) {
  const { t } = useTranslation()
  const movers = useMemo(() => {
    return (tokens || [])
      .filter((row) => row.rank_direction && row.rank_direction !== 'flat')
      .slice()
      .sort((a, b) => Math.abs(Number(b.rank_change_positions || 0)) - Math.abs(Number(a.rank_change_positions || 0)))
      .slice(0, 6)
  }, [tokens])

  return (
    <div className="xd-rail-card">
      <div className="xd-rail-card__head">
        <span className="xd-rail-card__title">{t('xDash.leaderboard.rail.rankMovers', 'Rank movers')}</span>
        {!loading && movers.length > 0 && (
          <span className="xd-rail-card__action xd-num">{movers.length}</span>
        )}
      </div>
      {loading ? (
        /* animated shimmer while bootstrap is in flight - no flash of empty
           rail card; matches the design-system "shimmer not spinner" rule */
        <div className="xd-rail-list">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="xd-rail-mover xd-rail-mover--shimmer">
              <div className="xd-shimmer-dot animate-shimmer" />
              <div className="xd-rail-mover__skeleton-text">
                <div className="xd-shimmer-bar xd-shimmer-bar--lg animate-shimmer" style={{ maxWidth: 90 }} />
                <div className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" style={{ marginTop: 4 }} />
              </div>
              <div className="xd-shimmer-bar xd-shimmer-bar--xs animate-shimmer" />
            </div>
          ))}
        </div>
      ) : movers.length === 0 ? (
        <div className="xd-rail-empty">{t('xDash.leaderboard.rail.noRankMovement', 'No rank movement in this window.')}</div>
      ) : (
        <div className="xd-rail-list">
          {movers.map((row) => {
            const token = {
              cg_id: row.cg_id || row.token_id,
              symbol: row.symbol,
              name: row.name,
              cashtag: row.cashtag,
              image_small: row.image_small || row.image,
              image_url: row.image_url,
              segment: row.segment,
            }
            const dir = String(row.rank_direction || 'flat').toLowerCase()
            const dirCls = dir === 'up' ? 'xd-rail-mover--up'
              : dir === 'down' ? 'xd-rail-mover--down'
              : 'xd-rail-mover--flat'
            return (
              <button
                type="button"
                className={`xd-rail-mover ${dirCls}`}
                key={token.cg_id}
                onClick={() => token.cg_id && onOpenToken(token.cg_id)}
              >
                <TokenCell token={token} compact />
                <span className="xd-rail-mover__metrics">
                  <span className="xd-rail-mover__rank">
                    <span className="xd-rail-mover__rank-pos xd-num">#{row.rank_position ?? '-'}</span>
                    <RankMove direction={row.rank_direction} delta={row.rank_change_positions} />
                  </span>
                  <span className="xd-rail-mover__sub xd-num">
                    {t('xDash.leaderboard.rail.mentions', '{{count}} mentions', { count: formatNum(row.external_mentions_24h) })}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ---------- (d) Right rail: Narrative leaders ---------- */
function RailNarratives({ params, onGoNarratives, onOpenToken }) {
  const { t } = useTranslation()
  const { data, loading } = useXDashSurface('/api/xdash/narratives', params)
  /* Rank by narrativeHeat — the same intensity metric the Narratives view
     uses. score_sum is breadth-biased (rewards many quiet tokens) and made
     this rail disagree with the page it links to. */
  const items = useMemo(() => {
    const list = data?.items || []
    return [...list].sort((a, b) => narrativeHeat(b) - narrativeHeat(a)).slice(0, 4)
  }, [data])

  return (
    <div className="xd-rail-card">
      <div className="xd-rail-card__head">
        <span className="xd-rail-card__title">{t('xDash.leaderboard.rail.narrativeLeaders', 'Narrative leaders')}</span>
        <button type="button" className="xd-rail-card__action" onClick={onGoNarratives}>
          {t('xDash.leaderboard.rail.all', 'All')}
        </button>
      </div>
      {loading && !data && (
        <div className="xd-rail-list">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="xd-shimmer-bar xd-shimmer-bar--block animate-shimmer" />
          ))}
        </div>
      )}
      {!loading && items.length === 0 && (
        <div className="xd-rail-empty">{t('xDash.leaderboard.rail.noNarrativeClusters', 'No narrative clusters this window.')}</div>
      )}
      {items.length > 0 && (
        <div className="xd-rail-list">
          {items.map((n) => {
            const leaders = Array.isArray(n.top_tokens) ? n.top_tokens.slice(0, 4) : []
            return (
              <button
                type="button"
                className="xd-rail-narr"
                key={n.id}
                onClick={onGoNarratives}
              >
                <div className="xd-rail-narr__text">
                  <span className="xd-rail-narr__label">{n.label}</span>
                  <span className="xd-rail-narr__score xd-num">
                    <b>{formatNum(n.mention_count, { maxFraction: 0 })}</b> {t('xDash.leaderboard.rail.mentionsShort', 'mentions')}
                    <span className="xd-rail-narr__dot" aria-hidden="true">·</span>
                    <b>{formatNum(n.token_count)}</b> {t('xDash.leaderboard.rail.tokens', 'tokens')}
                  </span>
                </div>
                <div className="xd-rail-narr__logos">
                  {leaders.map((entry, i) => {
                    const t = entry.token || entry
                    return (
                      <Avatar
                        key={t.cg_id || t.token_id || i}
                        src={t.image_small || t.image_url}
                        alt={t.symbol || t.name}
                        size={22}
                      />
                    )
                  })}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function XDLeaderboard({ controls, onOpenToken, onOpenAuthor, perPage, onPerPage, onChainsAvailable, onGoView, refinedDesign = false }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [tableToolsHost, setTableToolsHost] = useState(null)
  const [mode, setMode] = useState('table') // 'table' | 'map'
  /* Attention-map cell-size mode (persisted): 'rank' = size follows the active
     sort so the #1-ranked token is the biggest cell; 'attention' = always size
     by raw mention share (the classic attention map). */
  const [sizeMode, setSizeModeState] = useState(() => {
    try { return localStorage.getItem('spectre-xd-attn-size') === 'attention' ? 'attention' : 'rank' } catch { return 'rank' }
  })
  const setSizeMode = useCallback((m) => {
    setSizeModeState(m)
    try { localStorage.setItem('spectre-xd-attn-size', m) } catch { /* private mode */ }
  }, [])
  /* Attention-map heatmap collapse (persisted) - lets the user fold it away
     to get straight to the leaderboard list. */
  const attnOpen = useSettingsStore((s) => s.xdAttentionMapOpen)
  const toggleAttn = useSettingsStore((s) => s.toggleXdAttentionMap)

  /* 30d / all-time aren't supported by the X Dash bootstrap source — those
     windows are served only by the multi-window leaderboard-rollup endpoint,
     which becomes the PRIMARY table source for them. 24h / 7d keep the
     existing bootstrap / majors source and just get Staying Power merged on. */
  const isRollupWindow = controls.timeframe === '30d' || controls.timeframe === 'all'

  /* The bootstrap surface is broken for segment=major / segment=context
     (returns 0 tokens regardless of params). For those segments we route
     the table + treemap to the dedicated /api/xdash/majors board which
     mirrors bootstrap's response shape. Hero pulse always reads from the
     all-segment bootstrap so universe stats are correct. */
  const isMajorBoard = controls.segment === 'major'

  /* 'custom' is a CLIENT-side band (controls.mcapBand) - the upstream only knows
     all/gt1m/gt10m/gt100m/gt1b, so send it 'all' and let the band filter below
     narrow the pool. Sending 'custom' verbatim returned an empty board. */
  const apiMarket = controls.market === 'custom' ? 'all' : controls.market

  const params = useMemo(() => ({
    page: controls.page,
    perPage,
    timeframe: controls.timeframe,
    ranking: controls.ranking,
    segment: controls.segment,
    market: apiMarket,
    minKols: 1,
  }), [controls.page, perPage, controls.timeframe, controls.ranking, controls.segment, controls.market])

  /* Hero pulse always wants the all-segment view so the universe / mention
     totals are real. Pin it to segment=all regardless of dropdown choice.
     perPage is 48 (not 20) to match the attention-treemap's wide pull: when
     segment==='all' the hero, treemap and (page-1) table all resolve to the
     SAME bootstrap params, so the shared useXDashBootstrap module cache serves
     one wide fetch instead of three. Hero consumers slice/aggregate this list
     internally (chips cap at 10-16), so the wider pull is free upside. */
  const heroParams = useMemo(() => ({
    page: 1,
    perPage: 48,
    timeframe: controls.timeframe,
    ranking: controls.ranking,
    segment: 'all',
    market: apiMarket,
    minKols: 1,
  }), [controls.timeframe, controls.ranking, controls.market])

  /* hero feed polls 60s + refetches on tab focus so the ticker stays live */
  const {
    data: heroData,
    loading: heroLoading,
    error: heroError,
    refetch: heroRefetch,
    health: heroHealth,
  } = useXDashBootstrap(
    heroParams,
    // persist: the wide page-1 fetch is the default board's first paint (the
    // table + treemap slice it) - the LS seed kills the cold-reload shimmer.
    { refreshIntervalMs: 60_000, refreshOnFocus: true, persist: true },
  )

  /* The table can reuse the hero's wide all-segment page-1 fetch for the
     common default state (segment==='all', page===1). In that case the hero
     params are a superset of the table params (same filters, page 1, just
     more rows) so we slice the hero data client-side and skip a duplicate
     bootstrap entirely. Any other state (filtered segment, page>1) keeps its
     own paginated fetch. */
  const tableSharesHero = !isMajorBoard
    && controls.segment === 'all'
    && controls.page === 1
    && perPage <= 48 // hero pulls only 48 rows; larger page sizes (50/100) must
                     // do their own wide fetch or the table caps at ~48 (bug)

  const bootstrapEnabled = !isMajorBoard && !tableSharesHero
  /* per_page > 50: the bootstrap endpoint SILENTLY caps per_page at 50 —
     requesting 100 returns per_page:50 (verified against the live upstream),
     so "100 rows" rendered only 50. Stitch two 50-row server pages per UI
     page instead: UI page p = server pages (2p-1) + (2p). page_count halves,
     and the whole 400+ token board stays reachable. */
  const uiPage = Number(controls.page || 1)
  const needStitch = bootstrapEnabled && perPage > 50
  const stitchParamsA = useMemo(() => ({ ...params, perPage: 50, page: uiPage * 2 - 1 }), [params, uiPage])
  const stitchParamsB = useMemo(() => ({ ...params, perPage: 50, page: uiPage * 2 }), [params, uiPage])
  /* When the table shares the hero fetch (or the majors board is active) the
     bootstrap hook still has to stay mounted, but it must NOT fetch a throwaway
     1-row board: that single row is what `bootstrap.data` briefly holds the
     instant the user bumps perPage past 48 and the table flips to its own
     source — flashing ONE token before the wide fetch lands. Keep the idle
     params byte-identical to `heroParams` (page 1, perPage 48, segment=all) so
     the module cache serves it from the hero's existing fetch (zero extra
     network) AND the fallback board is a real 48-row slice, not a lone token.
     The 48→50/100 transition then reads as a natural refresh, no glitch. */
  const bootstrap = useXDashBootstrap(
    bootstrapEnabled
      ? (needStitch ? stitchParamsA : params)
      : { ...params, segment: 'all', page: 1, perPage: 48 },
  )
  /* Second half of the stitched 100-row page. When stitching is off this
     idles on the hero-identical params (served from the module cache, zero
     extra network) exactly like the disabled main bootstrap above. */
  const bootstrapB = useXDashBootstrap(
    needStitch
      ? stitchParamsB
      : { ...params, segment: 'all', page: 1, perPage: 48 },
  )
  const stitchedBoard = useMemo(() => {
    if (!needStitch || !bootstrap.data) return null
    const a = bootstrap.data
    /* Only append B when its payload really is the requested second half —
       while B is still in flight the hook may hold the idle hero board
       (page 1), which would duplicate rows 1-48 under rows 1-50. */
    const bPag = bootstrapB.data?.pagination
    const bIsHalf = Number(bPag?.page) === uiPage * 2 && Number(bPag?.per_page) === 50
    const seen = new Set((a.tokens || []).map((r) => String(r.cg_id || r.token_id || '').toLowerCase()))
    const bTokens = bIsHalf
      ? (bootstrapB.data.tokens || []).filter((r) => !seen.has(String(r.cg_id || r.token_id || '').toLowerCase()))
      : []
    return {
      ...a,
      tokens: [...(a.tokens || []), ...bTokens],
      pagination: {
        page: uiPage,
        page_count: Math.max(1, Math.ceil(Number(a.pagination?.page_count || 1) / 2)),
        filtered_count: a.pagination?.filtered_count,
        per_page: perPage,
      },
    }
  }, [needStitch, bootstrap.data, bootstrapB.data, uiPage, perPage])

  /* dedicated majors board - 73 majors, 4 pages by default */
  const majorsBoardParams = useMemo(() => ({
    page: controls.page,
    perPage,
    timeframe: controls.timeframe,
    ranking: controls.ranking,
    market: apiMarket,
  }), [controls.page, perPage, controls.timeframe, controls.ranking, controls.market])

  const {
    data: majorsBoard,
    loading: majorsBoardLoading,
    error: majorsBoardError,
    refetch: majorsBoardRefetch,
  } = useXDashSurface(
    '/api/xdash/majors',
    majorsBoardParams,
    { enabled: isMajorBoard, ttlMs: 60_000 },
  )

  /* When the table shares the hero's wide fetch, derive its board from the
     hero data: slice the wide token list to the table's perPage and synthesize
     the pagination envelope so <Pagination> / the count chip still behave. */
  const sharedHeroBoard = useMemo(() => {
    if (!tableSharesHero || !heroData) return null
    const allTokens = heroData.tokens || []
    const total = allTokens.length
    return {
      ...heroData,
      tokens: allTokens.slice(0, perPage),
      pagination: {
        page: 1,
        page_count: Math.max(1, Math.ceil(total / perPage)),
        filtered_count: heroData.pagination?.filtered_count ?? total,
        per_page: perPage,
      },
    }
  }, [tableSharesHero, heroData, perPage])

  const activeBoard = isMajorBoard
    ? majorsBoard
    : (tableSharesHero ? sharedHeroBoard : (needStitch ? stitchedBoard : bootstrap.data))
  /* Foreground-only loading. The bootstrap hooks raise `loading` ONLY for
     foreground fetches (first load + a filter change) — the 60s poll and the
     focus/visibility refreshes all pass background:true and never flip it. So
     this is safe to surface as a shimmer even over a stale board (see
     isLoading): a filter change otherwise left the OLD board frozen for ~2s
     with zero feedback, which read as "the MCAP/segment filter does nothing". */
  const loading = isMajorBoard
    ? majorsBoardLoading
    : (tableSharesHero ? heroLoading : bootstrap.loading)
  /* On the shared-hero path the hero fetch IS the table's data source, so its
     failure must surface (an API outage otherwise rendered a silent empty
     board). Only when nothing loaded - the hook keeps last-good data, and a
     failed background refresh must not blank a populated board. */
  const error = isMajorBoard
    ? majorsBoardError
    : (tableSharesHero ? (heroData ? null : heroError) : bootstrap.error)
  const refetch = isMajorBoard
    ? majorsBoardRefetch
    : (tableSharesHero ? heroRefetch : bootstrap.refetch)
  /* Same selection as `error`, for the failure that never raises one: the
     upstream answers 200 from a window it DID build and the board comes back
     empty. Only the bootstrap paths carry it — the majors surface is its own
     endpoint with its own window semantics. */
  const boardHealth = isMajorBoard
    ? null
    : (tableSharesHero ? heroHealth : bootstrap.health)
  /* Surface-style endpoints (/api/xdash/majors) return nested rows, while
     bootstrap normalises them. Flatten so the rest of the leaderboard sees
     one shape. */
  const data = useMemo(() => {
    if (!activeBoard) return null
    if (!isMajorBoard) return activeBoard
    return {
      ...activeBoard,
      tokens: (activeBoard.tokens || []).map((row) =>
        row && row.token ? flattenSurfaceRow(row) : row,
      ),
    }
  }, [activeBoard, isMajorBoard])

  /* right-rail surface params - share the command-bar timeframe but not the
     leaderboard's pagination. Kept stable so the rail doesn't refetch on
     every page change. */
  const railParams = useMemo(() => ({
    timeframe: controls.timeframe,
    perPage: 6,
  }), [controls.timeframe])

  /* the attention treemap shows the SHAPE of attention across a wide top
     slice - independent of the table's pagination. Always page 1, fixed
     wide pull, shares only the command-bar filters.
     NOTE: when segment==='all' these params are byte-identical to heroParams
     (same page/perPage/timeframe/ranking/segment/market/minKols, same key
     order), so the shared useXDashBootstrap module cache + INFLIGHT map serve
     this and the hero from ONE network fetch. */
  const treemapParams = useMemo(() => ({
    page: 1,
    perPage: 48,
    timeframe: controls.timeframe,
    ranking: controls.ranking,
    segment: controls.segment,
    market: apiMarket,
    minKols: 1,
  }), [controls.timeframe, controls.ranking, controls.segment, controls.market])

  const treemapBootstrap = useXDashBootstrap(
    isMajorBoard
      ? { ...treemapParams, segment: 'all', perPage: 1 }
      : treemapParams,
  )

  const treemapMajorsParams = useMemo(() => ({
    page: 1,
    perPage: 48,
    timeframe: controls.timeframe,
    ranking: controls.ranking,
    market: apiMarket,
  }), [controls.timeframe, controls.ranking, controls.market])

  const treemapMajors = useXDashSurface(
    '/api/xdash/majors',
    treemapMajorsParams,
    { enabled: isMajorBoard, ttlMs: 60_000 },
  )

  const treemapData = isMajorBoard ? treemapMajors.data : treemapBootstrap.data
  const treemapLoading = isMajorBoard ? treemapMajors.loading : treemapBootstrap.loading
  /* Rugged/collapsing names (live-mcap blowups from the Social Market Read).
     A rug must NEVER surface as a Top Mover / big attention tile / hot ticker
     just because its rank spiked on panic mentions - demote it from every
     "what's hot" surface (cockpit, attention map, in-play tiles, movers ticker).
     The table keeps it (awareness), these hype surfaces do not. */
  const { data: thesisData } = useXDashThesis('combined')
  const blownSet = useMemo(() => {
    const s = new Set()
    for (const b of (thesisData?.blowups || [])) {
      if (b?.symbol) s.add(String(b.symbol).toUpperCase().replace(/^\$/, ''))
      if (b?.cg_id) s.add(String(b.cg_id).toLowerCase())
    }
    return s
  }, [thesisData])
  const isBlown = useCallback((row) => {
    if (!row || !blownSet.size) return false
    const sym = String(row.symbol || row.cashtag || '').toUpperCase().replace(/^\$/, '')
    const cg = String(row.cg_id || row.token_id || '').toLowerCase()
    return (!!sym && blownSet.has(sym)) || (!!cg && blownSet.has(cg))
  }, [blownSet])

  const treemapTokens = useMemo(() => {
    const list = (treemapData?.tokens || []).filter((r) => !isBlown(r))
    return isMajorBoard
      ? list.map((row) => (row && row.token ? flattenSurfaceRow(row) : row))
      : list
  }, [treemapData, isMajorBoard, isBlown])

  /* Seed the drawer for EVERY token on the board the moment it loads, so the
     Signal Score + breakdown have a fallback no matter which surface opened
     them - the treemap tile and cockpit chip don't seed at their own click
     sites, and the per-token detail endpoint occasionally returns empty metrics
     (seen on $ZIG). Registering both the table board and the treemap board
     covers all the leaderboard surfaces in one place. */
  useEffect(() => { registerTokenSeeds(activeBoard?.tokens) }, [activeBoard])
  useEffect(() => { registerTokenSeeds(treemapData?.tokens) }, [treemapData])

  /* Chain filter (2026-05-21, normalized 2026-07-11). The X-Dash service
     doesn't accept a chain query param, so we filter client-side. Sources
     disagree on the chain STRING — bootstrap emits CG platform slugs
     (`binance-smart-chain`, `arbitrum-one`, `robinhood`), while the majors /
     rollup / Spectre-fallback rows emit short names (`bsc`, `arbitrum`). So we
     fold BOTH the row's chain and the selected key to ONE canonical key via
     `@/lib/chain-normalize` before comparing — that repairs the chains that
     never matched (BSC/ARB/OP/POLYGON when a source used the other form) and
     reaches the newer runner chains (Robinhood, XRP). The `platforms` map is a
     fallback only when the primary chain is missing. `chain=all` is a
     passthrough. */
  const filterTokensByChain = useCallback((list) => {
    if (!Array.isArray(list)) return []
    if (!controls.chain || controls.chain === 'all') return list
    const target = canonicalChainKey(controls.chain) || String(controls.chain).toLowerCase()
    return list.filter((t) => tokenMatchesChain(t, target))
  }, [controls.chain])

  /* Custom mcap band (market === 'custom'), client-side for the same reason as
     the chain filter: the upstream takes only open-ended floors, so a band like
     $10M-$50M has to be applied here. A row with no usable market cap is dropped
     while a band is active - a null can't be proven inside the range, and
     leaving it in would pad the board with unfilterable rows. */
  const mcapBand = controls.mcapBand || null
  const filterTokensByMcap = useCallback((list) => {
    if (!Array.isArray(list)) return []
    if (!mcapBand) return list
    const { min, max } = mcapBand
    return list.filter((t) => {
      /* liveMcap, not row.market_cap - the table renders the live value, so
         filtering on the frozen one contradicts the visible column. */
      const mc = Number(liveMcap(t))
      if (!Number.isFinite(mc) || mc <= 0) return false
      if (min != null && mc < min) return false
      if (max != null && mc > max) return false
      return true
    })
  }, [mcapBand])

  /* Both client-side filters in one pass, so the table, treemap, in-play tiles
     and rail all narrow to the same set. */
  const filterTokens = useCallback((list) => (
    filterTokensByMcap(filterTokensByChain(list))
  ), [filterTokensByChain, filterTokensByMcap])

  /* 30d / all rows: the multi-window leaderboard-rollup is the PRIMARY source.
     full rows (no `fields`) carry staying_power + trend already. */
  const rollupParams = useMemo(() => ({
    window: controls.timeframe,
    ranking: controls.ranking === 'momentum' ? 'staying' : controls.ranking,
    limit: 100,
  }), [controls.timeframe, controls.ranking])
  const {
    data: rollupData,
    loading: rollupLoading,
    error: rollupError,
    refetch: rollupRefetch,
  } = useXDashSurface('/api/xdash/leaderboard', rollupParams, { enabled: isRollupWindow, ttlMs: 120_000 })

  /* 24h / 7d: keep the existing source, fetch the compact staying map for the
     same window, merge staying_power + trend onto each row by cg_id/asset. */
  const { stayingMap } = useXDashStaying(controls.timeframe, { enabled: !isRollupWindow })

  const rollupRows = useMemo(() => {
    const rows = rollupData?.data?.rows
    if (!Array.isArray(rows)) return []
    return rows.map(mapRollupRow)
  }, [rollupData])

  /* rollup (30d/all) rows come from a separate source not covered by the
     activeBoard / treemap seed effects above - seed them too so removing the
     per-row setTokenSeed in XDTokenTable doesn't drop the drawer fallback. */
  useEffect(() => { registerTokenSeeds(rollupRows) }, [rollupRows])

  /* When a specific chain OR a custom mcap band is active on a live (24h/7d)
     window, the single paginated page only holds a few matching tokens. Stitch
     the full available board (see useXDashChainScan) and filter THAT so every
     match shows, then paginate the filtered set client-side. A $10M-$50M band
     would otherwise surface only the handful that happened to land on page 1. */
  const chainActive = !!(controls.chain && controls.chain !== 'all')
  const scanActive = chainActive || !!mcapBand
  const { rows: chainScanRows } = useXDashChainScan(params, { enabled: scanActive && !isRollupWindow })
  const chainScanFiltered = useMemo(() => (
    scanActive && !isRollupWindow && chainScanRows.length
      ? filterTokens(chainScanRows)
      : null
  ), [scanActive, isRollupWindow, chainScanRows, filterTokens])

  const bootstrapTokens = useMemo(() => filterTokens(data?.tokens || []), [data, filterTokens])

  /* Merge Staying Power onto the live (24h/7d) rows. Key on the lowercased
     cg_id/asset; fall back to symbol when the asset key doesn't match. */
  const mergedLiveTokens = useMemo(() => {
    if (!stayingMap || stayingMap.byAsset.size === 0) return bootstrapTokens
    return bootstrapTokens.map((row) => {
      const assetKey = String(row.cg_id || row.token_id || '').toLowerCase()
      const symKey = String(row.symbol || '').toLowerCase()
      const hit = stayingMap.byAsset.get(assetKey) || (symKey ? stayingMap.bySymbol.get(symKey) : null)
      if (!hit) return row
      return { ...row, staying_power: hit.staying_power, trend: hit.trend }
    })
  }, [bootstrapTokens, stayingMap])

  /* Live + chain/band selected -> paginate the wide filtered pool client-side
     (page_count reflects the MATCHING token count, not the full board). */
  const tokens = isRollupWindow
    ? filterTokens(rollupRows)
    : (chainScanFiltered
      ? chainScanFiltered.slice((Number(controls.page || 1) - 1) * perPage, Number(controls.page || 1) * perPage)
      : mergedLiveTokens)
  const pagination = isRollupWindow
    ? {}
    : (chainScanFiltered
      /* filtered_count (not just total) - the "N tokens with signal" chip reads
         filtered_count, so without it a filtered board kept reporting the FULL
         board size (563 while showing 5 rows in a $10M-$50M band). */
      ? { page: Number(controls.page || 1), page_count: Math.max(1, Math.ceil(chainScanFiltered.length / perPage)), total: chainScanFiltered.length, filtered_count: chainScanFiltered.length, per_page: perPage }
      : (data?.pagination || {}))
  /* Live board: show the shimmer whenever a foreground fetch is in flight, even
     if a stale board is still on screen — that's the instant feedback a filter
     change needs. Rollup/majors keep the has-nothing guard (their surfaces can
     refresh in the background, where a shimmer over good data would flicker). */
  const isLoading = isRollupWindow
    ? (rollupLoading && rollupRows.length === 0)
    : isMajorBoard
      ? (loading && !data)
      : loading
  const windowLabel = WINDOW_LABEL[controls.timeframe] || controls.timeframe

  /* "In play" tiles share the treemap fetch (page=1, perPage=48, current
     filters). Take the top 8 - already segment / ranking / timeframe /
     market-aware so it matches whatever the user has selected. The chain
     filter, being client-side, runs AFTER the slice so a chain with sparse
     coverage still surfaces its own top-8 not a zero list. */
  /* Treemap/map + In-play tiles: when a chain is active, draw from the wide
     scan pool so the map isn't limited to the 48-row treemap window either. */
  const filteredTreemapTokens = useMemo(() => (
    chainScanFiltered || filterTokens(treemapTokens)
  ), [chainScanFiltered, treemapTokens, filterTokens])
  const inPlayTiles = useMemo(() => filteredTreemapTokens.slice(0, 8), [filteredTreemapTokens])

  /* Nothing to draw AND a reason it is not coming — as opposed to a map that
     is merely still loading, which keeps its shimmer. Declared here, after
     filteredTreemapTokens: it reads both. */
  const mapIsVoid = boardHealth?.state === 'updating' && filteredTreemapTokens.length === 0

  /* Report the chains ACTUALLY present in the (wide, pre-chain-filter) board up
     to the command bar so the chain dropdown is data-driven: the user only sees
     chains that have tokens this window — and always sees Robinhood/XRP when
     they do — instead of a static list where half the chains are empty. Uses
     treemapTokens (48 rows, segment/timeframe-aware) for good coverage. Guarded
     by a JSON key so we only push when the set actually changes. */
  const availableChains = useMemo(() => (
    chainOptionsFromTokens(chainScanRows.length ? chainScanRows : treemapTokens)
  ), [chainScanRows, treemapTokens])
  const onChainsAvailableRef = useRef(onChainsAvailable)
  onChainsAvailableRef.current = onChainsAvailable
  const availableChainsKey = useMemo(
    () => availableChains.map((c) => `${c.key}:${c.count}`).join(','),
    [availableChains],
  )
  useEffect(() => {
    if (availableChains.length) onChainsAvailableRef.current?.(availableChains)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableChainsKey])

  /* board-total mentions = denominator for attention-share %. */
  const boardTotal = useMemo(() => {
    let total = 0
    for (const row of tokens) {
      total += Number(row.external_mentions_24h || 0)
    }
    return total
  }, [tokens])

  /* Rollup windows (30d/all) read a different primary source - surface ITS
     failure there, with the same "nothing loaded" guard. */
  const feedError = isRollupWindow ? (rollupRows.length ? null : rollupError) : error
  const feedRetry = isRollupWindow ? rollupRefetch : refetch

  if (feedError) return <ErrorState message={feedError} onRetry={feedRetry} />

  // Blowups demoted from the "what's hot" surfaces (cockpit + hero movers).
  const cockpitTokens = tokens.filter((r) => !isBlown(r))
  const heroDataClean = heroData
    ? { ...heroData, tokens: (heroData.tokens || []).filter((r) => !isBlown(r)) }
    : heroData

  return (
    <div className="xd-leaderboard">
      {/* (0) COCKPIT - "what's moving now" headline row (5 focal cards). */}
      <XDCockpit
        tokens={cockpitTokens}
        loading={isLoading}
        onOpenToken={onOpenToken}
        onOpenAuthor={onOpenAuthor}
      />

      {/* (a) HERO STRIP - pulse stats + rich majors rail.
          Hero always reads the all-segment bootstrap so universe / mention
          totals are real even when the table is filtered to majors only. */}
      <XDHeroStrip
        data={heroDataClean}
        loading={heroLoading}
        inPlayTiles={inPlayTiles}
        inPlayLoading={treemapLoading && !treemapData}
        ranking={controls.ranking}
        timeframe={controls.timeframe}
        onOpenToken={onOpenToken}
        onOpenAuthor={onOpenAuthor}
      />

      {/* (b) ATTENTION MAP - welcome-heatmap visual pattern.
          Cell size = mention share. Color = rank movement (bull = climbed,
          bear = fell, intensity = how many ranks). Same semantic the
          welcome page heatmap uses for price change. */}
      {/* While the window is rebuilding there is nothing to map, and the map
          renders at a fixed 560px — a screen-tall empty void under a banner
          that has already explained the situation. Drop the section rather
          than reserve space for data that is not coming this window. */}
      {!mapIsVoid && (
      <div
        className={`xd-attention${attnOpen ? '' : ' xd-attention--collapsed'}`}
        data-tour="xd-attention"
      >
        <div className="xd-attention__head">
          <button
            type="button"
            className="xd-sec-toggle"
            onClick={toggleAttn}
            aria-expanded={attnOpen}
            title={attnOpen
              ? t('xDash.leaderboard.collapseMap', 'Hide attention map')
              : t('xDash.leaderboard.expandMap', 'Show attention map')}
          >
            <svg className="xd-sec-toggle__chev" viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="xd-attention__eyebrow">{t('xDash.leaderboard.attentionMap', 'Attention map')}</span>
          </button>
          {getMetricInfo('attentionMap') && <InfoTip text={getMetricInfo('attentionMap')} position="top" />}
          <span className="xd-attention__rule" aria-hidden="true" />
          {attnOpen && (
            <span className="xd-attention__legend">
              <span className="xd-attention__legend-item">
                <span className="xd-attention__legend-swatch xd-attention__legend-swatch--up" />
                {t('xDash.leaderboard.legend.climbed', 'climbed')}
              </span>
              <span className="xd-attention__legend-item">
                <span className="xd-attention__legend-swatch xd-attention__legend-swatch--down" />
                {t('xDash.leaderboard.legend.fell', 'fell')}
              </span>
              <span className="xd-attention__legend-hint">
                {sizeMode === 'attention' || controls.ranking === 'mentions'
                  ? t('xDash.leaderboard.legend.cellSize', 'larger = more attention')
                  : controls.ranking === 'momentum'
                    ? t('xDash.leaderboard.legend.cellSizeMomentum', 'larger = stronger momentum')
                    : controls.ranking === 'conviction'
                      ? t('xDash.leaderboard.legend.cellSizeConviction', 'larger = higher conviction')
                      : t('xDash.leaderboard.legend.cellSize', 'larger = more attention')}
              </span>
            </span>
          )}
          {attnOpen && (
            <div className="xd-toggle xd-attention__sizetoggle" role="group" aria-label={t('xDash.leaderboard.sizeMode', 'Map cell-size mode')}>
              <button
                type="button"
                className={`xd-toggle__btn${sizeMode === 'rank' ? ' xd-toggle__btn--active' : ''}`}
                onClick={() => setSizeMode('rank')}
                title={t('xDash.leaderboard.sizeRankTip', 'Size by the active sort — the #1 token is the biggest cell')}
              >
                {t('xDash.leaderboard.sizeRank', 'Rank')}
              </button>
              <button
                type="button"
                className={`xd-toggle__btn${sizeMode === 'attention' ? ' xd-toggle__btn--active' : ''}`}
                onClick={() => setSizeMode('attention')}
                title={t('xDash.leaderboard.sizeAttentionTip', 'Size by raw mentions — the most-talked-about token is the biggest cell')}
              >
                {t('xDash.leaderboard.sizeAttention', 'Attention')}
              </button>
            </div>
          )}
        </div>
        {attnOpen && (
          <Suspense fallback={<Shimmer variant="row" count={6} />}>
            <XDAttentionTreemap
              tokens={filteredTreemapTokens}
              loading={treemapLoading && !treemapData}
              onOpenToken={onOpenToken}
              ranking={controls.ranking}
              sizeMode={sizeMode}
              height={560}
            />
          </Suspense>
        )}
      </div>
      )}

      {/* MAIN: list + right rail */}
      <div className="xd-leaderboard__main">
        <div className="xd-leaderboard__list" data-tour="xd-table">
          <div className="xd-view-toolbar">
            <div className="xd-section-label" style={{ margin: 0 }}>{t('xDash.leaderboard.title', 'Leaderboard')}</div>
            <div className="xd-toggle" style={{ marginLeft: 'var(--sp-3)' }}>
              {[{ key: 'table', label: t('xDash.leaderboard.mode.table', 'Table') }, { key: 'map', label: t('xDash.leaderboard.mode.map', 'Map') }].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`xd-toggle__btn${mode === m.key ? ' xd-toggle__btn--active' : ''}`}
                  onClick={() => setMode(m.key)}
                  aria-pressed={mode === m.key}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="xd-view-toolbar__spacer" />
            <span className="xd-view-count">
              <Num value={isRollupWindow ? tokens.length : pagination.filtered_count} /> {t('xDash.leaderboard.tokensWithSignal', 'tokens with signal')}
            </span>
            {refinedDesign && mode === 'table' && <div className="xd-view-toolbar__tools" ref={setTableToolsHost} />}
          </div>

          {mode === 'map' ? (
            <Suspense fallback={<Shimmer variant="row" count={10} />}>
              <XDLeaderboardMap tokens={tokens} loading={isLoading} onOpenToken={onOpenToken} />
            </Suspense>
          ) : isLoading ? (
            <Shimmer variant="row" count={10} />
          ) : tokens.length === 0 && boardHealth?.state === 'updating' ? (
            /* An empty board from a window the upstream never built is not an
               empty result — naming the user's filters for it sends them off
               widening a market-cap floor that was never the problem. */
            <ErrorState detail={xdashUpdatingCopy(boardHealth, t)} onRetry={refetch} />
          ) : tokens.length === 0 ? (
            <EmptyState
              title={isRollupWindow
                ? t('xDash.leaderboard.empty.windowTitle', 'No durable tokens for this window yet')
                : t('xDash.leaderboard.empty.title', 'No tokens match these filters')}
              detail={isRollupWindow
                ? t('xDash.leaderboard.empty.windowDetail', 'The multi-window rollup is still building. Try 24H or 7D.')
                : mcapBand
                  /* Name the band back to the user - a silent empty board reads
                     as broken when it just means nothing sits in that range. */
                  ? `No tokens ${mcapBand.min != null && mcapBand.max != null
                      ? `between ${formatMcapShort(mcapBand.min)} and ${formatMcapShort(mcapBand.max)}`
                      : mcapBand.min != null
                        ? `above ${formatMcapShort(mcapBand.min)}`
                        : `below ${formatMcapShort(mcapBand.max)}`} market cap in this window. Widen the range or pick a preset.`
                  : (controls.chain && controls.chain !== 'all')
                  ? `No ${chainLabel(canonicalChainKey(controls.chain) || controls.chain)} tokens in this window. Try another chain or All chains.`
                  : controls.segment === 'context'
                    ? t('xDash.leaderboard.empty.contextDetail', 'Context-tier assets are re-indexing upstream. Try Majors or Opportunity.')
                    : t('xDash.leaderboard.empty.detail', 'Widen the market-cap floor or switch segment to all.')}
            />
          ) : (
            <>
              <XDTokenTable
                toolsTarget={refinedDesign ? tableToolsHost : null}
                rows={tokens}
                onOpenToken={onOpenToken}
                boardTotalMentions={boardTotal}
                windowMode={isRollupWindow ? 'rollup' : 'live'}
                windowLabel={windowLabel}
              />
              {!isRollupWindow && (
                <Pagination
                  page={pagination.page}
                  pageCount={pagination.page_count}
                  onPage={controls.setPage}
                  perPage={perPage}
                  onPerPage={onPerPage}
                />
              )}
            </>
          )}
        </div>

        {/* (d) RIGHT RAIL - desktop column, stacks under the list on mobile */}
        <aside className="xd-leaderboard__rail">
          <RailRankMovers tokens={tokens} loading={isLoading} onOpenToken={onOpenToken} />
          <RailNarratives
            params={railParams}
            /* land on the Narratives VIEW — plain navigate('/x-dash') dropped
               the user back on this same leaderboard */
            onGoNarratives={() => (onGoView ? onGoView('narratives') : navigate('/x-dash'))}
            onOpenToken={onOpenToken}
          />
        </aside>
      </div>
    </div>
  )
}
