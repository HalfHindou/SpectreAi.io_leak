/**
 * MomentumBoard — Categories leaderboard (Categories → Trending).
 *
 * LIVE DATA SOURCE
 *   GET /api/xdash/category-momentum?timeframe=24h&per_page=20  (default)
 *   GET /api/xdash/category-chatter?timeframe=24h&per_page=20   (when CHATTER mode)
 *
 *   This board ranks crypto SECTORS / CATEGORIES (Smart Contract Platform,
 *   Solana Ecosystem, Gaming (GameFi), etc.) by their social-attention
 *   score over the timeframe — mirroring X Dash's Categories tab. Each row
 *   is one category, NOT one token.
 *
 * RESPONSE SHAPE (per item)
 *   { id, label, category, score_sum, token_count, mention_count,
 *     author_count_sum, weighted_engagement, average_clean_signal,
 *     latest_mention_at, top_tokens: [{ symbol, image_small, image_url, ... }] }
 *
 * Click a row → drills in place using useXDashCategoryTokens, mirroring
 * the X Dash CategoryDrill pattern. The leaderboard chrome is preserved
 * when drill is null; drill view replaces it when set. Mode (chatter/
 * momentum) is propagated into the drill so token ranking matches the
 * leaderboard dimension.
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useXDashCategories } from '@/hooks/useXDashCategories'
import { useXDashCategoryTokens } from '@/hooks/useXDashCategoryTokens'
import { useAppState } from '@/contexts/AppStateContext'
import { relativeTime } from '@/pages/x-dash/components/x-dash-utils'
import { readXDashHealth, xdashUpdatingCopy, timeframeLabel } from '@/lib/xdash-health'
import './momentum-board.css'

const CATEGORY_PARAMS = {
  timeframe: '24h',
  perPage: '20',
  categoryScope: 'primary',
}

// Polling is gated by `enabled` (the Trending tab being active). When the
// board is off-tab we zero the interval + drop focus-refresh so no upstream
// xdash quota burns. The shared useXDashCategories cache still serves instantly
// when the tab is re-opened.
const HOOK_OPTIONS_ACTIVE = {
  refreshIntervalMs: 120000,
  refreshOnFocus: true,
}
const HOOK_OPTIONS_IDLE = {
  refreshIntervalMs: 0,
  refreshOnFocus: false,
}

/**
 * Compact format weighted-engagement: '6.4K', '1.7K', '877'.
 */
