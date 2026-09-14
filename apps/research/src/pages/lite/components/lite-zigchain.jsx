/**
 * lite-zigchain.jsx - the ZIGChain view of LITE (partner-chain hub, one screen).
 *
 * Reads the same hooks as the PRO page (price, TVL history) plus one author
 * fetch that covers the founder feed AND the episode reel; the PRO page's
 * 4-handle fan-out stays PRO. Ecosystem apps and partners come from the PRO
 * page's static sheet so this view finally delivers the "then the people
 * building it" half of its own subtitle.
 *
 * Layout: hero (mark + name + price) -> chain facts + links -> TVL area chart
 * full width -> [ $ZIG card | apps on the chain ] -> partners strip ->
 * [ founder feed | episodes ] -> PRO door. The two-up rows stack under 900px.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { tl } from './lite-i18n'
import { useTranslation } from 'react-i18next'
import { useZIGChainData } from '@/pages/zigchain/hooks/useZIGChainData'
import { useZIGTvlHistory } from '@/pages/zigchain/hooks/useZIGTvlHistory'
import { ZIG_LOGO_LG, ZIGCHAIN_STATIC, PROTOCOL_LOGOS, PARTNER_LOGOS, ZIG_YOUTUBE } from '@/pages/zigchain/zigchain.constants'
import { track, Events } from '@/services/analytics'
import { liteTimeAgo } from './use-lite-data'
import './lite-zigchain.css'

const changeCls = (v) => (Number(v) >= 0 ? 'up' : 'down')
const fmtChange = (v) => { const n = Number(v) || 0; return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }

const FEED_TTL = 10 * 60 * 1000
let _feedCache = null
const _fresh = (entry, ttl) => (entry && Date.now() - entry.ts < ttl ? entry.data : null)

const EPISODE_RX = /youtube|youtu\.be|spotify|apple\.co|podcasts\.apple|pca\.st|overcast\.fm|zigchain\.com|medium\.com\/zignaly/i
const TVL_RANGES = ['7D', '30D', '90D', '1Y', 'ALL']
const FOUNDER = ZIGCHAIN_STATIC.team.find((m) => m.twitter === 'ARafayGadit') || ZIGCHAIN_STATIC.team[1]

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M12 5l7 7-7 7" /></svg>
)
const OutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17L17 7M9 7h8v8" /></svg>
)

function normalizeFeed(payload) {
  const list = payload?.mentions || payload?.top_mentions || payload?.posts || payload?.tweets || payload?.timeline || payload?.author?.posts || payload?.author?.tweets || []
  const seen = new Set()
  const out = []
  for (const row of list) {
    const tw = row?.tweet || row
    const id = tw?.tweet_id || tw?.id || tw?.id_str
    const text = tw?.full_text || tw?.text
    if (!id || !text || seen.has(id)) continue
    seen.add(id)
    const outbound = (text.match(/https?:\/\/\S+/) || [])[0] || null
    const media = Array.isArray(tw?.media) ? tw.media[0] : null
    out.push({
      id,
      text,
      url: tw?.x_url || `https://x.com/ARafayGadit/status/${id}`,
      createdAt: tw?.created_at_utc || tw?.created_at || null,
      favorites: Number(tw?.favorite_count ?? tw?.likes ?? tw?.favorites) || 0,
      outbound,
      isEpisode: outbound ? EPISODE_RX.test(outbound) : false,
      imageUrl: media?.media_url_https || media?.preview_image_url || null,
    })
  }
  return out
}

// ── Area chart: real-pixel geometry, date axis, hi/lo marks, hover readout ──

function fmtTick(ts, spanDays, locale) {
  const d = new Date(ts)
  if (spanDays > 400) return d.toLocaleDateString(locale, { month: 'short', year: '2-digit' })
  if (spanDays > 3) return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

function fmtTip(ts, spanDays, locale) {
  const d = new Date(ts)
  if (spanDays > 10) return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function LiteAreaChart({ points, height = 200, fmt, locale, uid }) {
  const [w, setW] = useState(0)
  const roRef = useRef(null)
  const hostRef = useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!el) return
    const measure = () => {
      const width = el.getBoundingClientRect().width
      setW((prev) => (Math.abs(prev - width) < 1 ? prev : width))
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      roRef.current = new ResizeObserver(measure)
      roRef.current.observe(el)
    }
  }, [])
  const [hi, setHi] = useState(null)

  const geo = useMemo(() => {
    if (!Array.isArray(points) || points.length < 2 || !w) return null
    const W = w
    const H = height
    const padT = 18, padB = 30, padL = 2, padR = 2
    const n = points.length
    let min = Infinity, max = -Infinity, minI = 0, maxI = 0
    for (let i = 0; i < n; i++) {
      const v = points[i].v
      if (v < min) { min = v; minI = i }
      if (v > max) { max = v; maxI = i }
    }
    const span = max - min || Math.abs(max) || 1
    const lo = min - span * 0.14
    const top = max + span * 0.1
    const x = (i) => padL + (i * (W - padL - padR)) / (n - 1)
    const y = (v) => padT + (1 - (v - lo) / (top - lo)) * (H - padT - padB)
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
    const baseY = H - padB
    const area = `${line}L${x(n - 1).toFixed(1)},${baseY}L${x(0).toFixed(1)},${baseY}Z`
    const spanDays = (points[n - 1].t - points[0].t) / 86_400_000
    const tickCount = W < 420 ? 3 : W < 720 ? 4 : 6
    const ticks = []
    for (let k = 0; k < tickCount; k++) {
      const i = Math.round((k * (n - 1)) / (tickCount - 1))
      ticks.push({ i, x: x(i), label: fmtTick(points[i].t, spanDays, locale), anchor: k === 0 ? 'start' : k === tickCount - 1 ? 'end' : 'middle' })
    }
    const edge = (i) => (x(i) < 70 ? 'start' : x(i) > W - 70 ? 'end' : 'middle')
    return {
      W, H, x, y, line, area, baseY, spanDays, ticks,
      up: points[n - 1].v >= points[0].v,
      hiMark: { x: x(maxI), y: y(max), v: max, anchor: edge(maxI) },
      loMark: { x: x(minI), y: y(min), v: min, anchor: edge(minI) },
    }
  }, [points, w, height, locale])

  const onMove = (e) => {
    if (!geo) return
    const r = e.currentTarget.getBoundingClientRect()
    const n = points.length
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - 2) / (geo.W - 4)) * (n - 1))))
    setHi(i)
  }

  const hov = hi != null && geo && points[hi] ? { x: geo.x(hi), y: geo.y(points[hi].v), p: points[hi] } : null
  const gradId = `lzg-${uid}`

  return (
    <div className={`lite-zig-chart ${geo?.up ? 'up' : 'down'}`} ref={hostRef} style={{ height }} onPointerMove={onMove} onPointerLeave={() => setHi(null)}>
      {geo && (
        <svg width={geo.W} height={geo.H} viewBox={`0 0 ${geo.W} ${geo.H}`} aria-hidden>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="lite-zig-grad-a" />
              <stop offset="100%" className="lite-zig-grad-b" />
            </linearGradient>
          </defs>
          <path className="lite-zig-area" d={geo.area} fill={`url(#${gradId})`} />
          <line className="lite-zig-axis" x1={0} x2={geo.W} y1={geo.baseY + 0.5} y2={geo.baseY + 0.5} />
          <path className="lite-zig-line" d={geo.line} fill="none" />
          {geo.ticks.map((tk) => (
            <text key={tk.i} className="lite-zig-tick" x={tk.x} y={geo.H - 8} textAnchor={tk.anchor}>{tk.label}</text>
          ))}
          <g className={`lite-zig-ext${hov ? ' is-quiet' : ''}`}>
            <circle cx={geo.hiMark.x} cy={geo.hiMark.y} r={3} />
            <text x={geo.hiMark.x} y={geo.hiMark.y - 9} textAnchor={geo.hiMark.anchor}>{fmt(geo.hiMark.v)}</text>
            <circle cx={geo.loMark.x} cy={geo.loMark.y} r={3} />
            <text x={geo.loMark.x} y={geo.loMark.y + 15} textAnchor={geo.loMark.anchor}>{fmt(geo.loMark.v)}</text>
          </g>
          {hov && (
            <>
              <line className="lite-zig-cross" x1={hov.x} x2={hov.x} y1={6} y2={geo.baseY} />
              <circle className="lite-zig-dot" cx={hov.x} cy={hov.y} r={4.5} />
            </>
          )}
        </svg>
      )}
      {hov && (
        <div className="lite-zig-tip" data-side={hov.x > geo.W * 0.68 ? 'left' : 'right'} style={{ left: hov.x }}>
          <strong>{fmt(hov.p.v)}</strong>
          <span>{fmtTip(hov.p.t, geo.spanDays, locale)}</span>
        </div>
      )}
    </div>
  )
}

// Logo circle with a letter fallback - a wrong or dead logo is worse than a letter.
// White-on-transparent wordmarks (Zamanat) vanish on the paper tile - give them a dark one.
const DARK_MARKS = new Set(['Zamanat'])

function Mark({ src, name, className = '' }) {
  const [ok, setOk] = useState(Boolean(src))
  useEffect(() => { setOk(Boolean(src)) }, [src])
  return (
    <span className={`lite-zig-mark${DARK_MARKS.has(name) ? ' lite-zig-mark--dark' : ''} ${className}`}>
      {ok ? <img src={src} alt="" loading="lazy" onError={() => setOk(false)} /> : <b>{(name || '?')[0]}</b>}
    </span>
  )
}

function Skel({ n = 4 }) {
  return (
    <ul className="lite-skel" aria-hidden>
      {Array.from({ length: n }).map((_, i) => <li key={i} className="lite-skel-row" style={{ animationDelay: `${i * 80}ms` }} />)}
    </ul>
  )
}

const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

export default function ZigView({ fmtPrice, fmtLargeShort, onOpenPath, onPickResearch }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const { price, marketData, sparkline, loading } = useZIGChainData()
  const [tvlRange, setTvlRange] = useState('90D')
  const tvl = useZIGTvlHistory(tvlRange)
  const [feed, setFeed] = useState(() => _fresh(_feedCache, FEED_TTL))

  useEffect(() => {
    if (_fresh(_feedCache, FEED_TTL)) return undefined
    let cancelled = false
    import('@/pages/zigchain/components/xdash-author-cache')
      .then(({ getXDashAuthor }) => getXDashAuthor('ARafayGadit'))
      .then((payload) => {
        if (cancelled || !payload) return
        const rows = normalizeFeed(payload)
        if (rows.length > 0) _feedCache = { ts: Date.now(), data: rows }
        setFeed(rows)
      })
      .catch(() => { if (!cancelled) setFeed([]) })
    return () => { cancelled = true }
  }, [])

  // The author feed mixes in reply spam with no author field to filter on -
  // prefer posts that actually talk about ZIG, and always drop giveaway bait.
  const clean = (feed || []).filter((r) => !/giv(e|ing)\s*away/i.test(r.text))
  const relevant = clean.filter((r) => /zig/i.test(r.text) || r.isEpisode || r.imageUrl)
  const pool = relevant.length >= 2 ? relevant : clean
  const episodes = pool.filter((r) => r.isEpisode || r.imageUrl).slice(0, 4)
  const tweets = pool.slice(0, 4)

  const tvlPoints = useMemo(
    () => tvl.points.map((p) => ({ t: p.ts > 1e12 ? p.ts : p.ts * 1000, v: p.tvl })),
    [tvl.points],
  )
  const pricePoints = useMemo(() => {
    if (!Array.isArray(sparkline) || sparkline.length < 10) return null
    const n = sparkline.length
    const now = Date.now()
    return sparkline.map((v, i) => ({ t: now - (n - 1 - i) * 3_600_000, v: Number(v) }))
  }, [sparkline])

  const perf = [
    { l: '24H', v: Number(price?.change24h) },
    { l: '7D', v: Number(marketData?.change7d) },
    { l: '30D', v: Number(marketData?.change30d) },
    { l: 'ATH', v: Number(marketData?.athChangePercent) },
  ].filter((c) => Number.isFinite(c.v))

  const { chain, ecosystem, protocols, partnerships } = ZIGCHAIN_STATIC
  const facts = [
    `${chain.framework} L1`,
    chain.evmCompatible ? tl(t, 'EVM compatible', 'msg') : null,
    ecosystem.shariahCertified ? tl(t, 'Shariah certified', 'msg') : null,
    `${tl(t, 'Mainnet', 'msg')} ${chain.mainnetLaunch}`,
  ].filter(Boolean)
  const links = [
    { label: tl(t, 'Website', 'msg'), url: 'https://zigchain.com/' },
    { label: 'X', url: 'https://x.com/zigchain' },
    { label: tl(t, 'Docs', 'msg'), url: chain.docs },
    { label: tl(t, 'Explorer', 'msg'), url: chain.explorerAlt },
    { label: 'Hub', url: chain.hub },
  ]
  const reel = episodes.length > 0
    ? episodes.map((ep) => ({ key: `ep-${ep.id}`, url: ep.outbound || ep.url, img: ep.imageUrl, title: ep.text, meta: ep.createdAt ? liteTimeAgo(Math.floor(new Date(ep.createdAt).getTime() / 1000), t) : '' }))
    : ZIG_YOUTUBE.videos.slice(0, 4).map((v) => ({ key: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, img: ytThumb(v.id), title: v.title, meta: `${v.tag} · ${v.date}` }))

  const openPro = () => { track(Events.LITE_PRO_DOOR, { path: '/zigchain' }); onOpenPath?.('/zigchain') }

  return (
    <div className="lite-view lite-zig">
      <header className="lite-zig-hero lite-rise">
        <div className="lite-zig-hero-id">
          <span className="lite-zig-logo"><img src={ZIG_LOGO_LG} alt="" /></span>
          <div className="lite-zig-hero-text">
            <h1 className="lite-view-title">ZIGChain</h1>
            <p className="lite-view-sub">{tl(t, 'How much money lives on the chain - then the coin, then the people building it.', 'sub')}</p>
          </div>
        </div>
        {price?.usd != null && (
          <div className="lite-zig-hero-price">
            <em>$ZIG</em>
            <strong>{fmtPrice(price.usd)}</strong>
            <span className={`lite-change ${changeCls(price.change24h)}`}>{fmtChange(price.change24h)} <i>24h</i></span>
          </div>
        )}
      </header>

      <div className="lite-zig-facts lite-rise-1">
        <ul className="lite-zig-tags">
          {facts.map((f) => <li key={f}>{f}</li>)}
        </ul>
        <div className="lite-chips lite-zig-links">
          {links.map((l) => (
            <a key={l.url} className="lite-chip" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}<OutIcon /></a>
          ))}
        </div>
      </div>

      <section className="lite-panel lite-zig-tvl lite-rise-1">
        <div className="lite-zig-head">
          <div>
            <p className="lite-eyebrow">{tl(t, 'Value locked on ZIGChain', 'lbl')}</p>
            {tvl.stats?.current > 0 && (
              <p className="lite-zig-big">
                <strong>{fmtLargeShort(tvl.stats.current)}</strong>
                {Number.isFinite(tvl.stats.change) && (
                  <span className={`lite-change ${changeCls(tvl.stats.change)}`}>{fmtChange(tvl.stats.change)} <i>{tvlRange}</i></span>
                )}
              </p>
            )}
          </div>
          <div className="lite-tf-toggle lite-tf-toggle--sm lite-tf-toggle--fit" role="tablist" aria-label={t('lite.zigview.ariaTvlRange', "TVL range")}>
            {TVL_RANGES.map((r) => (
              <button key={r} type="button" role="tab" aria-selected={tvlRange === r} className={`lite-tf-btn${tvlRange === r ? ' active' : ''}`} onClick={() => setTvlRange(r)}>{r}</button>
            ))}
          </div>
        </div>
        {tvl.loading && tvlPoints.length < 3 ? <Skel n={4} /> : tvlPoints.length > 2 ? (
          <LiteAreaChart points={tvlPoints} height={230} fmt={fmtLargeShort} locale={locale} uid="tvl" />
        ) : (
          <p className="lite-empty">{tl(t, 'TVL data is warming up.', 'msg')}</p>
        )}
        <p className="lite-social-note">{tl(t, 'Total value locked in ZIGChain apps. This is the health line of the chain - deposits people trust it with, not the coin price.', 'msg')}</p>
      </section>

      <div className="lite-zig-two lite-rise-2">
        <section className="lite-panel lite-zig-coin">
          <div className="lite-zig-head">
            <div className="lite-zig-head-id">
              <Mark src={ZIG_LOGO_LG} name="ZIG" className="lite-zig-mark--sm" />
              <div>
                <p className="lite-eyebrow">$ZIG</p>
                <span className="lite-zig-head-sub">{tl(t, 'Last 7 days', 'msg')}</span>
              </div>
            </div>
            {Number.isFinite(Number(marketData?.change7d)) && (
              <span className={`lite-zig-pill ${changeCls(marketData.change7d)}`}>{fmtChange(marketData.change7d)}</span>
            )}
          </div>
          {loading && price?.usd == null ? <Skel n={4} /> : (
            <>
              {pricePoints && <LiteAreaChart points={pricePoints} height={150} fmt={fmtPrice} locale={locale} uid="px" />}
              <div className="lite-zig-stats">
                {Number(price?.marketCap) > 0 && (
                  <div className="lite-zig-stat"><em>{tl(t, 'Market cap', 'lbl')}</em><strong>{fmtLargeShort(price.marketCap)}</strong>{marketData?.marketCapRank ? <span>#{marketData.marketCapRank} {tl(t, 'by size', 'msg')}</span> : null}</div>
                )}
                {Number(price?.volume24h) > 0 && (
                  <div className="lite-zig-stat"><em>{tl(t, 'Traded today', 'lbl')}</em><strong>{fmtLargeShort(price.volume24h)}</strong><span>{tl(t, '24h volume', 'msg')}</span></div>
                )}
                {Number(marketData?.fdv) > 0 && (
                  <div className="lite-zig-stat"><em>FDV</em><strong>{fmtLargeShort(marketData.fdv)}</strong><span>{tl(t, 'fully diluted', 'msg')}</span></div>
                )}
              </div>
              {perf.length > 0 && (
                <ul className="lite-zig-perf">
                  {perf.map((c) => (
                    <li key={c.l}><em>{c.l}</em><strong className={changeCls(c.v)}>{fmtChange(c.v)}</strong></li>
                  ))}
                </ul>
              )}
              {onPickResearch && (
                <button type="button" className="lite-prolink lite-prolink--inline" onClick={() => onPickResearch('ZIG')}>
                  {tl(t, 'Open ZIG in Research', 'msg')}<ArrowIcon />
                </button>
              )}
            </>
          )}
        </section>

        <section className="lite-panel lite-zig-eco">
          <div className="lite-zig-head">
            <div>
              <p className="lite-eyebrow">{tl(t, 'Built on ZIGChain', 'lbl')}</p>
              <span className="lite-zig-head-sub">{protocols.length} {tl(t, 'apps live on the chain', 'msg')}</span>
            </div>
          </div>
          <ul className="lite-zig-apps">
            {protocols.map((p) => (
              <li key={p.name}>
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  <Mark src={PROTOCOL_LOGOS[p.name]} name={p.name} />
                  <span className="lite-zig-app-id"><strong>{p.name}</strong><em>{p.category}</em></span>
                  <span className="lite-zig-app-metric">{p.tvlEstimate ? `${fmtLargeShort(p.tvlEstimate)} TVL` : p.metrics}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="lite-panel lite-zig-partners-panel lite-rise-2">
        <div className="lite-zig-head">
          <div>
            <p className="lite-eyebrow">{tl(t, 'Partners & institutions', 'lbl')}</p>
            <span className="lite-zig-head-sub">{tl(t, 'Who is bringing real-world assets onto the chain', 'msg')}</span>
          </div>
        </div>
        <ul className="lite-zig-partners">
          {partnerships.slice(0, 8).map((p) => (
            <li key={p.name}>
              <Mark src={PARTNER_LOGOS[p.name]} name={p.name} />
              <strong>{p.name}</strong>
              <span>{String(p.stat).split(' · ')[0]}</span>
              <em>{String(p.role).split(' · ')[0]}</em>
            </li>
          ))}
        </ul>
      </section>

      <div className="lite-zig-two lite-rise-3">
        <section className="lite-panel lite-zig-founder">
          <div className="lite-zig-head">
            <div className="lite-zig-head-id">
              <Mark src={FOUNDER.avatar} name={FOUNDER.name} />
              <div>
                <p className="lite-eyebrow">{tl(t, 'From the founder', 'lbl')}</p>
                <span className="lite-zig-head-sub">{FOUNDER.name} · @{FOUNDER.twitter}</span>
              </div>
            </div>
          </div>
          {!feed ? <Skel n={4} /> : tweets.length === 0 ? (
            <p className="lite-empty">{tl(t, 'No recent posts captured.', 'msg')}</p>
          ) : (
            <ul className="lite-zig-feed">
              {tweets.map((tw) => (
                <li key={tw.id}>
                  <a href={tw.url} target="_blank" rel="noopener noreferrer">
                    <p>{tw.text}</p>
                    <span className="lite-zig-meta">
                      {tw.createdAt ? liteTimeAgo(Math.floor(new Date(tw.createdAt).getTime() / 1000), t) : ''}
                      {tw.favorites > 0 ? ` · ${tw.favorites.toLocaleString()} ${tl(t, 'likes', 'msg')}` : ''}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="lite-panel lite-zig-reel">
          <div className="lite-zig-head">
            <div>
              <p className="lite-eyebrow">{tl(t, 'Episodes & links', 'lbl')}</p>
              <span className="lite-zig-head-sub">{episodes.length > 0 ? tl(t, 'Shared by the founder', 'msg') : tl(t, 'Talks and interviews', 'msg')}</span>
            </div>
          </div>
          <ul className="lite-zig-feed lite-zig-feed--reel">
            {reel.map((ep) => (
              <li key={ep.key}>
                <a href={ep.url} target="_blank" rel="noopener noreferrer">
                  {ep.img && <img src={ep.img} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
                  <div>
                    <p>{ep.title}</p>
                    <span className="lite-zig-meta">{ep.meta}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {onOpenPath && (
        <button type="button" className="lite-prolink" onClick={openPro}>
          {tl(t, 'ZIGChain in PRO', 'msg')}<ArrowIcon />
        </button>
      )}
    </div>
  )
}
