/**
 * X DASH hero strip - "Ticker Tape Pulse".
 *
 *   xd-pulse — compact ~140px hero with three thin lanes:
 *     1. SPARK LANE   Tiny sparkline (24h global mention rate) on a single
 *                     line. Live dot at right edge. No KPI numbers.
 *     2. TOKENS LANE  Auto-scrolling marquee of top accelerator tokens.
 *                     Each chip: [tier badge] $CASHTAG +delta% Na ━╱
 *                     where tier = hot/warm/cold from state.scheduler.tier
 *                     and Na = unique_external_authors_24h.
 *     3. PEOPLE LANE  Auto-scrolling marquee of KOLs + narratives + creator
 *                     edits. Each chip surfaces a different lens:
 *                       @handle Nh → $TOKEN          (top carriers)
 *                       Narrative · Nt tokens · fresh% (narrative momentum)
 *                       @handle rebranded bio        (creator-edits alpha)
 *
 *   xd-majors — row below: now a single horizontal scrolling strip of
 *   compact token chips (was a 6-card grid). Same data, much smaller.
 *
 * Pulls 3 endpoints (bootstrap, narratives, creator-edits). Each lane is
 * one CSS marquee animation; hover pauses. Tier badges driven by real
 * state.scheduler.tier so users see what the backend already classified.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useXDashSurface } from '@/hooks/useXDashSurface'
import { Avatar, XDDropdown } from './xd-bits'
import { formatNum, relativeTime } from './x-dash-utils'

const RANKING_LABEL_KEYS = {
  mentions: { key: 'xDash.rankings.mentions.lower', fallback: 'mentions' },
  momentum: { key: 'xDash.rankings.momentum.lower', fallback: 'momentum' },
  conviction: { key: 'xDash.rankings.conviction.lower', fallback: 'conviction' },
}


/* ====================================================================
   TICKER-TAPE PULSE
   Three thin auto-scrolling lanes. No big KPI bar, no big chart.
   ==================================================================== */

const HOUR_MS = 3600_000
const DAY_MS = 86400_000

