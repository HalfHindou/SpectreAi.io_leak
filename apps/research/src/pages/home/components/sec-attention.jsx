/**
 * SecAttention — the Sectors tab, rebuilt around attention.
 *
 * Two views of one feed (founder picked both, 08-18):
 *   list — a hero card for whatever owns the tape, then one row per narrative
 *   map  — every narrative as a block sized by its share of the conversation
 *
 * Both answer the same four questions at a glance: what is moving, what has
 * momentum, what is fading, and which names are carrying it. Token art comes
 * from the feed itself, so the surface shows real coins rather than initials.
 */
import { createContext, memo, useContext, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './sec-attention.css'

/**
 * Which window the rows describe. The box's 24h narrative window can be empty
 * (see the trap note in use-narrative-attention), and the hook then hands over
 * the 7d one — in that mode there is no second window to divide by, so no card
 * may print an acceleration reading. Carried as context because every level of
 * the panel draws a chip and threading a flag through four components to say
 * "do not invent a multiplier" is worse than one provider.
 */
const WindowCtx = createContext('24h')
const useWideWindow = () => useContext(WindowCtx) === '7d'

const fmtInt = (n) => (n >= 1000 ? n.toLocaleString('en-US') : String(n))
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`

/** Above 1 the narrative is pulling more attention than yesterday. */
function toneOf(accel) {
  if (accel == null) return 'new'
  if (accel >= 1.02) return 'up'
  if (accel <= 0.98) return 'down'
  return 'flat'
}

function AccelChip({ accel, size = 'sm' }) {
  const { t } = useTranslation()
  const wide = useWideWindow()
  const tone = toneOf(accel)
  // Unrated in 7d mode is not "new", it is "unknowable" — draw nothing.
  if (tone === 'new') return wide ? null : <span className={`seca-chip seca-chip--new seca-chip--${size}`}>{t('homePage.secAttention.accelchip.new', "new")}</span>
  return (
    <span className={`seca-chip seca-chip--${tone} seca-chip--${size}`}>
      {tone === 'up' ? '↑ ' : tone === 'down' ? '↓ ' : ''}{accel.toFixed(2)}&times;
    </span>
  )
}

/** Overlapping coin art, biggest velocity first. Falls back to the ticker. */
function LeaderStack({ leaders, size = 30, max = 3 }) {
  const shown = leaders.slice(0, max)
  if (shown.length === 0) return null
  return (
    <div className="seca-stack" style={{ paddingLeft: Math.round(size * 0.3) }}>
      {shown.map((l) => (
        <span
          key={l.symbol}
          className="seca-coin"
          style={{ width: size, height: size, marginLeft: -Math.round(size * 0.3) }}
          title={`${l.symbol}${l.velocity != null ? ` — ${l.velocity.toFixed(2)}x mentions vs its own prior day` : ''}`}
        >
          {l.image
            ? <img src={l.image} alt="" loading="lazy" decoding="async" width={size} height={size} onError={(e) => { e.currentTarget.style.display = 'none' }} />
            : <span className="seca-coin-fallback" style={{ fontSize: Math.round(size * 0.36) }}>{l.symbol.slice(0, 2)}</span>}
        </span>
      ))}
    </div>
  )
}

/**
 * The one name inside a narrative whose own mentions are running hot. Price
 * rides alongside because attention and price disagreeing is the interesting
 * case — a 2.5x in mentions on a -3% tape is a different story from both up.
 */
function TopMover({ leaders }) {
  const runner = leaders.find((l) => l.velocity != null && l.velocity >= 1.4)
  if (!runner) return null
  const chg = runner.change24
  return (
    <span className="seca-runner">
      {runner.symbol} {runner.velocity.toFixed(1)}&times;
      {chg != null && (
        <span className={`seca-runner-px ${chg >= 0 ? 'is-up' : 'is-down'}`}>
          {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
        </span>
      )}
    </span>
  )
}

/* ── LIST ─────────────────────────────────────────────────────────────────── */
function AttentionList({ narratives, onOpen }) {
  const { t } = useTranslation()
  const [hero, ...rest] = narratives
  if (!hero) return null
  const heroTone = toneOf(hero.accel)
  return (
    <div className="seca-list">
      <button type="button" className={`seca-hero seca-tone-${heroTone}`} onClick={() => onOpen?.(hero)}>
        <LeaderStack leaders={hero.leaders} size={52} />
        <span className="seca-hero-body">
          <span className="seca-hero-top">
            <span className="seca-hero-name">{hero.label}</span>
            <AccelChip accel={hero.accel} size="lg" />
          </span>
          <span className="seca-hero-sub">
            {fmtInt(hero.mentions24)} mentions from {fmtInt(hero.authors)} accounts &middot; {hero.tokenCount} names, {pct(hero.freshShare, 0)} of them new
          </span>
          <span className="seca-hero-meter">
            <span className="seca-meter-track">
              <span className={`seca-meter-fill seca-tone-${heroTone}`} style={{ width: pct(hero.share) }} />
            </span>
            <span className="seca-cap">{t('homePage.secAttention.attentionlist.shareOfAllAttention', "share of all attention")}</span>
          </span>
        </span>
        <span className="seca-hero-figure">
          <span className="seca-hero-pct">{(hero.share * 100).toFixed(1)}<i>%</i></span>
          <TopMover leaders={hero.leaders} />
          <span className="seca-hero-open">See the {hero.tokenCount} names
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </span>
        </span>
      </button>

      <div className="seca-rows">
        {rest.map((n) => {
          const tone = toneOf(n.accel)
          return (
            <button type="button" key={n.id} className="seca-row" onClick={() => onOpen?.(n)}>
              <LeaderStack leaders={n.leaders} size={30} max={3} />
              <span className="seca-row-id">
                <span className="seca-row-name">{n.label}</span>
                <span className="seca-row-sub">{fmtInt(n.mentions24)} mentions &middot; {n.tokenCount} names</span>
              </span>
              <span className="seca-meter-track seca-row-meter">
                <span className={`seca-meter-fill seca-tone-${tone}`} style={{ width: `${Math.min(100, (n.share / (hero.share || 1)) * 100)}%` }} />
              </span>
              <span className="seca-row-pct">{(n.share * 100).toFixed(1)}<i>%</i></span>
              <AccelChip accel={n.accel} />
              <span className="seca-go" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── MAP ──────────────────────────────────────────────────────────────────── */
/**
 * Squarified-ish treemap: rows are filled until the next block would get too
 * thin, so area stays proportional to share without a layout library.
 */
function layoutBlocks(narratives, W, H) {
  const total = narratives.reduce((s, n) => s + n.mentions24, 0) || 1
  const area = W * H
  const items = narratives.map((n) => ({ n, a: (n.mentions24 / total) * area }))
  const out = []
  let y = 0
  let i = 0
  while (i < items.length && y < H - 4) {
    const remainingArea = items.slice(i).reduce((s, it) => s + it.a, 0)
    const remainingH = H - y
    let row = [items[i]]
    let rowArea = items[i].a
    // Take more into this row while each block stays wider than it is tall-ish.
    while (i + row.length < items.length) {
      const next = items[i + row.length]
      const h = Math.min(remainingH, (rowArea + next.a) / W)
      const thinnest = Math.min(...row.concat(next).map((it) => it.a / h))
      if (thinnest < 168 && row.length >= 1) break
      row = row.concat(next)
      rowArea += next.a
    }
    let h = Math.min(remainingH, rowArea / W)
    if (i + row.length >= items.length) h = remainingH
    let x = 0
    row.forEach((it, idx) => {
      const w = idx === row.length - 1 ? W - x : Math.max(70, (it.a / rowArea) * W)
      out.push({ ...it.n, x, y, w: Math.max(0, w - 8), h: Math.max(0, h - 8) })
      x += w
    })
    y += h
    i += row.length
    if (remainingArea <= 0) break
  }
  return out
}

function AttentionMap({ narratives, onOpen }) {
  const blocks = useMemo(() => layoutBlocks(narratives, 1000, 520), [narratives])
  return (
    <div className="seca-map" style={{ aspectRatio: '1000 / 520' }}>
      {blocks.map((b) => {
        const tone = toneOf(b.accel)
        const big = b.w > 300 && b.h > 190
        const mid = !big && b.h > 110
        return (
          <button
            type="button"
            key={b.id}
            className={`seca-block seca-tone-${tone}${big ? ' is-hero' : ''}${mid ? ' is-mid' : ''}`}
            style={{ left: `${(b.x / 1000) * 100}%`, top: `${(b.y / 520) * 100}%`, width: `${(b.w / 1000) * 100}%`, height: `${(b.h / 520) * 100}%` }}
            onClick={() => onOpen?.(b)}
          >
            <span className="seca-block-head">
              {(big || mid) && <LeaderStack leaders={b.leaders} size={big ? 44 : 24} max={big ? 3 : 2} />}
              <span className="seca-block-name">{b.label}</span>
              <AccelChip accel={b.accel} size={big ? 'lg' : 'sm'} />
            </span>
            <span className="seca-block-foot">
              <span className="seca-block-pct">{(b.share * 100).toFixed(1)}<i>%</i></span>
              {big
                ? <span className="seca-block-sub">{fmtInt(b.mentions24)} mentions &middot; {fmtInt(b.authors)} accounts</span>
                : b.w >= 200 ? <TopMover leaders={b.leaders} /> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ── DETAIL ───────────────────────────────────────────────────────────────── */
const fmtCap = (v) => {
  if (!Number.isFinite(v) || v <= 0) return null
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${Math.round(v)}`
}

