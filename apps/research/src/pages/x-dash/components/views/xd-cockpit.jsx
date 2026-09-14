/** Headline cards derived from the loaded board: identity, metric and evidence. */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar, cleanSignalTone } from '../xd-bits'
import { computeSignalScore } from '../xd-signal'
import { formatNum, humanizeLabel } from '../x-dash-utils'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import useSettingsStore from '@/store/useSettingsStore'

const I = { w: 13, h: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
const ArrowIcon = () => (<svg {...I}><path d="M7 17 17 7M9 7h8v8" /></svg>)
const FlameIcon = () => (<svg {...I}><path d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1 0-2 1-3 1 2 3 3 3 6a6 6 0 1 1-12 0c0-4 4-5 6-10Z" /></svg>)
const ShieldIcon = () => (<svg {...I}><path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>)
const AlertIcon = () => (<svg {...I}><path d="M12 4 2 20h20L12 4Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg>)
const MegaphoneIcon = () => (<svg {...I}><path d="m3 11 14-6v14L3 13v-2Z" /><path d="M7 12v5a2 2 0 0 0 4 0" /><path d="M17 8a4 4 0 0 1 0 8" /></svg>)
const LayersIcon = () => (<svg {...I}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>)
const ICONS = { mover: FlameIcon, clean: ShieldIcon, noisy: AlertIcon, carrier: MegaphoneIcon, narrative: LayersIcon }

function identity(row) {
  return {
    symbol: row.symbol || row.cashtag?.replace(/^\$/, '') || '',
    name: row.name || row.symbol || '',
    cgId: row.cg_id || row.token_id || null,
    image: row.image_small || row.image || row.image_url || null,
    segment: row.segment || null,
  }
}
const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const hasPriorRank = (r) => Number.isFinite(Number(r.previous_rank_position)) && Number(r.previous_rank_position) > 0

/* Member avatar cluster — used on the carrier + narrative cards in place of a
   sparkline (no per-entity timeseries on those). Mirrors Zunor's holdings row. */
function Cluster({ items = [], max = 4 }) {
  const shown = items.slice(0, max)
  const extra = items.length - shown.length
  if (shown.length === 0) return null
  return (
    <div className="xd-cockpit-card__cluster">
      {shown.map((it, i) => (
        <span className="xd-cockpit-card__chip-token" key={i} title={it.symbol}>
          <Avatar src={it.image} alt={it.symbol} size={18} />
          <span className="xd-cockpit-card__chip-sym">{it.symbol}</span>
        </span>
      ))}
      {extra > 0 && <span className="xd-cockpit-card__chip-more xd-num">+{extra}</span>}
    </div>
  )
}

export default function XDCockpit({ tokens = [], loading = false, onOpenToken, onOpenAuthor }) {
  const { t } = useTranslation()
  const open = useSettingsStore((s) => s.xdWhatsMovingOpen)
  const toggleOpen = useSettingsStore((s) => s.toggleXdWhatsMoving)
  const headToggle = (
    <button
      type="button"
      className="xd-sec-toggle"
      onClick={toggleOpen}
      aria-expanded={open}
      title={open
        ? t('xDash.cockpit.collapse', "Hide what's moving now")
        : t('xDash.cockpit.expand', "Show what's moving now")}
    >
      <svg className="xd-sec-toggle__chev" viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="xd-cockpit__eyebrow">{t('xDash.cockpit.heading', "What's moving now")}</span>
    </button>
  )

  /* Cheap content signature over the fields the cards actually rank on:
     identity + mentions + rank move + carrier count + leading category. The
     board hands in a fresh `tokens` ref every 60s poll, so keying the ~150-line
     analyst compute (multiple sort/filter/reduce) on `tokens` re-ran it every
     poll even when nothing the cards read had moved. Keying on this signature
     recomputes only when those inputs actually change. */
  const tokensSig = useMemo(() => (
    (tokens || [])
      .map((r) => {
        if (!r) return ''
        const m = r.metrics || r
        const q = r.quality || r
        return [
          r.cg_id || r.token_id || r.symbol,
          r.external_mentions_24h,
          r.rank_change_positions,
          r.rank_direction,
          r.rank_position,
          // signal-score inputs (clean breakout / noisiest cards rank on these)
          q.clean_signal_score_24h ?? m.clean_signal_score_24h,
          m.velocity_ratio,
          m.novelty_ratio,
          m.external_weighted_engagement_24h,
          // carrier card aggregates top_authors; narrative card groups by category
          Array.isArray(r.top_authors) ? r.top_authors.length : 0,
          r.primary_category || (Array.isArray(r.category) ? r.category[0] : r.category),
        ].join(':')
      })
      .join('|')
  ), [tokens])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on tokensSig
  const cards = useMemo(() => {
    const rows = (tokens || []).filter((r) => r && (r.symbol || r.cashtag))
    if (rows.length === 0) return []
    const enriched = rows.map((r) => {
      const sig = computeSignalScore(r)
      return {
        r,
        clean: sig.parts?.cleanSignal ?? 0,
        score: sig.score,
        mentions: Number(r.external_mentions_24h || 0),
        rankUp: Number(r.rank_change_positions || 0) * (r.rank_direction === 'down' ? -1 : 1),
      }
    })
    const withMentions = enriched.filter((e) => e.mentions >= 8)
    const pool = withMentions.length >= 3 ? withMentions : enriched

    // Keep the five cards on five DISTINCT subjects.
    const used = new Set()
    const symKey = (e) => String(e?.r?.symbol || '').toUpperCase()
    const claim = (e) => { if (e) used.add(symKey(e)); return e }
    const pick = (rankFn, filterFn) => {
      const ranked = [...pool].filter((e) => (filterFn ? filterFn(e) : true)).sort(rankFn)
      return ranked.find((e) => !used.has(symKey(e))) || ranked[0] || null
    }

    // 01 Top mover — biggest real climb; tokens with a prior rank rank above
    // fresh entries (a +400 "climb" from nowhere is a new listing, not a move).
    const mover = claim(
      pick((a, b) => (hasPriorRank(b.r) - hasPriorRank(a.r)) || (b.rankUp - a.rankUp))
    )
    // 02 Cleanest breakout — rising-ish + highest clean signal
    const cleanest = claim(
      pick((a, b) => b.clean - a.clean || b.score - a.score, (e) => e.rankUp >= 0)
      || pick((a, b) => b.clean - a.clean)
    )
    // 03 Noisiest — loud mentions, weak clean signal
    const noisiest = claim(pick((a, b) => (b.mentions * (1 - b.clean)) - (a.mentions * (1 - a.clean))))

    // 04 Top carrier — aggregate top_authors across tokens by weighted engagement,
    // collecting the tokens each voice carried (for the cluster).
    const carriers = new Map()
    for (const r of rows) {
      const id = identity(r)
      for (const a of (Array.isArray(r.top_authors) ? r.top_authors : [])) {
        const aid = a.author_id || a.rest_id || a.screen_name
        if (!aid) continue
        const prev = carriers.get(aid) || { a, eng: 0, carried: [] }
        prev.eng += Number(a.weighted_engagement || a.total_weighted_engagement || 0)
        if (id.symbol) prev.carried.push({ symbol: id.symbol, image: id.image })
        prev.a = a
        carriers.set(aid, prev)
      }
    }
    const carrier = [...carriers.values()].sort((a, b) => b.eng - a.eng || b.carried.length - a.carried.length)[0] || null

    // 05 Most active narrative — group by primary category, sum mentions
    const narr = new Map()
    for (const e of pool) {
      const cat = e.r.primary_category
        || (Array.isArray(e.r.category) ? e.r.category[0] : e.r.category)
        || (Array.isArray(e.r.tags) ? e.r.tags[0] : null)
      if (!cat) continue
      const prev = narr.get(cat) || { cat, mentions: 0, tokens: 0, members: [] }
      prev.mentions += e.mentions
      prev.tokens += 1
      prev.members.push(e)
      narr.set(cat, prev)
    }
    const narrative = [...narr.values()].sort((a, b) => b.mentions - a.mentions || b.tokens - a.tokens)[0] || null
    if (narrative) {
      const byScore = [...narrative.members].sort((a, b) => b.score - a.score)
      narrative.top = byScore.find((e) => !used.has(symKey(e))) || byScore[0]
    }

    const out = []
    if (mover) {
      const id = identity(mover.r)
      const fresh = !hasPriorRank(mover.r)
      out.push({
        key: 'mover', tone: mover.rankUp >= 0 ? 'up' : 'down',
        kicker: t('xDash.cockpit.topMover', 'Top mover'),
        id, row: mover.r,
        metricLabel: fresh ? t('xDash.cockpit.newEntry', 'new entry') : t('xDash.cockpit.rankMove', 'rank move · 24h'),
        info: 'rankMove',
        value: fresh ? t('xDash.cockpit.new', 'NEW') : `${mover.rankUp >= 0 ? '+' : ''}${mover.rankUp}`,
        chips: [
          { label: `#${mover.r.rank_position ?? '-'}`, tone: 'neutral' },
          { label: `${formatNum(mover.mentions)} ${t('xDash.cockpit.mentions', 'mentions')}`, tone: 'neutral' },
        ],
        onClick: () => id.cgId && onOpenToken?.(id.cgId),
      })
    }
    if (cleanest) {
      const id = identity(cleanest.r)
      out.push({
        key: 'clean', tone: 'clean',
        kicker: t('xDash.cockpit.cleanestBreakout', 'Cleanest breakout'),
        id, row: cleanest.r,
        metricLabel: t('xDash.cockpit.cleanSignal', 'clean signal'),
        info: 'cleanSignal',
        value: pct(cleanest.clean), valueTone: cleanSignalTone(cleanest.clean),
        chips: [
          { label: t('xDash.cockpit.clean', 'Clean'), tone: 'bull' },
          { label: `${formatNum(cleanest.mentions)} ${t('xDash.cockpit.mentions', 'mentions')}`, tone: 'neutral' },
        ],
        onClick: () => id.cgId && onOpenToken?.(id.cgId),
      })
    }
    if (noisiest) {
      const id = identity(noisiest.r)
      out.push({
        key: 'noisy', tone: 'noisy',
        kicker: t('xDash.cockpit.noisiest', 'Noisiest'),
        id, row: noisiest.r,
        metricLabel: t('xDash.cockpit.mentions24h', 'mentions · 24h'),
        info: 'noisiest',
        value: formatNum(noisiest.mentions),
        chips: [
          { label: t('xDash.cockpit.noisy', 'Noisy'), tone: 'bear' },
          { label: `${pct(noisiest.clean)} ${t('xDash.cockpit.clean', 'clean')}`, tone: 'neutral' },
        ],
        onClick: () => id.cgId && onOpenToken?.(id.cgId),
      })
    }
    if (carrier) {
      const a = carrier.a
      // dedupe carried tokens by symbol
      const seen = new Set()
      const carried = carrier.carried.filter((c) => c.symbol && !seen.has(c.symbol) && seen.add(c.symbol))
      out.push({
        key: 'carrier', tone: 'accent', isAuthor: true,
        kicker: t('xDash.cockpit.topCarrier', 'Top carrier'),
        id: { name: a.name || a.screen_name, symbol: a.screen_name ? `@${a.screen_name}` : '', image: a.avatar_image_url || a.avatar || null },
        metricLabel: t('xDash.cockpit.weightedReach', 'weighted reach · 24h'),
        info: 'weightedReach',
        value: formatNum(carrier.eng, { maxFraction: 0 }),
        chips: [{ label: plural(carried.length, t('xDash.cockpit.tokenCarried', 'token'), t('xDash.cockpit.tokensCarried', 'tokens')), tone: 'neutral' }],
        cluster: carried,
        onClick: () => (a.author_id || a.rest_id) && onOpenAuthor?.(a.author_id || a.rest_id),
      })
    }
    if (narrative) {
      const id = identity(narrative.top.r)
      const members = narrative.members
        .sort((x, y) => y.score - x.score)
        .map((e) => ({ symbol: identity(e.r).symbol, image: identity(e.r).image }))
        .filter((m) => m.symbol)
      out.push({
        key: 'narrative', tone: 'neutral', isNarrative: true,
        kicker: t('xDash.cockpit.mostActiveNarrative', 'Most active narrative'),
        id, narrativeLabel: humanizeLabel(narrative.cat),
        metricLabel: t('xDash.cockpit.attention24h', 'attention · 24h'),
        info: 'attention',
        value: formatNum(narrative.mentions),
        chips: [{ label: plural(narrative.tokens, t('xDash.cockpit.tokenCarried', 'token'), t('xDash.cockpit.tokensCarried', 'tokens')), tone: 'neutral' }],
        cluster: members,
        sub: `${id.symbol ? `$${id.symbol}` : id.name} ${t('xDash.cockpit.leads', 'leads')}`,
        onClick: () => id.cgId && onOpenToken?.(id.cgId),
      })
    }
    return out
  }, [tokensSig, t, onOpenToken, onOpenAuthor])

  if (loading && cards.length === 0) {
    return (
      <section className={`xd-cockpit${open ? '' : ' xd-cockpit--collapsed'}`} aria-label="What's moving now" data-tour="xd-cockpit">
        <div className="xd-cockpit__head">
          {headToggle}
          <span className="xd-cockpit__rule" aria-hidden="true" />
        </div>
        {open && (
        <div className="xd-cockpit__grid">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="xd-cockpit-card xd-cockpit-card--skel">
              <div className="xd-shimmer-bar xd-shimmer-bar--xs animate-shimmer" style={{ width: 70 }} />
              <div className="xd-shimmer-bar xd-shimmer-bar--lg animate-shimmer" style={{ marginTop: 16, width: '72%' }} />
              <div className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" style={{ marginTop: 20, width: '100%' }} />
              <div className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" style={{ marginTop: 14, width: 100 }} />
            </div>
          ))}
        </div>
        )}
      </section>
    )
  }
  if (cards.length === 0) return null

  return (
    <section className={`xd-cockpit${open ? '' : ' xd-cockpit--collapsed'}`} aria-label="What's moving now">
      <div className="xd-cockpit__head">
        {headToggle}
        <span className="xd-cockpit__rule" aria-hidden="true" />
      </div>
      {open && (
      <div className="xd-cockpit__grid">
        {cards.map((c, i) => {
          const Icon = ICONS[c.key] || FlameIcon
          return (
            <button type="button" key={c.key} className={`xd-cockpit-card xd-cockpit-card--${c.tone}`} onClick={c.onClick}>
              {c.id.image && <img hidden className="xd-cockpit-card__ambient" src={c.id.image} alt="" aria-hidden="true" loading="lazy" decoding="async" draggable="false" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
              <div className="xd-cockpit-card__head">
                <span className="xd-cockpit-card__icon"><Icon /></span>
                <span className="xd-cockpit-card__num xd-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="xd-cockpit-card__sep">/</span>
                <span className="xd-cockpit-card__kicker">{c.kicker}</span>
                <span className="xd-cockpit-card__arrow"><ArrowIcon /></span>
              </div>

              <div className="xd-cockpit-card__identity">
                <Avatar src={c.id.image} alt={c.id.name} size={28} />
                <div className="xd-cockpit-card__id-text">
                  <span className="xd-cockpit-card__name">
                    {c.isNarrative ? c.narrativeLabel : c.isAuthor ? c.id.symbol : (c.id.symbol ? `$${c.id.symbol}` : c.id.name)}
                  </span>
                  <span className="xd-cockpit-card__sub">{c.isNarrative ? c.sub : c.id.name}</span>
                </div>
              </div>

              <div className="xd-cockpit-card__metric">
                <span className="xd-cockpit-card__metric-label">{c.metricLabel}{c.info && <InfoTip text={getMetricInfo(c.info)} position="top" />}</span>
                <b className={`xd-cockpit-card__value xd-num${c.valueTone ? ` xd-cockpit-card__value--${c.valueTone}` : ''}`}>{c.value}</b>
              </div>

              {c.cluster?.length > 0 && <div className="xd-cockpit-card__evidence">
                <Cluster items={c.cluster} />
              </div>}

              <div className="xd-cockpit-card__chips">
                {c.chips.map((chip, ci) => (
                  <span key={ci} className={`xd-cockpit-card__chip xd-cockpit-card__chip--${chip.tone}`}>{chip.label}</span>
                ))}
              </div>
            </button>
          )
        })}
      </div>
      )}
    </section>
  )
}
