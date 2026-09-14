/**
 * lite-news.jsx - the News view of LITE.
 *
 * Reads `data.news` from use-lite-data (crypto headlines + the Spectre Macro
 * Wire, newest first). The wire rows carry the desk's own read of each story
 * (context, category, sentiment, importance, assets) - this view finally shows
 * it instead of a bare headline: a lead story, kind chips in the PRO newsroom's
 * colors, a one-line "why it matters", the Shock / Breaking lane from the TG
 * alerts, and a right rail with the wire's 48h pulse. Two columns on desktop,
 * one under 900px.
 */
import React, { useMemo, useState } from 'react'
import { tl } from './lite-i18n'
import { useTranslation } from 'react-i18next'
import { WIRE_KINDS, WIRE_SHOCK_MIN } from '@/pages/news/components/wire-art'
import { track, Events } from '@/services/analytics'
import { liteTimeAgo } from './use-lite-data'
import './lite-news.css'

const BREAKING_MIN = 70
const LEAD_MAX_AGE_SEC = 18 * 3600

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M12 5l7 7-7 7" /></svg>
)

function kindOf(item) {
  if (item.kind !== 'wire') return { label: item.source || 'Crypto', color: null }
  return WIRE_KINDS[item.category] || WIRE_KINDS.macro
}

function laneOf(item) {
  const imp = item.importance
  if (!Number.isFinite(imp)) return null
  if (imp >= WIRE_SHOCK_MIN) return 'shock'
  if (imp >= BREAKING_MIN) return 'breaking'
  return null
}

const sentCls = (s) => (s === 'bullish' ? 'up' : s === 'bearish' ? 'down' : '')

// Crypto rows carry keyword tags in `assets` (THREE, ASIA, OPENAI...), the wire
// carries real tickers. Only a symbol the board knows (has a logo) is shown as
// an asset - a tag chip that looks like a ticker is worse than none.
function tickersOf(item, imgBySym) {
  const raw = (item.assets || []).map((a) => String(a).toUpperCase().replace(/^\$/, '')).filter((a) => /^[A-Z0-9]{2,8}$/.test(a))
  const ok = item.kind === 'wire' ? raw : raw.filter((a) => Boolean(imgBySym?.[a]))
  return [...new Set(ok)]
}

function Skel({ n = 6 }) {
  return (
    <ul className="lite-skel" aria-hidden>
      {Array.from({ length: n }).map((_, i) => <li key={i} className="lite-skel-row" style={{ animationDelay: `${i * 80}ms` }} />)}
    </ul>
  )
}

function linkProps(item) {
  return item.wirePath
    ? { href: item.wirePath }
    : { href: item.url, target: '_blank', rel: 'noopener noreferrer' }
}

function Chips({ item, t }) {
  const kind = kindOf(item)
  const lane = laneOf(item)
  return (
    <span className="lite-nw-chips">
      <i className="lite-nw-kind" style={kind.color ? { '--nw-k': kind.color } : undefined}>{kind.label}</i>
      {lane === 'shock' && <i className="lite-nw-lane lite-nw-lane--shock">{tl(t, 'Shock', 'msg')}</i>}
      {lane === 'breaking' && <i className="lite-nw-lane lite-nw-lane--breaking">{tl(t, 'Breaking', 'msg')}</i>}
    </span>
  )
}

function Meta({ item, t, imgBySym }) {
  const sent = sentCls(item.sentiment)
  const assets = tickersOf(item, imgBySym).slice(0, 3)
  return (
    <span className="lite-nw-meta">
      {sent && <b className={`lite-nw-sent ${sent}`} aria-label={item.sentiment} />}
      <span>{[item.kind === 'wire' ? 'Spectre Macro Wire' : item.source, liteTimeAgo(item.publishedOn, t)].filter(Boolean).join(' · ')}</span>
      {assets.length > 0 && (
        <span className="lite-nw-assets">
          {assets.map((a) => (
            <em key={a}>{imgBySym?.[a] ? <img src={imgBySym[a]} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : null}{a}</em>
          ))}
        </span>
      )}
    </span>
  )
}