/* ---- tiny inline sparkline used inside per-chip ticker rows ---- */
function ChipSpark({ prev = 0, now = 0, tone = 'up', width = 44, height = 14 }) {
  const max = Math.max(prev, now, 1)
  const y1 = 2 + (1 - prev / max) * (height - 4)
  const y2 = 2 + (1 - now / max) * (height - 4)
  return (
    <svg
      className={`xd-chip-spark xd-chip-spark--${tone}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <line
        x1="2" y1={y1} x2={width - 2} y2={y2}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx={width - 2} cy={y2} r="1.6" />
    </svg>
  )
}

/* ---- build chip data ---- */

function buildTokenChips(tokens = []) {
  const out = []
  for (const t of tokens) {
    const cgId = t.cg_id || t.token_id
    const symbol = t.symbol
    if (!cgId && !symbol) continue
    const prev = Number(t.external_mentions_prev_daily_avg || 0)
    const cur = Number(t.external_mentions_24h || 0)
    if (cur <= 0) continue
    const delta = prev > 0 ? (cur - prev) / prev : null
    const rankChg = Number(t.rank_change_positions || 0)
    const tier = String(t?.state?.scheduler?.tier || '').toLowerCase()
    const authors = Number(t.unique_external_authors_24h || 0)
    out.push({
      kind: 'token',
      cgId,
      symbol,
      cashtag: t.cashtag || (symbol ? `$${symbol}` : ''),
      image: t.image_small || t.image_url || t.image,
      delta,
      deltaPct: delta == null ? null : Math.round(delta * 100),
      rankChg,
      tier: tier && ['hot', 'warm', 'cold'].includes(tier) ? tier : null,
      authors,
      cur,
      prev,
      tone: delta == null ? 'flat' : delta > 0.02 ? 'up' : delta < -0.02 ? 'down' : 'flat',
    })
  }
  /* sort by absolute delta first, fall back to rank change magnitude */
  return out
    .sort((a, b) => {
      const da = a.delta == null ? 0 : Math.abs(a.delta)
      const db = b.delta == null ? 0 : Math.abs(b.delta)
      if (db !== da) return db - da
      return Math.abs(b.rankChg) - Math.abs(a.rankChg)
    })
    .slice(0, 16)
}

function buildKolChips(tokens = []) {
  const seen = new Set()
  const out = []
  /* Gather all top_authors with the token they're carrying. The FLOW lane
     means "what's happening NOW", so the ranking is recency-first:
       1. authors with a last_seen_at in the last 3h get priority and are
          ranked among themselves by recency, with log(engagement) tiebreak
       2. authors with no fresh timestamp fall through to the legacy
          cumulative sort so we never go empty
     Each chip also carries lastSeenAt so the UI can show "2m / 14m / 1h"
     and the user can tell at a glance whether this is alpha or noise. */
  const FRESH_WINDOW_MS = 3 * HOUR_MS
  const now = Date.now()

  const pool = []
  for (const t of tokens) {
    const list = t.top_authors || []
    for (const a of list) {
      if (!a?.screen_name) continue
      const lastSeenRaw = a.last_seen_at || a.latest_mention_at || null
      const lastSeenTs = lastSeenRaw ? Date.parse(lastSeenRaw) : 0
      pool.push({
        author: a,
        token: t,
        lastSeenTs: Number.isFinite(lastSeenTs) ? lastSeenTs : 0,
      })
    }
  }

  pool.sort((x, y) => {
    const xFresh = x.lastSeenTs && now - x.lastSeenTs < FRESH_WINDOW_MS
    const yFresh = y.lastSeenTs && now - y.lastSeenTs < FRESH_WINDOW_MS
    /* fresh entries always beat stale entries */
    if (xFresh && !yFresh) return -1
    if (!xFresh && yFresh) return 1
    /* both fresh: more recent first, engagement breaks ties */
    if (xFresh && yFresh) {
      const dt = y.lastSeenTs - x.lastSeenTs
      if (dt) return dt
    }
    /* fallback / both stale: cumulative mention_count + engagement */
    const dm = Number(y.author.mention_count || 0) - Number(x.author.mention_count || 0)
    if (dm) return dm
    return Number(y.author.total_weighted_engagement || 0) - Number(x.author.total_weighted_engagement || 0)
  })

  for (const entry of pool) {
    const handle = String(entry.author.screen_name).toLowerCase()
    if (seen.has(handle)) continue
    seen.add(handle)
    out.push({
      kind: 'kol',
      authorId: entry.author.author_rest_id || entry.author.id,
      handle: entry.author.screen_name,
      avatar: entry.author.avatar_image_url,
      mentions: Number(entry.author.mention_count || 0),
      followers: Number(entry.author.followers_count || 0),
      onCashtag: entry.token.cashtag || (entry.token.symbol ? `$${entry.token.symbol}` : ''),
      onCgId: entry.token.cg_id || entry.token.token_id,
      lastSeenAt: entry.lastSeenTs || null,
    })
    if (out.length >= 10) break
  }
  return out
}

function buildNarrativeChips(narratives) {
  const items = Array.isArray(narratives?.items) ? narratives.items : []
  /* Rank by a recency-weighted score so newer momentum can outrank a stale
     cumulative leader. We multiply the raw score by (1 + fresh_token_share),
     so a narrative carrying lots of fresh tokens beats an older one with the
     same raw score. */
  return items
    .slice()
    .sort((a, b) => {
      const sa = Number(a.score_sum || 0) * (1 + Number(a.fresh_token_share || 0))
      const sb = Number(b.score_sum || 0) * (1 + Number(b.fresh_token_share || 0))
      return sb - sa
    })
    .slice(0, 6)
    .map((n) => ({
      kind: 'narrative',
      id: n.id,
      label: n.label || null,
      tokenCount: Number(n.token_count || 0),
      freshShare: Number(n.fresh_token_share || 0),
      cleanSignal: Number(n.average_clean_signal || 0),
      mentionCount: Number(n.mention_count || 0),
      topToken: (n.top_tokens && n.top_tokens[0])
        ? (n.top_tokens[0].token?.cashtag || (n.top_tokens[0].token?.symbol ? `$${n.top_tokens[0].token.symbol}` : null))
        : null,
    }))
}

/* Edit field labels resolved via t() at render — see EditChip. Each entry
   has a translation key + English fallback. */
const EDIT_FIELD_META = {
  description: { key: 'xDash.hero.edit.description', fallback: 'rebranded bio' },
  avatar_image_url: { key: 'xDash.hero.edit.avatar', fallback: 'swapped avatar' },
  screen_name: { key: 'xDash.hero.edit.screenName', fallback: 'changed handle' },
  name: { key: 'xDash.hero.edit.name', fallback: 'renamed' },
  is_blue_verified: { key: 'xDash.hero.edit.verification', fallback: 'verification flipped' },
  location: { key: 'xDash.hero.edit.location', fallback: 'moved location' },
  url: { key: 'xDash.hero.edit.url', fallback: 'new link in bio' },
}

function buildEditChips(edits, t) {
  /* IMPORTANT: the upstream's `latest_edit_at` equals `generated_at_utc` -
     it's the scan timestamp, NOT the moment the user actually edited their
     profile (X doesn't expose that). So edit chips MUST NOT show any time
     pill. We rank by weighted_24h then mentions_24h so the most-active KOLs
     surface first, and the chip itself shows only handle + verb. */
  const entries = Array.isArray(edits?.entries) ? edits.entries : []
  return entries
    .slice()
    .sort((a, b) => {
      const dw = Number(b.weighted_24h || 0) - Number(a.weighted_24h || 0)
      if (dw) return dw
      return Number(b.mentions_24h || 0) - Number(a.mentions_24h || 0)
    })
    .slice(0, 6)
    .map((e) => {
      const fields = Array.isArray(e.visible_changed_fields) ? e.visible_changed_fields : []
      const verb = fields.map((f) => {
        const meta = EDIT_FIELD_META[f]
        return meta ? (typeof t === 'function' ? t(meta.key, meta.fallback) : meta.fallback) : f
      }).filter(Boolean).join(' + ')
        || (typeof t === 'function' ? t('xDash.hero.edit.default', 'edited profile') : 'edited profile')
      return {
        kind: 'edit',
        authorId: e.author_id || e.author?.author_rest_id || e.author?.id,
        handle: e.author?.screen_name,
        avatar: e.author?.avatar_image_url,
        verb,
      }
    })
}

/* Tighter relative-time used inside the ticker so chips stay compact. */
function shortRelativeTime(ts) {
  if (!ts) return null
  const diff = Date.now() - ts
  if (diff < 60_000) return 'now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`
  return `${Math.floor(diff / 86400_000)}d`
}

/* ---- the chip renderers ---- */

function TokenChip({ chip, onOpenToken }) {
  const { t } = useTranslation()
  const tier = chip.tier
  const handleClick = () => chip.cgId && onOpenToken && onOpenToken(chip.cgId)
  const tierLabel = tier ? t(`xDash.hero.tierLabel.${tier}`, `${tier} tier`) : ''
  return (
    <button
      type="button"
      className={`xd-tickchip xd-tickchip--token xd-tickchip--${chip.tone}`}
      onClick={handleClick}
    >
      {tier && (
        <span
          className={`xd-tickchip__tier xd-tickchip__tier--${tier}`}
          title={tierLabel}
          aria-label={tierLabel}
          role="img"
        >
          {tier === 'hot' ? '●' : tier === 'warm' ? '◐' : '○'}
        </span>
      )}
      {chip.image && (
        <img className="xd-tickchip__logo" src={chip.image} alt="" loading="lazy" />
      )}
      <span className="xd-tickchip__cashtag">{chip.cashtag}</span>
      {chip.deltaPct != null && (
        <span className={`xd-tickchip__delta xd-tickchip__delta--${chip.tone}`}>
          {chip.deltaPct > 0 ? '+' : ''}{chip.deltaPct}%
        </span>
      )}
      {chip.rankChg !== 0 && (
        <span className={`xd-tickchip__rank xd-tickchip__rank--${chip.rankChg > 0 ? 'up' : 'down'}`}>
          {chip.rankChg > 0 ? '▲' : '▼'}{Math.abs(chip.rankChg)}
        </span>
      )}
      {chip.authors > 0 && (
        <span className="xd-tickchip__authors">{t('xDash.hero.authorsShort', '{{count}}a', { count: formatNum(chip.authors) })}</span>
      )}
      <ChipSpark prev={chip.prev} now={chip.cur} tone={chip.tone} />
    </button>
  )
}

function KolChip({ chip, onOpenAuthor, onOpenToken }) {
  const { t } = useTranslation()
  const when = shortRelativeTime(chip.lastSeenAt)
  const openAuthor = () => chip.authorId && onOpenAuthor && onOpenAuthor(chip.authorId)
  const openToken = (e) => {
    e.stopPropagation()
    if (chip.onCgId && onOpenToken) onOpenToken(chip.onCgId)
  }
  return (
    <div
      role="group"
      aria-label={t('xDash.hero.kolAria', 'KOL {{handle}} mentioned {{cashtag}}', { handle: chip.handle, cashtag: chip.onCashtag })}
      className="xd-tickchip xd-tickchip--kol"
      onClick={openAuthor}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAuthor() } }}
      tabIndex={0}
    >
      {chip.avatar && (
        <img className="xd-tickchip__logo xd-tickchip__logo--round" src={chip.avatar} alt="" loading="lazy" />
      )}
      <span className="xd-tickchip__handle">@{chip.handle}</span>
      <span className="xd-tickchip__arrow" aria-hidden="true">→</span>
      <button
        type="button"
        className="xd-tickchip__cashtag xd-tickchip__cashtag--link"
        onClick={openToken}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
        aria-label={t('xDash.hero.openCashtag', 'Open {{cashtag}}', { cashtag: chip.onCashtag })}
      >
        {chip.onCashtag}
      </button>
      {when && <span className="xd-tickchip__when">{when}</span>}
    </div>
  )
}