/**
 * One narrative, opened. The list answers "how big is this"; this answers the
 * question that follows — WHICH names are carrying it, how hard each one is
 * running against its own prior day, what price did while that happened, and
 * which accounts are doing the posting. Every name is a door into Research Zone.
 */
function NarrativeDetail({ n, onBack, onOpenToken }) {
  const { t } = useTranslation()
  const tone = toneOf(n.accel)
  const names = n.leaders

  // The same account often carries several names in one narrative — collapse
  // to one row per handle, loudest first.
  const voices = useMemo(() => {
    const by = new Map()
    for (const l of names) {
      for (const a of (l.authors || [])) {
        const prev = by.get(a.handle)
        if (prev) prev.mentions += a.mentions
        else by.set(a.handle, { ...a })
      }
    }
    return [...by.values()].sort((a, b) => b.mentions - a.mentions).slice(0, 6)
  }, [names])

  return (
    <div className="seca-detail">
      <div className="seca-detail-id">
        <button type="button" className="seca-back ui-glass" onClick={onBack} aria-label={t('homePage.secAttention.narrativedetail.ariaBackToAllNarratives', "Back to all narratives")}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <LeaderStack leaders={names} size={40} max={3} />
        <span className="seca-detail-title">
          <span className="seca-detail-name">{n.label}</span>
          <AccelChip accel={n.accel} size="lg" />
        </span>
        <span className="seca-detail-figure">
          <span className={`seca-detail-pct seca-tone-${tone}`}>{(n.share * 100).toFixed(1)}<i>%</i></span>
          <span className="seca-cap">{t('homePage.secAttention.narrativedetail.ofAllAttention', "of all attention")}</span>
        </span>
      </div>

      {n.description && <p className="seca-detail-desc">{n.description}</p>}

      <div className="seca-detail-stats">
        <span className="seca-stat"><b>{fmtInt(n.mentions24)}</b> {t('homePage.secAttention.narrativedetail.mentions', "mentions")}</span>
        <span className="seca-stat"><b>{fmtInt(n.authors)}</b> {t('homePage.secAttention.narrativedetail.accounts', "accounts")}</span>
        <span className="seca-stat"><b>{n.tokenCount}</b> {t('homePage.secAttention.narrativedetail.names', "names")}</span>
        <span className="seca-stat"><b>{pct(n.freshShare, 0)}</b> {t('homePage.secAttention.narrativedetail.ofThemNew', "of them new")}</span>
        {n.priorDaily != null && <span className="seca-stat"><b>{fmtInt(n.priorDaily)}</b> {t('homePage.secAttention.narrativedetail.aDayBeforeThis', "a day before this")}</span>}
      </div>

      <div className="seca-names">
        <span className="seca-cap seca-names-cap">{t('homePage.secAttention.narrativedetail.theNamesCarryingIt', "The names carrying it")}</span>
        {names.map((l) => {
          const cap = fmtCap(l.marketCap)
          return (
            <button type="button" key={l.symbol} className="seca-name" onClick={() => onOpenToken?.(l)}>
              <span className="seca-coin seca-name-art" style={{ width: 30, height: 30 }}>
                {l.image
                  ? <img src={l.image} alt="" loading="lazy" decoding="async" width={30} height={30} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                  : <span className="seca-coin-fallback" style={{ fontSize: 11 }}>{l.symbol.slice(0, 2)}</span>}
              </span>
              <span className="seca-name-id">
                <span className="seca-name-sym">${l.symbol}</span>
                <span className="seca-name-full">{l.name}</span>
              </span>
              <span className="seca-name-mentions">
                {fmtInt(l.mentions24)}<i> {t('homePage.secAttention.narrativedetail.mentions', "mentions")}</i>
                {l.authors24 > 0 && <em> · {fmtInt(l.authors24)} accounts</em>}
              </span>
              <AccelChip accel={l.velocity} />
              {l.change24 != null
                ? <span className={`seca-name-px ${l.change24 >= 0 ? 'is-up' : 'is-down'}`}>{l.change24 >= 0 ? '+' : ''}{l.change24.toFixed(1)}%</span>
                : <span className="seca-name-px is-none">—</span>}
              <span className="seca-name-cap">{cap || ''}</span>
            </button>
          )
        })}
      </div>

      {voices.length > 0 && (
        <div className="seca-voices">
          <span className="seca-cap">{t('homePage.secAttention.narrativedetail.loudestAccounts', "Loudest accounts")}</span>
          <span className="seca-voices-row">
            {voices.map((a) => (
              <a
                key={a.handle}
                className="seca-voice"
                href={`https://x.com/${a.handle}`}
                target="_blank"
                rel="noreferrer"
                title={`${a.name || a.handle} — ${fmtInt(a.mentions)} mentions · ${fmtInt(a.followers)} followers`}
              >
                {a.avatar && <img src={a.avatar} alt="" loading="lazy" decoding="async" width={20} height={20} />}
                <span>@{a.handle}</span>
                <em>{fmtInt(a.mentions)}</em>
              </a>
            ))}
          </span>
        </div>
      )}
    </div>
  )
}

