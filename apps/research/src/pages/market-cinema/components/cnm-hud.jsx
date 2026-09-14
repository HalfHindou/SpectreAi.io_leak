import { useEffect, useRef } from 'react'
import { registerTick } from '@/lib/module-ticker'
import {
  fmtAge, fmtClock, fmtCount, fmtFloorFull, fmtFloorShort, fmtUsd,
  spellDuration, whaleWord, UNKNOWN_WALLET,
} from './cnm-map'

/* Microcopy that must land verbatim (packet §HUD). Kept as constants so a
   later edit to the layout cannot quietly reword the integrity claim. */
export const PROVENANCE = 'Replay of real events, delayed 20–40 seconds. Nothing here is simulated.'
export const DUST_FOOTNOTE = 'Events under the floor are real and not shown. The feed is mostly dust.'
export const EXIT_HINT = 'Esc to leave'

/**
 * A label that re-renders itself through the module ticker: one interval for
 * the whole page, `el.textContent` writes only when the string changed, zero
 * setState. Every age and countdown on this page goes through here.
 */
function Tick({ from, fmt, className }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !from) return undefined
    return registerTick(el, (now) => fmt(now - from))
  }, [from, fmt])
  if (!from) return null
  return <span ref={ref} className={className} />
}

/* ── icons: SVG, currentColor, no icon library, no emoji ─────────────────── */
const Ico = {
  pause: <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="3" width="2.4" height="10" rx="0.7" /><rect x="9.1" y="3" width="2.4" height="10" rx="0.7" /></svg>,
  play: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 3.3v9.4a.6.6 0 0 0 .93.5l7.1-4.7a.6.6 0 0 0 0-1L6.13 2.8a.6.6 0 0 0-.93.5Z" /></svg>,
  full: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true"><path d="M2.6 6V2.6H6M10 2.6h3.4V6M13.4 10v3.4H10M6 13.4H2.6V10" /></svg>,
  exit: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" /></svg>,
  more: <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.4" cy="8" r="1.35" /><circle cx="8" cy="8" r="1.35" /><circle cx="12.6" cy="8" r="1.35" /></svg>,
}

/**
 * Every control is a transparent 44px box with the 28px visual drawn on an
 * inner span. That is the house rule (hit area from padding, never from the
 * design's size) AND the only shape that survives app-store-ready.css's
 * blanket `button { min-height: 38px }` at (0,2,1) — a designed 28px box would
 * be silently inflated, and the exemption list in that file cannot override it.
 */