function NarrativeChip({ chip }) {
  const { t } = useTranslation()
  /* Narrative chips show: dot + label + top token. No "Nt" cryptic counts,
     no "% fresh" jargon. If we want to surface token breadth, do it with a
     real word or not at all. The narrative label + a representative token
     is enough for a glance-read ticker. */
  return (
    <span className="xd-tickchip xd-tickchip--narrative">
      <span className="xd-tickchip__narr-dot" />
      <span className="xd-tickchip__narr-label">{chip.label || t('xDash.hero.narrativeFallback', 'Narrative')}</span>
      {chip.topToken && <span className="xd-tickchip__meta">{chip.topToken}</span>}
    </span>
  )
}

function EditChip({ chip, onOpenAuthor }) {
  /* Edit chips show ONLY what is true: who changed what. No counts, no
     letters that could read as time. The upstream cannot tell us WHEN the
     user actually rebranded - X doesn't expose that - so we say nothing
     about timing. Anything else (their activity, token breadth) is one
     click away in the author drawer. */
  return (
    <button
      type="button"
      className="xd-tickchip xd-tickchip--edit"
      onClick={() => chip.authorId && onOpenAuthor && onOpenAuthor(chip.authorId)}
    >
      {chip.avatar && (
        <img className="xd-tickchip__logo xd-tickchip__logo--round" src={chip.avatar} alt="" loading="lazy" />
      )}
      <span className="xd-tickchip__handle">@{chip.handle}</span>
      <span className="xd-tickchip__verb">{chip.verb}</span>
    </button>
  )
}