/* ── SHELL ────────────────────────────────────────────────────────────────── */
const SecAttention = ({ narratives, summary, loading, onOpen, onOpenToken, compact = false, feedWindow = '24h' }) => {
  const { t } = useTranslation()
  const [mode, setMode] = useState('list')
  const [openId, setOpenId] = useState(null)
  const open = openId ? narratives.find((n) => n.id === openId) : null
  const wide = feedWindow === '7d'
  const windowLabel = wide ? 'last 7 days' : 'last 24 hours'

  const openNarrative = (n) => {
    if (!n) return
    onOpen?.(n)
    setOpenId(n.id)
  }

  if (loading && narratives.length === 0) {
    return (
      <div className="seca" aria-busy="true">
        <div className="seca-skel seca-skel-hero animate-shimmer" />
        <div className="seca-skel-rows">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className={`seca-skel seca-skel-row animate-shimmer stagger-${i + 1}`} />)}
        </div>
      </div>
    )
  }
  // Its own tab now, so "nothing to draw" has to say so — an empty panel reads
  // as a broken tab, which is exactly how it looked while the feed was slow.
  if (narratives.length === 0) {
    return (
      <div className={`seca${compact ? ' is-compact' : ''}`}>
        <div className="seca-empty">The narrative feed has nothing for the {windowLabel} yet.</div>
      </div>
    )
  }

  return (
    <WindowCtx.Provider value={feedWindow}>
    <div className={`seca${compact ? ' is-compact' : ''}`}>
      <div className="seca-head">
        <div className="seca-head-id">
          <span className="seca-cap">Where the crowd is &middot; {windowLabel}</span>
          {!compact && <h3 className="seca-title">{t('homePage.secAttention.secattention.attention', "Attention")}</h3>}
        </div>
        <div className="seca-head-right">
          {summary?.label && (
            <span className={`seca-regime seca-tone-${summary.bias === 'bullish' ? 'up' : summary.bias === 'bearish' ? 'down' : 'flat'}`}>
              {summary.label}
            </span>
          )}
          {!open && (
            <div className="seca-modes" role="tablist" aria-label={t('homePage.secAttention.secattention.ariaAttentionView', "Attention view")}>
              <button type="button" role="tab" aria-selected={mode === 'list'} className={`seca-mode ui-glass${mode === 'list' ? ' is-active' : ''}`} onClick={() => setMode('list')}>{t('homePage.secAttention.secattention.list', "List")}</button>
              <button type="button" role="tab" aria-selected={mode === 'map'} className={`seca-mode ui-glass${mode === 'map' ? ' is-active' : ''}`} onClick={() => setMode('map')}>{t('homePage.secAttention.secattention.map', "Map")}</button>
            </div>
          )}
        </div>
      </div>

      {open
        ? <NarrativeDetail n={open} onBack={() => setOpenId(null)} onOpenToken={onOpenToken} />
        : mode === 'list'
          ? <AttentionList narratives={narratives} onOpen={openNarrative} />
          : <AttentionMap narratives={narratives} onOpen={openNarrative} />}

      <div className="seca-foot">
        <span className="seca-cap">
          {summary
            ? `${fmtInt(summary.totalMentions)} mentions · ${fmtInt(summary.totalAuthors)} accounts${summary.rated ? ` · ${summary.gaining} of ${summary.rated} narratives gaining` : ''}`
            : ''}
        </span>
        <span className="seca-foot-note">
          {wide
            ? 'The 24-hour feed is empty upstream, so this is the 7-day window — no day-over-day multiplier here'
            : 'Multiplier = today\u2019s mentions against the prior daily average'}
        </span>
      </div>
    </div>
    </WindowCtx.Provider>
  )
}

export default memo(SecAttention)