function formatWeighted(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

function fmtInt(n) {
  if (n == null || isNaN(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

/**
 * Format score_sum (a small-magnitude float like 1.173) as "1.173".
 * Categories with score > 100 (rare, chatter mode can produce higher) are
 * compacted via formatWeighted to avoid overflow.
 */
function formatScore(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 100) return formatWeighted(n)
  return n.toFixed(3)
}

/**
 * Derive the signal label from average_clean_signal (0..1).
 *   ≥ 0.76 → Breaking out
 *   ≥ 0.58 → Accelerating
 *   else   → Holding pace
 */
function deriveSignal(cleanSignal) {
  const v = Number(cleanSignal || 0)
  if (v >= 0.76) return 'Breaking out'
  if (v >= 0.58) return 'Accelerating'
  return 'Holding pace'
}

/**
 * Convert one API item into the render shape the table expects.
 */
function mapRow(item, index) {
  if (!item) return null
  const categoryId = item.id || item.category || ''
  const label = item.label || item.category || categoryId
  const score = Number(item.score_sum) || 0
  const tokenCount = Number(item.token_count) || 0
  const mentions = Number(item.mention_count) || 0
  const authors = Number(item.author_count_sum) || 0
  const weighted = Number(item.weighted_engagement) || 0
  const cleanSignal = Number(item.average_clean_signal) || 0
  const latest = item.latest_mention_at ? relativeTime(item.latest_mention_at) : '—'
  const topTokens = Array.isArray(item.top_tokens) ? item.top_tokens.slice(0, 4) : []

  return {
    rank: index + 1,
    categoryId,
    label,
    score,
    tokenCount,
    mentions,
    authors,
    weighted,
    weightedFmt: formatWeighted(weighted),
    cleanSignal,
    signal: deriveSignal(cleanSignal),
    latest,
    topTokens,
  }
}

/**
 * Extract a thumbnail URL out of a top_tokens entry. The API nests token
 * data under .token for some endpoints and flattens it for others.
 */
function thumbForTopToken(tt) {
  if (!tt) return ''
  const tok = tt.token || tt
  return tok.image_small || tok.image_url || tok.image || ''
}

function symbolForTopToken(tt) {
  if (!tt) return ''
  const tok = tt.token || tt
  return tok.symbol || tok.cashtag || tok.name || ''
}

/* ────────────────────────────────────────────────────────────────
   CategoryDrill — token table for one selected category.
   Mirrors the X Dash CategoryDrill pattern (xd-categories.jsx).
   ──────────────────────────────────────────────────────────────── */
function CategoryDrill({ category, mode, onBack }) {
  const navigate = useNavigate()
  const { selectToken } = useAppState()

  const params = useMemo(() => ({
    mode,
    timeframe: '24h',
    market: 'all',
    minKols: '1',
    categoryScope: 'primary',
    page: '1',
    perPage: '40',
  }), [mode])

  const { data, loading, error, refetch } = useXDashCategoryTokens(
    category.id || category.category,
    params,
  )
  const tokens = data?.tokens || data?.items || []
  const tokenCount = category.token_count ?? tokens.length

  const handleOpenToken = (entry) => {
    const t = entry.token || entry
    const cgId = t.cg_id || t.token_id
    selectToken({
      symbol: t.symbol,
      name: t.name,
      logo: t.image_small || t.image_url,
      cgId,
      tokenId: t.token_id,
      address: t.address,
    })
    navigate('/trade')
  }

  return (
    <div className="mb-drill">
      <div className="mb-drill__head">
        <button
          type="button"
          className="mb-drill__back"
          onClick={onBack}
          aria-label="Back to trending categories"
        >
          ← Trending
        </button>
        <div className="mb-drill__title">{category.label || category.category}</div>
        <div className="mb-drill__spacer" />
        <span className="mb-drill__count">{fmtInt(tokenCount)} tokens</span>
      </div>

      {loading && !data ? (
        <div className="mb-drill__table" role="table" aria-busy="true">
          <div className="mb-drill-row mb-drill-row--head" role="row">
            <span className="mb-drill-cell mb-drill-col-token">TOKEN</span>
            <span className="mb-drill-cell mb-drill-col-num">MENTIONS 24H</span>
            <span className="mb-drill-cell mb-drill-col-num">AUTHORS</span>
            <span className="mb-drill-cell mb-drill-col-num">ENGAGEMENT</span>
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`drill-skel-${i}`} className="mb-drill-row mb-drill-row--skel" role="row" aria-hidden="true">
              <span className="mb-drill-cell mb-drill-col-token" />
              <span className="mb-drill-cell mb-drill-col-num" />
              <span className="mb-drill-cell mb-drill-col-num" />
              <span className="mb-drill-cell mb-drill-col-num" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mb-drill__empty" role="alert">
          <div>Failed to load tokens for this category.</div>
          <button
            type="button"
            className="mb-full-btn"
            onClick={() => refetch({ bypassCache: true })}
          >
            RETRY
          </button>
        </div>
      ) : tokens.length === 0 ? (
        <div className="mb-drill__empty">No tokens resolved for this category.</div>
      ) : (
        <div className="mb-drill__table" role="table">
          <div className="mb-drill-row mb-drill-row--head" role="row">
            <span className="mb-drill-cell mb-drill-col-token">TOKEN</span>
            <span className="mb-drill-cell mb-drill-col-num">MENTIONS 24H</span>
            <span className="mb-drill-cell mb-drill-col-num">AUTHORS</span>
            <span className="mb-drill-cell mb-drill-col-num">ENGAGEMENT</span>
          </div>
          {tokens.map((entry, i) => {
            const t = entry.token || entry
            const m = entry.metrics || entry
            const cgId = t.cg_id || t.token_id || `idx-${i}`
            const img = t.image_small || t.image_url || ''
            const sym = (t.symbol || t.cashtag || t.name || '?').toString()
            const mentions = m.external_mentions_24h ?? m.mention_count
            const authors = m.unique_external_authors_24h ?? m.author_count
            const engagement = m.external_weighted_engagement_24h ?? m.weighted_engagement
            return (
              <div
                key={cgId}
                className="mb-drill-row"
                role="row"
                tabIndex={0}
                onClick={() => handleOpenToken(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleOpenToken(entry)
                  }
                }}
              >
                <span className="mb-drill-cell mb-drill-col-token">
                  <span className="mb-drill-logo">
                    {img ? (
                      <img
                        src={`/api/img-proxy?url=${encodeURIComponent(img)}`}
                        alt=""
                        loading="lazy"
                        onError={e => {
                          e.currentTarget.style.display = 'none'
                          const fb = e.currentTarget.nextSibling
                          if (fb) fb.style.display = 'inline-flex'
                        }}
                      />
                    ) : null}
                    <span
                      className="mb-drill-logo-fb"
                      style={{ display: img ? 'none' : 'inline-flex' }}
                    >
                      {(sym || '?')[0].toUpperCase()}
                    </span>
                  </span>
                  <span className="mb-drill-token-text">
                    <span className="mb-drill-token-sym">{sym.toUpperCase()}</span>
                    {t.name ? <span className="mb-drill-token-name">{t.name}</span> : null}
                  </span>
                </span>
                <span className="mb-drill-cell mb-drill-col-num">{fmtInt(mentions)}</span>
                <span className="mb-drill-cell mb-drill-col-num">{fmtInt(authors)}</span>
                <span className="mb-drill-cell mb-drill-col-num">{formatWeighted(engagement)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function MomentumBoard({ enabled = true }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState('momentum')
  const [drill, setDrill] = useState(null)

  // X Dash materialises ONE window at a time (7d since late Aug 2026) and
  // answers every other timeframe with 200 + zero rows, so a hard-coded 24h
  // ask painted "No trending categories" over a live 7d board. Ask for 24h
  // once; if that comes back empty and the payload names the window it is
  // actually serving, ask again for THAT window and label the board with it.
  // See .claude memory project_xdash_window_trap + lib/xdash-health.js.
  const [timeframe, setTimeframe] = useState(CATEGORY_PARAMS.timeframe)
  const followedLiveWindow = useRef(false)
  const params = useMemo(() => ({ ...CATEGORY_PARAMS, timeframe }), [timeframe])

  const { data, loading, error, refetch } = useXDashCategories(
    mode,
    params,
    enabled ? HOOK_OPTIONS_ACTIVE : HOOK_OPTIONS_IDLE,
  )

  const health = useMemo(
    () => readXDashHealth(data, timeframe, { errored: Boolean(error) && !data }),
    [data, timeframe, error],
  )

  useEffect(() => {
    if (loading || !data || followedLiveWindow.current) return
    if ((data.items || []).length > 0) return
    const live = health.liveTimeframe
    if (live && live !== timeframe) {
      followedLiveWindow.current = true
      setTimeframe(live)
    }
  }, [loading, data, health.liveTimeframe, timeframe])

  // The collector itself has stopped: zero tokens carry a mention in the
  // window the feed serves. That is a frozen store, not a quiet market, and
  // no timeframe will have rows until it restarts.
  const feedFrozen = Boolean(data?.totals) && Number(data.totals.tokens_with_mentions) === 0

  const rows = useMemo(() => {
    const items = data?.items || []
    return items
      .map((item, idx) => mapRow(item, idx))
      .filter(Boolean)
      .filter(r => r.label)
      .slice(0, 20)
  }, [data])

  const handleOpen = (r) => {
    if (!r?.label) return
    setDrill({
      id: r.categoryId,
      label: r.label,
      token_count: r.tokenCount,
    })
  }

  const isInitialLoading = loading && rows.length === 0
  const isErrorWithNoData = error && rows.length === 0
  const isEmpty = !loading && !error && rows.length === 0

  return (
    <section className="mb" aria-label="Momentum board">
      <header className="mb-head">
        <div className="mb-head-left">
          <span className="mb-eyebrow">CATEGORY LEADERBOARD</span>
          <h2 className="mb-title">{t('categoriesPageChrome.momentumBoard', 'Momentum Board')}</h2>
        </div>
        {!drill ? (
          <div className="mb-head-right">
            <div className="mb-mode-toggle" role="tablist" aria-label="Ranking mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'chatter'}
                className={`mb-mode-btn${mode === 'chatter' ? ' is-active' : ''}`}
                onClick={() => setMode('chatter')}
              >
                Chatter
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'momentum'}
                className={`mb-mode-btn${mode === 'momentum' ? ' is-active' : ''}`}
                onClick={() => setMode('momentum')}
              >
                Momentum
              </button>
            </div>
            {rows.length > 0 ? (
              <span className="mb-visible">
                {rows.length} categories
                {timeframe !== CATEGORY_PARAMS.timeframe ? ` · ${timeframeLabel(timeframe)} window` : ''}
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {drill ? (
        <CategoryDrill
          category={drill}
          mode={mode}
          onBack={() => setDrill(null)}
        />
      ) : isErrorWithNoData ? (
        <div
          className="mb-empty"
          style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}
          role="alert"
        >
          <div style={{ marginBottom: 12 }}>Trending board unavailable — please retry.</div>
          <button
            type="button"
            className="mb-full-btn"
            onClick={() => refetch({ bypassCache: true })}
          >
            RETRY
          </button>
        </div>
      ) : (
        <div className="mb-table mb-table--cat" role="table">
          <div className="mb-row mb-row--head mb-row--cat" role="row">
            <span className="mb-cell mb-col-rank">#</span>
            <span className="mb-cell mb-col-asset">CATEGORY</span>
            <span className="mb-cell mb-col-num mb-col-score">SCORE</span>
            <span className="mb-cell mb-col-num mb-col-tokens">TOKENS</span>
            <span className="mb-cell mb-col-num mb-col-mentions">MENTIONS</span>
            <span className="mb-cell mb-col-num mb-col-authors">AUTHORS</span>
            <span className="mb-cell mb-col-num mb-col-weighted">WEIGHTED</span>
            <span className="mb-cell mb-col-signal">SIGNAL</span>
            <span className="mb-cell mb-col-latest">LATEST</span>
          </div>

          {isInitialLoading ? (
            Array.from({ length: 12 }).map((_, i) => (
              <div key={`skel-${i}`} className="mb-row mb-row--cat mb-row--skel" role="row" aria-hidden="true">
                <span className="mb-cell mb-col-rank" />
                <span className="mb-cell mb-col-asset" />
                <span className="mb-cell mb-col-num mb-col-score" />
                <span className="mb-cell mb-col-num mb-col-tokens" />
                <span className="mb-cell mb-col-num mb-col-mentions" />
                <span className="mb-cell mb-col-num mb-col-authors" />
                <span className="mb-cell mb-col-num mb-col-weighted" />
                <span className="mb-cell mb-col-signal" />
                <span className="mb-cell mb-col-latest" />
              </div>
            ))
          ) : isEmpty ? (
            (feedFrozen || health.state === 'updating') ? (
              <div className="mb-empty mb-empty-state" role="status">
                <div className="mb-empty-state__title">{t('xDash.updating.title', 'X Dash is updating')}</div>
                <p className="mb-empty-state__copy">
                  {feedFrozen
                    ? t('xDash.updating.feedFrozen', 'The social feed has no mentions in the window it serves right now. That is the upstream collector, not the market - the board comes back on its own once it restarts.')
                    : xdashUpdatingCopy(health, t)}
                </p>
                <button
                  type="button"
                  className="mb-full-btn"
                  onClick={() => refetch({ bypassCache: true })}
                >
                  {t('xDash.updating.refresh', 'REFRESH')}
                </button>
              </div>
            ) : (
              <div className="mb-empty mb-empty-state">
                <p className="mb-empty-state__copy">
                  {t('categoriesPageChrome.noTrending', 'No trending categories right now.')}
                </p>
              </div>
            )
          ) : (
            rows.map(r => (
              <div
                key={`${r.rank}-${r.categoryId}`}
                className="mb-row mb-row--cat"
                role="row"
                data-signal={r.signal}
                onClick={() => handleOpen(r)}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(r) } }}
              >
                <span className="mb-cell mb-col-rank">
                  <span className="mb-rank">{String(r.rank).padStart(2, '0')}</span>
                </span>

                <span className="mb-cell mb-col-asset">
                  <span className="mb-asset-text">
                    <span className="mb-asset-name">{r.label}</span>
                    {r.topTokens.length > 0 ? (
                      <span className="mb-cat-tokens">
                        {r.topTokens.map((tt, i) => {
                          const img = thumbForTopToken(tt)
                          const sym = symbolForTopToken(tt)
                          return (
                            <span key={`${sym}-${i}`} className="mb-cat-token-pill" title={sym}>
                              {img ? (
                                <img
                                  src={`/api/img-proxy?url=${encodeURIComponent(img)}`}
                                  alt=""
                                  loading="lazy"
                                  onError={e => {
                                    e.currentTarget.style.display = 'none'
                                    const fb = e.currentTarget.nextSibling
                                    if (fb) fb.style.display = 'inline-flex'
                                  }}
                                />
                              ) : null}
                              <span
                                className="mb-cat-token-glyph"
                                style={{ display: img ? 'none' : 'inline-flex' }}
                              >
                                {(sym || '?')[0]}
                              </span>
                            </span>
                          )
                        })}
                      </span>
                    ) : null}
                  </span>
                </span>

                <span className="mb-cell mb-col-num mb-col-score">{formatScore(r.score)}</span>
                <span className="mb-cell mb-col-num mb-col-tokens">{fmtInt(r.tokenCount)}</span>
                <span className="mb-cell mb-col-num mb-col-mentions">{fmtInt(r.mentions)}</span>
                <span className="mb-cell mb-col-num mb-col-authors">{fmtInt(r.authors)}</span>
                <span className="mb-cell mb-col-num mb-col-weighted">{r.weightedFmt}</span>
                <span className="mb-cell mb-col-signal">{r.signal}</span>
                <span className="mb-cell mb-col-latest">{r.latest}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  )
}