function CtlBtn({ label, onClick, active, children, wide }) {
  return (
    <button
      type="button"
      className={`cnm-btn${wide ? ' cnm-btn--wide' : ''}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : !!active}
      title={label}
    >
      <span className={`cnm-btn__v${active ? ' cnm-btn__v--on' : ''}`}>{children}</span>
    </button>
  )
}

/* ── top-left: brand, live state, asset filter ───────────────────────────── */

export function CnmBrand({ liqState, asset, assets, onAsset, fact }) {
  return (
    <div className="cnm-brand">
      <div className="cnm-brand__row">
        <span className={`cnm-dot cnm-dot--${liqState}`} aria-hidden="true" />
        <span className="cnm-brand__mark">Market Cinema</span>
      </div>
      <div className="cnm-filter" role="group" aria-label="Asset">
        {['ALL', ...assets].map(a => (
          <button
            key={a}
            type="button"
            className="cnm-chip"
            aria-pressed={asset === a}
            onClick={() => onAsset(a)}
          >
            <span className={`cnm-chip__v${asset === a ? ' cnm-chip__v--on' : ''}`}>{a === 'ALL' ? 'All' : a}</span>
          </button>
        ))}
      </div>
      {fact && <p className="cnm-brand__fact">{fact}</p>}
    </div>
  )
}

/* ── top-right: floor, pause, fullscreen, exit ───────────────────────────── */

export function CnmCtl({ floor, onFloor, paused, onPause, onFullscreen, isFullscreen, onExit, onSheet }) {
  return (
    <div className="cnm-ctl">
      <CtlBtn label={`Floor ${fmtFloorFull(floor)} — cycle`} onClick={onFloor} wide>
        <span className="cnm-num">{fmtFloorShort(floor)}</span>
      </CtlBtn>
      <CtlBtn label={paused ? 'Play' : 'Pause'} onClick={onPause} active={paused}>
        {paused ? Ico.play : Ico.pause}
      </CtlBtn>
      <CtlBtn label={isFullscreen ? 'Leave fullscreen' : 'Fullscreen'} onClick={onFullscreen} active={isFullscreen}>
        {Ico.full}
      </CtlBtn>
      <CtlBtn label="Leave" onClick={onExit}>{Ico.exit}</CtlBtn>
      <button type="button" className="cnm-btn cnm-btn--sheet" onClick={onSheet} aria-label="More controls">
        <span className="cnm-btn__v">{Ico.more}</span>
      </button>
    </div>
  )
}

/* ── mobile overflow sheet (the liqp sheet pattern) ──────────────────────── */

export function CnmSheet({ open, onClose, floor, onFloor, paused, onPause, onExit }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="cnm-scrim" onClick={onClose} />
      <div className="cnm-sheet" role="dialog" aria-label="Cinema controls">
        <div className="cnm-sheet__grip" />
        <div className="cnm-sheet__row">
          <span className="cnm-sheet__label">Floor</span>
          <button type="button" className="cnm-sheet__act" onClick={onFloor}>
            <span className="cnm-num">{fmtFloorFull(floor)}</span>
          </button>
        </div>
        <div className="cnm-sheet__row">
          <span className="cnm-sheet__label">Replay</span>
          <button type="button" className="cnm-sheet__act" onClick={onPause}>{paused ? 'Play' : 'Pause'}</button>
        </div>
        <div className="cnm-sheet__row">
          <span className="cnm-sheet__label">Leave</span>
          <button type="button" className="cnm-sheet__act" onClick={onExit}>Close cinema</button>
        </div>
      </div>
    </>
  )
}

/* ── lane rails: FIXED endpoints, they never follow a streak ─────────────── */

export function CnmRails({ lane, laneAt, whaleState }) {
  const dead = whaleState === 'down'
  if (dead) return null
  return (
    <>
      <div className="cnm-rail cnm-rail-l" aria-hidden="true">
        <span className="cnm-rail__cap">issuance</span>
        {lane?.left && <span key={`l${laneAt}`} className="cnm-rail__v">{lane.left}</span>}
      </div>
      <div className="cnm-rail cnm-rail-r" aria-hidden="true">
        <span className="cnm-rail__cap">venue</span>
        {lane?.right && <span key={`r${laneAt}`} className="cnm-rail__v">{lane.right}</span>}
      </div>
    </>
  )
}

export function CnmLaneEmpty({ since }) {
  return (
    <p className="cnm-lane-empty">
      No transfer above $1M in <Tick from={since} fmt={spellDuration} />.
    </p>
  )
}

/* ── bottom-centre: narration + permanent provenance ─────────────────────── */

export function CnmNarration({ mode, text, source, sourceAt, lastEventAt }) {
  return (
    <div className="cnm-narr">
      {/* mode 'window' renders NO line: the meta block already prints the
          replay window permanently, and repeating it here duplicated the fact
          and collided with the meta at 390px. An empty narration slot over a
          quiet tape is the design, not a gap. */}
      {mode !== 'window' && (
        <p className={`cnm-narr__line cnm-narr__line--${mode}`}>
          {mode === 'quiet' && <>The tape is quiet. Last event <Tick from={lastEventAt} fmt={spellDuration} /> ago.</>}
          {mode === 'down' && <>No feed. Last event <Tick from={lastEventAt} fmt={spellDuration} /> ago.</>}
          {(mode === 'desk' || mode === 'cascade') && text}
        </p>
      )}
      {(mode === 'desk' || mode === 'cascade') && source && (
        <p className="cnm-narr__src">
          {source}
          {sourceAt ? <> · <span className="cnm-num">{fmtClock(sourceAt)}</span></> : null}
        </p>
      )}
      <p className="cnm-prov">{PROVENANCE}</p>
    </div>
  )
}

/* ── bottom-left: the event log ──────────────────────────────────────────── */

export function CnmLog({ rows }) {
  return (
    <div className="cnm-log" aria-live="off">
      {rows.map(ev => (
        // The side modifier exists ONLY to colour the row's leading edge — the
        // 2px bar that flashes on entry so a new labeled event registers in
        // peripheral vision while the eye is on the stage. Opacity-only fade.
        <div key={ev.id} className={`cnm-log__r cnm-log__r--${ev.kind === 'liq' ? ev.side : ev.cls}`}>
          <span className="cnm-log__t cnm-num">{fmtClock(ev.t)}</span>
          <span className="cnm-log__a">{ev.asset}</span>
          <span className={`cnm-log__s cnm-log__s--${ev.kind === 'liq' ? ev.side : ev.cls}`}>
            {ev.kind === 'liq' ? ev.side : whaleWord(ev.cls)}
          </span>
          <span className="cnm-log__v cnm-num">{fmtUsd(ev.usd)}</span>
          <span className="cnm-log__l">{ev.kind === 'liq' ? ev.exchange : ev.line}</span>
        </div>
      ))}
    </div>
  )
}

/* ── bottom-right: replay window, counts, floor, age ─────────────────────── */

export function CnmMeta({
  windowStart, windowEnd, drawn, belowFloor, floor, autoFloor, autoFloorReason,
  lastEventAt, onLowerFloor, canLowerFloor, resumeNote, dust, degraded,
}) {
  return (
    <div className="cnm-meta">
      {resumeNote && (
        <p className="cnm-meta__line cnm-meta__line--note">
          resumed · <span className="cnm-num">{fmtAge(resumeNote.missedMs)}</span> not shown
        </p>
      )}

      <p className="cnm-meta__line">
        {windowStart
          ? <>replaying <span className="cnm-num">{fmtClock(windowStart)}</span> → <span className="cnm-num">{fmtClock(windowEnd)}</span> UTC</>
          : <>no window replayed yet</>}
      </p>

      <p className="cnm-meta__line">
        <span className="cnm-num">{fmtCount(drawn)}</span> drawn · <span className="cnm-num">{fmtCount(belowFloor)}</span> below floor
        {drawn === 0 && canLowerFloor && (
          <>{' · '}<button type="button" className="cnm-meta__act" onClick={onLowerFloor}>lower the floor</button></>
        )}
      </p>

      {autoFloor
        ? <p className="cnm-meta__line cnm-meta__line--auto">
            floor auto-raised to <span className="cnm-num">{fmtFloorShort(autoFloor)}</span>{autoFloorReason ? ` · ${autoFloorReason}` : ''}
          </p>
        : <p className="cnm-meta__line">
            {/* "smaller events hidden" read as a fixed backlog. At a $1,000
                floor over a dust-heavy tape this number climbs all session, so
                it is now stated as what it is: a running count of real events
                that fell under the floor, in the footnote's own words. */}
            floor <span className="cnm-num">{fmtFloorFull(floor)}</span> — <span className="cnm-num">{fmtCount(belowFloor)}</span> real events under it, not shown
          </p>}

      {lastEventAt
        ? <p className="cnm-meta__line">last event <Tick from={lastEventAt} fmt={fmtAge} className="cnm-num" /> ago</p>
        : <p className="cnm-meta__line">no event since this page opened</p>}

      {degraded && <p className="cnm-meta__line cnm-meta__line--dim">reduced frame rate</p>}
      {dust && <p className="cnm-meta__line cnm-meta__line--dust">{DUST_FOOTNOTE}</p>}
    </div>
  )
}

/* ── the tape's own axis stamp ───────────────────────────────────────────── */

export function CnmTapeStamp({ asset, since, points }) {
  if (points < 2 || !since) return null
  return (
    <p className="cnm-tape-stamp">
      <span className="cnm-tape-stamp__a">{asset}</span>
      {' since '}
      <span className="cnm-num">{fmtClock(since).slice(0, 5)}</span>
      {' · '}
      <span className="cnm-num">{fmtCount(points)}</span>
      {' points'}
    </p>
  )
}

/* ── per-lane failure lines (degradation ladder step 6) ──────────────────── */

export function CnmLaneFaults({ liqState, whaleState }) {
  if (liqState !== 'down' && whaleState !== 'down') return null
  return (
    <div className="cnm-faults">
      {liqState === 'down' && <p className="cnm-faults__l">liquidations: no feed</p>}
      {whaleState === 'down' && <p className="cnm-faults__l">transfers: no feed</p>}
    </div>
  )
}

export { UNKNOWN_WALLET }