/* ---- the marquee container. CSS keyframe scrolls children left.
       We duplicate children once so the loop is seamless. ---- */
function Marquee({ children, speed = 80, className = '' }) {
  /* duration in seconds inversely proportional to width — speed = pixels/sec */
  const items = Array.isArray(children) ? children.filter(Boolean) : (children ? [children] : [])
  if (items.length === 0) return null
  return (
    <div className={`xd-marquee ${className}`}>
      <div className="xd-marquee__track" style={{ animationDuration: `${Math.max(20, items.length * 4)}s` }}>
        <div className="xd-marquee__group">{items}</div>
        <div className="xd-marquee__group" aria-hidden="true">{items}</div>
      </div>
    </div>
  )
}

/* ====================================================================
   UNIFIED STREAM CARD
   One row, one selector. Picks between three streams:
     - movers : top accelerator tokens (was lane 1)
     - flow   : KOLs + narratives + creator edits (was lane 2)
     - top    : top tokens in play (was the separate strip below)
   Keeps the same chip vocab and data hooks - just one surface now.
   ==================================================================== */

function StreamCard({
  data,
  loading,
  timeframe = '24h',
  inPlayTiles = [],
  inPlayLoading = false,
  ranking = 'mentions',
  onOpenToken,
  onOpenAuthor,
}) {
  const { t } = useTranslation()
  const STREAM_OPTIONS = useMemo(() => [
    { value: 'movers', label: t('xDash.hero.stream.movers', 'Movers') },
    { value: 'flow', label: t('xDash.hero.stream.flow', 'Flow') },
    { value: 'top', label: t('xDash.hero.stream.top', 'Top tokens in play') },
  ], [t])

  /* Secondary feeds. Aggressive freshness: client cache disabled (ttlMs:0)
     so each 60s poll truly bypasses the in-memory cache, refetch on focus,
     and the server now holds these ticker surfaces for only 30s upstream.
     Net: ticker chips are at most ~30s behind reality on a focused tab. */
  const SURFACE_OPTS = { ttlMs: 0, refreshIntervalMs: 60_000, refreshOnFocus: true }

  /* Narratives: the Leaderboard rail (RailNarratives) requests the IDENTICAL
     surface ({ timeframe, perPage: 6 }) on the same mount. Keep the cache TTL
     here (don't pass ttlMs:0) so this copy shares the rail's CLIENT_CACHE /
     INFLIGHT entry instead of firing a second cache-bypass fetch. The 60s
     background poll still keeps it live - it just refreshes the shared entry. */
  // persist: always-mounted strip, small payload - LS seed for cold reloads
  const NARRATIVE_OPTS = { refreshIntervalMs: 60_000, refreshOnFocus: true, persist: true }

  const narrativeParams = useMemo(() => ({ timeframe, perPage: 6 }), [timeframe])
  const { data: narratives } = useXDashSurface('/api/xdash/narratives', narrativeParams, NARRATIVE_OPTS)

  const editsParams = useMemo(() => ({ timeframe, perPage: 6 }), [timeframe])
  const { data: edits } = useXDashSurface('/api/xdash/creator-edits', editsParams, SURFACE_OPTS)

  const read = useMemo(() => {
    if (!data) return null
    const tokens = data.tokens || []
    let now = 0, prev = 0
    for (const row of tokens) {
      now += Number(row.external_mentions_24h || 0)
      prev += Number(row.external_mentions_prev_daily_avg || 0)
    }
    const delta = prev > 0 ? (now - prev) / prev : null
    const tone = delta == null ? 'flat' : delta > 0.02 ? 'up' : delta < -0.02 ? 'down' : 'flat'
    return {
      tokens,
      prevTotal: prev,
      nowTotal: now,
      delta,
      tone,
      generatedAt: data.generated_at_utc,
    }
  }, [data])

  const live = useMemo(() => {
    if (!read?.generatedAt) return false
    const t = Date.parse(read.generatedAt)
    if (!Number.isFinite(t)) return false
    return Date.now() - t < 90 * 60 * 1000
  }, [read?.generatedAt])

  const tokenChips = useMemo(() => buildTokenChips(read?.tokens || []), [read?.tokens])
  const kolChips = useMemo(() => buildKolChips(read?.tokens || []), [read?.tokens])
  const narrChips = useMemo(() => buildNarrativeChips(narratives), [narratives])
  const editChips = useMemo(() => buildEditChips(edits, t), [edits, t])

  /* FLOW age = how long since the upstream LAST GENERATED this data. Both
     surfaces expose generated_at_utc - that's an honest "data is Xm old"
     signal. We deliberately do NOT mix in any per-entry "edit" timestamps
     because the upstream's latest_edit_at is just the scan timestamp and
     would always claim sub-minute freshness even for ancient profile
     changes. The lane-age tells the user how stale the surface itself is. */
  const flowFreshAt = useMemo(() => {
    let newest = 0
    const ng = narratives?.generated_at_utc ? Date.parse(narratives.generated_at_utc) : 0
    if (Number.isFinite(ng) && ng > newest) newest = ng
    const eg = edits?.generated_at_utc ? Date.parse(edits.generated_at_utc) : 0
    if (Number.isFinite(eg) && eg > newest) newest = eg
    return newest || null
  }, [narratives?.generated_at_utc, edits?.generated_at_utc])

  const flowLive = useMemo(() => {
    if (!flowFreshAt) return false
    return Date.now() - flowFreshAt < 5 * 60 * 1000
  }, [flowFreshAt])

  const flowAge = useMemo(() => shortRelativeTime(flowFreshAt), [flowFreshAt])

  /* lane 3 mixes KOLs + narratives + creator-edits, interleaved so the ticker
     reads variety instead of N kols in a row then N narratives. */
  const peopleChips = useMemo(() => {
    const out = []
    const maxLen = Math.max(kolChips.length, narrChips.length, editChips.length)
    for (let i = 0; i < maxLen; i += 1) {
      if (kolChips[i]) out.push({ kind: 'kol', payload: kolChips[i] })
      if (narrChips[i]) out.push({ kind: 'narrative', payload: narrChips[i] })
      if (editChips[i]) out.push({ kind: 'edit', payload: editChips[i] })
    }
    return out
  }, [kolChips, narrChips, editChips])

  const [stream, setStream] = useState('movers')

  /* Per-stream meta: live dot + relative-time age. We keep the same signals
     the old multi-lane layout had; they just project onto whichever stream
     the user picked. */
  const meta = useMemo(() => {
    if (stream === 'movers') {
      return { live, age: null, count: tokenChips.length, hint: t('xDash.hero.hint.movers', 'by momentum · {{tf}}', { tf: timeframe }) }
    }
    if (stream === 'flow') {
      return { live: flowLive, age: flowAge, count: peopleChips.length, hint: t('xDash.hero.hint.flow', 'kols · narratives · edits') }
    }
    const tfText = timeframe === '7d' ? '7d' : '24h'
    const rankMeta = RANKING_LABEL_KEYS[ranking]
    const rankText = rankMeta ? t(rankMeta.key, rankMeta.fallback) : ranking
    return {
      live: !inPlayLoading && inPlayTiles.length > 0,
      age: null,
      count: inPlayTiles.length,
      hint: inPlayLoading && !inPlayTiles.length
        ? t('xDash.hero.loading', 'loading...')
        : t('xDash.hero.hint.top', '{{count}} by {{rank}} · {{tf}}', { count: inPlayTiles.length, rank: rankText, tf: tfText }),
    }
  }, [stream, live, flowLive, flowAge, tokenChips.length, peopleChips.length, inPlayTiles.length, inPlayLoading, ranking, timeframe, t])

  const isLoading =
    (stream === 'movers' && loading && !data) ||
    (stream === 'flow'   && loading && !data) ||
    (stream === 'top'    && inPlayLoading && !inPlayTiles.length)

  const renderChips = () => {
    if (stream === 'movers') {
      if (!read) return null
      return (
        <Marquee>
          {tokenChips.map((c) => (
            <TokenChip key={`tok-${c.cgId || c.symbol}`} chip={c} onOpenToken={onOpenToken} />
          ))}
        </Marquee>
      )
    }
    if (stream === 'flow') {
      return (
        <Marquee>
          {peopleChips.map((c, i) => {
            if (c.kind === 'kol') {
              return (
                <KolChip
                  key={`kol-${c.payload.authorId || c.payload.handle}-${i}`}
                  chip={c.payload}
                  onOpenAuthor={onOpenAuthor}
                  onOpenToken={onOpenToken}
                />
              )
            }
            if (c.kind === 'narrative') {
              return <NarrativeChip key={`narr-${c.payload.id || c.payload.label}-${i}`} chip={c.payload} />
            }
            return (
              <EditChip
                key={`edit-${c.payload.authorId || c.payload.handle}-${i}`}
                chip={c.payload}
                onOpenAuthor={onOpenAuthor}
              />
            )
          })}
        </Marquee>
      )
    }
    /* top tokens in play - static horizontal scroll (not a marquee, the user
       wants to scan & click, not watch it scroll past) */
    if (inPlayTiles.length === 0) {
      return <div className="xd-streamcard__empty">{t('xDash.hero.empty.topInPlay', 'No tokens match the current filters.')}</div>
    }
    return (
      <div className="xd-streamcard__row">
        {inPlayTiles.map((row) => (
          <InPlayChip
            key={row.cg_id || row.token_id || row.symbol}
            row={row}
            onOpenToken={onOpenToken}
          />
        ))}
      </div>
    )
  }

  /* Adapt STREAM_OPTIONS (value/label) to XDDropdown's {key, label} shape. */
  const streamDropdownOptions = useMemo(
    () => STREAM_OPTIONS.map((o) => ({ key: o.value, label: o.label })),
    [],
  )

  return (
    <div className="xd-streamcard">
      <div className="xd-streamcard__head">
        <span className={`xd-streamcard__dot xd-streamcard__dot--${meta.live ? 'on' : 'off'}`} />
        <XDDropdown
          options={streamDropdownOptions}
          value={stream}
          onChange={setStream}
          ariaLabel={t('xDash.hero.streamAria', 'Stream')}
          minWidth={200}
        />
        {meta.hint && <span className="xd-streamcard__hint">{meta.hint}</span>}
        {meta.age && <span className="xd-streamcard__age">{meta.age}</span>}
      </div>
      <span className="xd-streamcard__divider" aria-hidden="true" />
      <div className="xd-streamcard__body">
        {isLoading ? (
          <div className="xd-shimmer-bar xd-shimmer-bar--block animate-shimmer" style={{ height: 22, flex: 1, borderRadius: 6 }} />
        ) : (
          renderChips()
        )}
      </div>
    </div>
  )
}