export default function NewsView({ data, onOpenPath, imgBySym }) {
  const { t } = useTranslation()
  const news = data?.news || []
  const [filter, setFilter] = useState('all')

  const cryptoSources = useMemo(
    () => [...new Set(news.filter((n) => n.kind !== 'wire').map((n) => n.source).filter(Boolean))].slice(0, 3),
    [news],
  )
  const hasWire = news.some((n) => n.kind === 'wire')
  const hasCrypto = news.some((n) => n.kind !== 'wire')

  const shown = useMemo(() => {
    if (filter === 'all') return news
    if (filter === 'wire') return news.filter((n) => n.kind === 'wire')
    if (filter === 'crypto') return news.filter((n) => n.kind !== 'wire')
    return news.filter((n) => n.source === filter)
  }, [news, filter])

  // Lead = the most important wire story of the last 18h if it clears the
  // Breaking bar, otherwise the newest story that has art. Never the same
  // story twice on one screen.
  const lead = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const fresh = shown.filter((n) => n.publishedOn && now - n.publishedOn < LEAD_MAX_AGE_SEC)
    const hot = fresh.filter((n) => n.kind === 'wire' && Number.isFinite(n.importance) && n.importance >= BREAKING_MIN)
      .sort((a, b) => b.importance - a.importance)[0]
    return hot || fresh.find((n) => n.image) || shown[0] || null
  }, [shown])
  // The wire's place rules give every Russia story the same Moscow photo - five
  // identical thumbs in a row read as a broken feed, so a photo already on
  // screen is not repeated: the row simply runs text-only.
  const rows = useMemo(() => {
    const seen = new Set(lead?.image ? [lead.image] : [])
    return (lead ? shown.filter((n) => n.id !== lead.id) : shown).map((n) => {
      if (!n.image) return n
      if (seen.has(n.image)) return { ...n, image: null }
      seen.add(n.image)
      return n
    })
  }, [shown, lead])

  // Rail reads the WHOLE wire, not the filtered slice - it is the room's mood.
  const rail = useMemo(() => {
    const wire = news.filter((n) => n.kind === 'wire')
    const tally = { bullish: 0, bearish: 0, neutral: 0 }
    for (const w of wire) tally[w.sentiment === 'bullish' || w.sentiment === 'bearish' ? w.sentiment : 'neutral'] += 1
    const breaking = wire.filter((w) => Number.isFinite(w.importance) && w.importance >= BREAKING_MIN)
      .sort((a, b) => b.importance - a.importance).slice(0, 3)
    const shocks = wire.filter((w) => Number.isFinite(w.importance) && w.importance >= WIRE_SHOCK_MIN).length
    const assetCount = new Map()
    for (const n of news) for (const k of tickersOf(n, imgBySym)) assetCount.set(k, (assetCount.get(k) || 0) + 1)
    const assets = [...assetCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    return { wire, tally, breaking, shocks, assets }
  }, [news, imgBySym])
  const tallyTotal = rail.tally.bullish + rail.tally.bearish + rail.tally.neutral

  const filters = [
    { id: 'all', label: tl(t, 'All', 'opt') },
    hasWire ? { id: 'wire', label: 'Macro Wire' } : null,
    hasCrypto ? { id: 'crypto', label: tl(t, 'Crypto', 'opt') } : null,
    ...cryptoSources.map((s) => ({ id: s, label: s })),
  ].filter(Boolean)

  const openPro = () => { track(Events.LITE_PRO_DOOR, { path: '/news' }); onOpenPath?.('/news') }

  return (
    <div className="lite-view lite-nw">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'News', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, "Today's headlines, no doomscrolling.", 'sub')}</p>
      </header>

      {filters.length > 2 && (
        <div className="lite-tf-toggle lite-rise" role="tablist" aria-label={t('lite.newsview.ariaSource', "Source")}>
          {filters.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`lite-tf-btn${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      )}

      <div className="lite-nw-grid lite-rise-1">
        <div className="lite-nw-main">
          {news.length === 0 ? (
            <section className="lite-panel"><Skel n={8} /></section>
          ) : (
            <>
              {lead && (
                <a {...linkProps(lead)} className={`lite-panel lite-nw-lead${lead.image ? '' : ' lite-nw-lead--bare'}`}>
                  {lead.image && <img className="lite-nw-lead-art" src={lead.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement.classList.add('lite-nw-lead--bare') }} />}
                  <span className="lite-nw-lead-body">
                    <Chips item={lead} t={t} />
                    <strong className="lite-nw-lead-title">{lead.title}</strong>
                    {lead.summary && <span className="lite-nw-lead-blurb">{lead.summary}</span>}
                    <Meta item={lead} t={t} imgBySym={imgBySym} />
                  </span>
                </a>
              )}
              <section className="lite-panel lite-nw-feed">
                {rows.length === 0 ? (
                  <p className="lite-empty">{tl(t, 'Nothing else from this source right now.', 'msg')}</p>
                ) : (
                  <ul className="lite-nw-list">
                    {rows.map((item) => (
                      <li key={item.id}>
                        <a {...linkProps(item)} className="lite-nw-row">
                          <span className="lite-nw-row-body">
                            <Chips item={item} t={t} />
                            <span className="lite-nw-title">{item.title}</span>
                            {item.summary && <span className="lite-nw-blurb">{item.summary}</span>}
                            <Meta item={item} t={t} imgBySym={imgBySym} />
                          </span>
                          {item.image && <img className="lite-nw-thumb" src={item.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        <aside className="lite-nw-rail">
          <section className="lite-panel lite-nw-rail-panel">
            <p className="lite-eyebrow">{tl(t, 'Wire pulse', 'lbl')} <span className="lite-nw-eyebrow-note">48h</span></p>
            {rail.wire.length === 0 ? (
              <p className="lite-empty">{tl(t, 'The wire is warming up.', 'msg')}</p>
            ) : (
              <>
                <div className="lite-nw-pulse" role="img" aria-label={`${rail.tally.bullish} bullish, ${rail.tally.neutral} neutral, ${rail.tally.bearish} bearish`}>
                  <span className="up" style={{ flex: rail.tally.bullish || 0.0001 }} />
                  <span className="flat" style={{ flex: rail.tally.neutral || 0.0001 }} />
                  <span className="down" style={{ flex: rail.tally.bearish || 0.0001 }} />
                </div>
                <ul className="lite-nw-tally">
                  <li><b className="lite-nw-sent up" /><strong>{rail.tally.bullish}</strong><span>{tl(t, 'bullish', 'msg')}</span></li>
                  <li><b className="lite-nw-sent flat" /><strong>{rail.tally.neutral}</strong><span>{tl(t, 'neutral', 'msg')}</span></li>
                  <li><b className="lite-nw-sent down" /><strong>{rail.tally.bearish}</strong><span>{tl(t, 'bearish', 'msg')}</span></li>
                </ul>
                <p className="lite-nw-pulse-note">
                  {rail.shocks > 0
                    ? `${rail.shocks} ${tl(t, rail.shocks === 1 ? 'macro shock in the last 48 hours' : 'macro shocks in the last 48 hours', 'msg')}`
                    : tl(t, 'No macro shocks in the last 48 hours.', 'msg')}
                  {tallyTotal > 0 ? ` ${tl(t, 'Read of', 'msg')} ${tallyTotal} ${tl(t, 'wire stories', 'msg')}.` : ''}
                </p>
              </>
            )}
          </section>

          <section className="lite-panel lite-nw-rail-panel">
            <p className="lite-eyebrow">{tl(t, 'Breaking now', 'lbl')}</p>
            {rail.breaking.length === 0 ? (
              <p className="lite-empty">{tl(t, 'Quiet wire. Nothing above the breaking bar.', 'msg')}</p>
            ) : (
              <ul className="lite-nw-breaking">
                {rail.breaking.map((w) => (
                  <li key={w.id}>
                    <a href={w.wirePath}>
                      <span className="lite-nw-imp" style={{ '--nw-k': (WIRE_KINDS[w.category] || WIRE_KINDS.macro).color }}><i style={{ width: `${Math.min(100, w.importance)}%` }} /></span>
                      <strong>{w.title}</strong>
                      <span>{(WIRE_KINDS[w.category] || WIRE_KINDS.macro).label} · {liteTimeAgo(w.publishedOn, t)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {rail.assets.length > 0 && (
            <section className="lite-panel lite-nw-rail-panel">
              <p className="lite-eyebrow">{tl(t, 'In the headlines', 'lbl')}</p>
              <ul className="lite-nw-inhead">
                {rail.assets.map(([sym, n]) => (
                  <li key={sym}>
                    <span className="lite-nw-inhead-id">
                      {imgBySym?.[sym] ? <img src={imgBySym[sym]} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <b>{sym[0]}</b>}
                      <strong>{sym}</strong>
                    </span>
                    <span>{n} {tl(t, n === 1 ? 'story' : 'stories', 'msg')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {onOpenPath && (
        <button type="button" className="lite-prolink" onClick={openPro}>
          {tl(t, 'The full newsroom in PRO', 'msg')}<ArrowIcon />
        </button>
      )}
    </div>
  )
}