/* ====================================================================
   MAJORS - glass tiles, grid auto-fit so they fill the row
   ==================================================================== */

/* Compact horizontal "in play" strip - was a 6-card grid, now a single
   thin row of token chips. ~48px tall vs ~140px before. */
function InPlayChip({ row, onOpenToken }) {
  const cgId = row.cg_id || row.token_id
  const symbol = row.symbol
  const cashtag = row.cashtag || (symbol ? `$${symbol}` : '$')
  const image = row.image_small || row.image_url || row.image
  const now = Number(row.external_mentions_24h || 0)
  const prev = Number(row.external_mentions_prev_daily_avg || 0)
  const delta = prev > 0 ? (now - prev) / prev : null
  const deltaPct = delta == null ? null : Math.round(delta * 100)
  const tone = deltaPct == null ? 'flat' : deltaPct > 2 ? 'up' : deltaPct < -2 ? 'down' : 'flat'
  const tier = String(row?.state?.scheduler?.tier || '').toLowerCase()
  const tierClass = tier && ['hot', 'warm', 'cold'].includes(tier) ? tier : null

  return (
    <button
      type="button"
      className={`xd-inplay-chip xd-inplay-chip--${tone}`}
      onClick={() => cgId && onOpenToken && onOpenToken(cgId)}
    >
      {tierClass && (
        <span className={`xd-inplay-chip__tier xd-inplay-chip__tier--${tierClass}`} />
      )}
      {image
        ? <img className="xd-inplay-chip__logo" src={image} alt="" loading="lazy" />
        : <Avatar src={null} alt={symbol} size={20} />
      }
      <span className="xd-inplay-chip__cashtag">{cashtag}</span>
      <span className="xd-inplay-chip__mentions">{formatNum(now)}</span>
      {deltaPct != null && (
        <span className={`xd-inplay-chip__delta xd-inplay-chip__delta--${tone}`}>
          {deltaPct > 0 ? '+' : ''}{deltaPct}%
        </span>
      )}
      <ChipSpark prev={prev} now={now} tone={tone} width={38} height={14} />
    </button>
  )
}

/* ====================================================================
   PUBLIC EXPORT - dumb component, all data fetching lives upstream.
   The three legacy lanes (movers / flow / top tokens in play) are now
   collapsed into a single StreamCard with a select.
   ==================================================================== */
export default function XDHeroStrip({
  data,
  loading,
  inPlayTiles = [],
  inPlayLoading = false,
  ranking = 'mentions',
  timeframe = '24h',
  onOpenToken,
  onOpenAuthor,
}) {
  return (
    <div className="xd-herostrip">
      <StreamCard
        data={data}
        loading={loading}
        timeframe={timeframe}
        inPlayTiles={inPlayTiles}
        inPlayLoading={inPlayLoading}
        ranking={ranking}
        onOpenToken={onOpenToken}
        onOpenAuthor={onOpenAuthor}
      />
    </div>
  )
}
