/**
 * RzmRead — the chart TA read on a phone.
 *
 * The desktop read is a horizontal strip. On a 390px screen that primitive
 * fails (see rzm-read.css for the measured reason), so mobile gets a different
 * shape: the chart keeps only the drawn geometry, and every word lives in a
 * bottom sheet built from the same chrome as rzm-agent-sheet.
 *
 * The other half — and the half the desktop layer never had to solve — is
 * INPUT. Desktop drags a box over the chart; that gesture fights the page
 * scroller on touch. So the window is chosen with a lens: a trim strip under
 * the chart with two handles. Dragging it drives the chart through the same
 * `focusRange()` the agent uses in play mode, which makes the window a thing
 * you hold rather than a setting you infer.
 *
 * 🪤 Dragging must NOT re-analyse. `analyze()` in use-rz-chart-ta schedules an
 * agent call 620ms after it builds the brief, so re-running it per drag frame
 * would spam the model. Dragging only moves the window; reading is an explicit
 * tap, and moving the lens after a read marks that read stale instead.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { normalizeBars, describeInvalidation } from '@/lib/chart-ta-brief'
import './rzm-read.css'

const MIN_BARS = 8

/**
 * Height of the mobile bottom nav, so the sheet can sit above it.
 *
 * 🪤 The sheet MUST be portalled to document.body. `.app-main-content` carries
 * `z-index: 1`, which makes it a stacking context — any z-index set on a
 * descendant is trapped inside it, so the sheet rendered under the nav
 * (z-index 400, portalled to body) no matter how high its own z-index went.
 * The nav swallowed taps on the primary action.
 */
function useNavHeight() {
  const [h, setH] = useState(0)
  useEffect(() => {
    const read = () => {
      const nav = document.querySelector('.mobile-bottom-nav')
      setH(nav ? Math.round(nav.getBoundingClientRect().height) : 0)
    }
    read()
    window.addEventListener('resize', read)
    const t = setTimeout(read, 600)      // the nav mounts in a portal, possibly later
    return () => { window.removeEventListener('resize', read); clearTimeout(t) }
  }, [])
  return h
}

const fmtPrice = (n) => {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return Math.round(n).toLocaleString('en-US')
  if (n >= 1) return n.toFixed(2)
  return n.toPrecision(4)
}

/** Duration of a bar span, in the same voice the desktop strip uses. */
function spanLabel(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const h = Math.round(ms / 3600000)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  const r = h % 24
  return r ? `${d}d ${r}h` : `${d}d`
}

/**
 * The bars the lens draws. The chart owns them; it exposes them through
 * getTaContext(). They arrive asynchronously, so poll briefly rather than
 * assuming they are there on first paint.
 */
function useLensBars(chartRef, symbol) {
  const [bars, setBars] = useState([])
  useEffect(() => {
    let stop = false
    let tries = 0
    const read = () => {
      if (stop) return
      const ctx = chartRef?.current?.getTaContext?.()
      const norm = normalizeBars(ctx?.bars)
      if (norm.length >= MIN_BARS) { setBars(norm); return }
      if (++tries < 25) setTimeout(read, 400)   // ~10s, then give up quietly
    }
    setBars([])
    read()
    return () => { stop = true }
  }, [chartRef, symbol])
  return bars
}

/** The lens: full context as an area chart, with the read window cut out of it. */
function Lens({ bars, win, onWin, onCommit }) {
  const ref = useRef(null)
  const wrapRef = useRef(null)
  const dragRef = useRef(null)

  const paint = useCallback(() => {
    const cv = ref.current
    if (!cv || !bars.length) return
    const wrap = cv.parentElement
    const W = wrap.clientWidth, H = 46
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.style.width = W + 'px'; cv.style.height = H + 'px'
    cv.width = W * dpr; cv.height = H * dpr
    const c = cv.getContext('2d')
    c.setTransform(dpr, 0, 0, dpr, 0, 0)

    const n = bars.length, pad = 4
    const lo = Math.min(...bars.map(b => b.l)), hi = Math.max(...bars.map(b => b.h))
    const rng = hi - lo || 1
    const Y = v => pad + (H - pad * 2) - ((v - lo) / rng) * (H - pad * 2)
    const X = i => (i / (n - 1)) * W

    c.clearRect(0, 0, W, H)
    c.fillStyle = 'rgba(255,255,255,0.022)'
    c.fillRect(0, 0, W, H)

    c.beginPath(); c.moveTo(0, H - pad)
    bars.forEach((b, i) => c.lineTo(X(i), Y(b.c)))
    c.lineTo(W, H - pad); c.closePath()
    c.fillStyle = 'rgba(245,245,247,0.07)'; c.fill()

    c.beginPath()
    bars.forEach((b, i) => (i ? c.lineTo(X(i), Y(b.c)) : c.moveTo(X(i), Y(b.c))))
    c.strokeStyle = 'rgba(245,245,247,0.28)'; c.lineWidth = 1; c.stroke()

    const xa = X(win.a), xb = X(win.b)
    c.fillStyle = 'rgba(8,8,10,0.62)'
    c.fillRect(0, 0, xa, H); c.fillRect(xb, 0, W - xb, H)
    c.strokeStyle = 'rgba(245,245,247,0.5)'; c.lineWidth = 1
    c.strokeRect(xa + 0.5, 0.5, Math.max(2, xb - xa - 1), H - 1)
    c.fillStyle = 'rgba(245,245,247,0.9)'
    ;[xa, xb].forEach(x => { c.fillRect(x - 2.5, H / 2 - 9, 5, 18) })
  }, [bars, win])

  useEffect(() => { paint() }, [paint])
  useEffect(() => {
    const onR = () => paint()
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [paint])

  const idxAt = useCallback((clientX) => {
    const cv = ref.current
    if (!cv || bars.length < 2) return 0
    const r = cv.getBoundingClientRect()
    const t = (clientX - r.left) / (r.width || 1)
    return Math.max(0, Math.min(bars.length - 1, Math.round(t * (bars.length - 1))))
  }, [bars.length])

  const onDown = useCallback((e) => {
    if (!bars.length) return
    const cv = ref.current
    const r = cv.getBoundingClientRect()
    const px = i => r.left + (i / (bars.length - 1)) * r.width
    const x = e.clientX
    const da = Math.abs(x - px(win.a)), db = Math.abs(x - px(win.b))
    // Claim only the first pointer, or a two-finger pinch becomes a drag.
    if (e.isPrimary === false) return
    dragRef.current = da < 22 && da <= db ? { k: 'a' }
      : db < 22 ? { k: 'b' }
      : (x > px(win.a) && x < px(win.b)) ? { k: 'move', off: idxAt(x) - win.a, w: win.b - win.a }
      : { k: 'a' }
    wrapRef.current?.classList.add('is-drag')
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not supported */ }
    e.preventDefault()
  }, [bars.length, win, idxAt])

  const onMove = useCallback((e) => {
    const d = dragRef.current
    if (!d || !bars.length) return
    const i = idxAt(e.clientX)
    let next
    if (d.k === 'a') next = { a: Math.min(i, win.b - 12), b: win.b }
    else if (d.k === 'b') next = { a: win.a, b: Math.max(i, win.a + 12) }
    else {
      const a = Math.max(0, Math.min(bars.length - 1 - d.w, i - d.off))
      next = { a, b: a + d.w }
    }
    next.a = Math.max(0, next.a); next.b = Math.min(bars.length - 1, next.b)
    if (next.a !== win.a || next.b !== win.b) onWin(next)
  }, [bars.length, win, idxAt, onWin])

  const onUp = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    wrapRef.current?.classList.remove('is-drag')
    onCommit?.()
  }, [onCommit])

  return (
    <div
      className="rzr-lens"
      ref={wrapRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <canvas ref={ref} />
    </div>
  )
}

export default function RzmRead({ chartRef, chartTa, onOpenAgent, symbol }) {
  const { t } = useTranslation()
  const bars = useLensBars(chartRef, symbol)
  const navH = useNavHeight()
  const [win, setWin] = useState(null)
  const [pane, setPane] = useState('read')
  const [rail, setRail] = useState(false)
  const [stale, setStale] = useState(false)
  const [focusIdx, setFocusIdx] = useState(null)

  const analysis = chartTa?.analysis
  const hasRead = !!analysis?.ok

  // Default window: the last 120 bars, matching what the desktop read takes as
  // "the visible chart" — but only once, so a re-render never yanks the lens
  // out of the reader's hands.
  useEffect(() => {
    if (win || bars.length < MIN_BARS) return
    setWin({ a: Math.max(0, bars.length - 120), b: bars.length - 1 })
  }, [bars.length, win])
  useEffect(() => { setWin(null); setStale(false); setFocusIdx(null) }, [symbol])

  const region = useMemo(() => {
    if (!win || !bars.length) return null
    const a = bars[win.a], b = bars[win.b]
    return (a && b) ? { fromTs: a.t, toTs: b.t } : null
  }, [win, bars])

  // Dragging drives the chart, and nothing else. No analyse: that would fire an
  // agent call per frame (see the file header).
  const handleWin = useCallback((next) => {
    setWin(next)
    const a = bars[next.a], b = bars[next.b]
    if (a && b) chartRef?.current?.focusRange?.({ fromTs: a.t, toTs: b.t })
    if (hasRead) setStale(true)
  }, [bars, chartRef, hasRead])

  const runRead = useCallback(() => {
    if (!region) return
    setStale(false)
    setFocusIdx(null)
    setPane('read')
    setRail(false)
    chartTa.onTaSelectionChange(region, 'analyze')
    // Bring the chart up under the sheet — the drawn levels are half the read,
    // and on a phone the hero would otherwise hold them off screen.
    requestAnimationFrame(() => {
      document.querySelector('.rzm-chart-section')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }, [region, chartTa])

  const zones = useMemo(() => {
    if (!hasRead) return []
    return [...(analysis.resistances || []), ...(analysis.supports || [])]
      .slice()
      .sort((x, y) => (y.mid ?? 0) - (x.mid ?? 0))
  }, [hasRead, analysis])

  const focusZone = useCallback((i) => {
    const next = focusIdx === i ? null : i
    setFocusIdx(next)
    const z = zones[next]
    if (z && region) chartRef?.current?.focusRange?.(region)
  }, [focusIdx, zones, region, chartRef])

  const pattern = hasRead ? (analysis.patterns || [])[0] : null
  const scope = analysis?.stats
    ? `${analysis.stats.bars} bars · ${analysis.stats.durationLabel}`
    : (region ? `${(win?.b ?? 0) - (win?.a ?? 0) + 1} bars · ${spanLabel(region.toTs - region.fromTs)}` : '')

  const busy = !!chartTa?.analyzing
  const err = chartTa?.analysisError

  if (!bars.length) return null

  const idle = !hasRead && !busy && !err

  const lens = (
    <div className="rzr-lenswrap">
      <Lens bars={bars} win={win || { a: 0, b: bars.length - 1 }} onWin={handleWin} />
      <div className="rzr-lens-cap">
        <span>{t('researchPro.rzmRead.rzmread.reading', "reading")}</span>
        <b>{scope}</b>
        <span className="rzr-hint">{t('researchPro.rzmRead.rzmread.dragToChange', "drag to change")}</span>
      </div>
    </div>
  )

  const sheet = (
    <div
      className={`rzr-sheet${rail ? ' is-rail' : ''}${idle ? ' is-idle' : ''}`}
      style={{ bottom: navH || 0 }}
    >
        {hasRead && (
          <button
            type="button"
            className="rzr-grabbtn"
            aria-label={rail ? 'Expand the read' : 'Collapse the read'}
            onClick={() => setRail(v => !v)}
          />
        )}
        <div className="rzr-grab" />

        {/* The lens lives INSIDE the sheet. In page flow it rendered under the
            sheet at real phone heights — invisible, and hit-testing its centre
            returned the CTA, so the one control that chooses the read window
            could not be touched. Here it is always visible and sits directly
            above the button that consumes it. */}
        {!rail && lens}

        {hasRead && (
          <div className="rzr-rail">
            <div className="rzr-rail-row">
              <span className="rzr-vn">{pattern ? pattern.name : 'Levels only'}</span>
              {pattern && (
                <span className={`rzr-chip${pattern.bias === 'bearish' ? ' is-bear' : pattern.bias === 'bullish' ? ' is-bull' : ''}`}>
                  {pattern.kind}
                </span>
              )}
            </div>
            <p className="rzr-rail-sub">
              {pattern
                ? pattern.confirmation
                : `${zones.length} levels measured across ${scope}.`}
            </p>
          </div>
        )}

        {(hasRead || busy || err) && (
          <div className="rzr-hdr">
            <div className="rzr-seg" role="tablist" aria-label={t('researchPro.rzmRead.rzmread.ariaTheRead', "The read")}>
              {['read', 'levels', 'agent'].map(p => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={pane === p}
                  onClick={() => setPane(p)}
                >
                  {p === 'read' ? 'Read' : p === 'levels' ? 'Levels' : 'Agent'}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="rzr-close"
              aria-label={t('researchPro.rzmRead.rzmread.ariaClearTheRead', "Clear the read")}
              onClick={() => { chartTa.clearDrawings('all'); setFocusIdx(null); setStale(false) }}
            >
              ✕
            </button>
          </div>
        )}

        {(hasRead || busy || err) && (
          <div className="rzr-body">
            {busy && (
              <>
                <div className="rzr-skel" style={{ height: 96 }} />
                <div className="rzr-skel" style={{ height: 62 }} />
                <div className="rzr-skel" style={{ height: 52 }} />
              </>
            )}

            {!busy && err && (
              <div className="rzr-card rzr-empty">
                <h3>{t('researchPro.rzmRead.rzmread.thatWindowWillNotReadHone', "That window will not read honestly")}</h3>
                <p>{err}</p>
              </div>
            )}

            {!busy && !err && hasRead && pane === 'read' && (
              <>
                {pattern ? (
                  <>
                    <div className="rzr-card">
                      <div className="rzr-vt">
                        <span className="rzr-vn">{pattern.name}</span>
                        <span className={`rzr-chip${pattern.bias === 'bearish' ? ' is-bear' : pattern.bias === 'bullish' ? ' is-bull' : ''}`}>
                          {pattern.kind}
                        </span>
                        <span className="rzr-fit">{Math.round((pattern.confidence || 0) * 100)}%</span>
                      </div>
                      <div className="rzr-meter">
                        <i style={{ width: `${Math.round((pattern.confidence || 0) * 100)}%` }} />
                      </div>
                      <p className="rzr-say">{pattern.definition}</p>
                    </div>

                    <div className="rzr-card rzr-gates">
                      <div className="rzr-gate">
                        <span className="rzr-gk">{t('researchPro.rzmRead.rzmread.confirmsOn', "Confirms on")}</span>
                        <span className="rzr-gv">{pattern.confirmation}</span>
                      </div>
                      {describeInvalidation(pattern) && (
                        <div className="rzr-gate">
                          <span className="rzr-gk">{t('researchPro.rzmRead.rzmread.invalidatedBy', "Invalidated by")}</span>
                          <span className="rzr-gv">{describeInvalidation(pattern)}</span>
                        </div>
                      )}
                      {Number.isFinite(pattern.target) && (
                        <div className="rzr-gate">
                          <span className="rzr-gk">{t('researchPro.rzmRead.rzmread.measuredTarget', "Measured target")}</span>
                          <span className={`rzr-gv${pattern.bias === 'bearish' ? ' is-bear' : ''}`}>
                            <span className="rzr-num">{fmtPrice(pattern.target)}</span>
                          </span>
                          {pattern.measured && <span className="rzr-gsub">{pattern.measured}</span>}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="rzr-card rzr-empty">
                    <h3>{t('researchPro.rzmRead.rzmread.nothingMatchedCleanlyHere', "Nothing matched cleanly here")}</h3>
                    <p>
                      None of the classical patterns fit this window well enough to name.
                      The levels below were still measured — widen the lens and I will look again.
                    </p>
                  </div>
                )}

                {zones.length > 0 && (
                  <button type="button" className="rzr-jump" onClick={() => setPane('levels')}>
                    <span className="rzr-jn">{zones.length}</span>
                    <span className="rzr-jt">
                      {t('researchPro.rzmRead.rzmread.levelsMeasured', "levels measured")}
                      <em>{zones.filter(z => (z.touchesInWindow ?? 0) > 0).length} of them tested inside this window</em>
                    </span>
                    <span className="rzr-ja">›</span>
                  </button>
                )}

                <p className="rzr-note">
                  {t('researchPro.rzmRead.rzmread.everyNumberHereWasMeasured', "Every number here was measured off the candles before the agent saw it.")}
                </p>
              </>
            )}

            {!busy && !err && hasRead && pane === 'levels' && (
              zones.length ? zones.map((z, i) => {
                const inWin = z.touchesInWindow ?? null
                const ctx = z.touchesInContext ?? z.touches ?? 0
                const outside = inWin === 0
                const scopeLine = inWin === null
                  ? `${ctx} touch${ctx === 1 ? '' : 'es'}`
                  : outside
                    ? <><em>{ctx} touches</em>, none in this window</>
                    : inWin === ctx
                      ? <>{t('researchPro.rzmRead.rzmread.all', "all")} <em>{inWin} touch{inWin === 1 ? '' : 'es'}</em> {t('researchPro.rzmRead.rzmread.inThisWindow', "in this window")}</>
                      : <><em>{inWin} in this window</em> · {ctx} in context</>
                return (
                  <button
                    key={`${z.low}-${z.high}`}
                    type="button"
                    className={`rzr-lv${outside ? ' is-outside' : ''}`}
                    aria-pressed={focusIdx === i}
                    onClick={() => focusZone(i)}
                  >
                    <span className="rzr-lr">
                      <span className="rzr-lp">{fmtPrice(z.low)} – {fmtPrice(z.high)}</span>
                      <span className="rzr-lo">{z.side}</span>
                      <span className="rzr-lc">×{outside ? ctx : inWin ?? ctx}</span>
                    </span>
                    <span className="rzr-ls">{scopeLine}</span>
                    <span className="rzr-fx">◎ framed on the chart</span>
                    <span className="rzr-dens">
                      <i style={{ width: `${Math.min(100, ((outside ? ctx : inWin ?? ctx) / Math.max(1, ctx)) * 100)}%` }} />
                    </span>
                  </button>
                )
              }) : (
                <div className="rzr-card rzr-empty">
                  <h3>{t('researchPro.rzmRead.rzmread.noLevelsInThisWindow', "No levels in this window")}</h3>
                  <p>{t('researchPro.rzmRead.rzmread.noSwingClusterHeldLongEno', "No swing cluster held long enough here to call a level. Widen the lens.")}</p>
                </div>
              )
            )}

            {!busy && !err && hasRead && pane === 'agent' && (
              <>
                <p className="rzr-say" style={{ marginTop: 0 }}>
                  {t('researchPro.rzmRead.rzmread.theReadHasBeenHandedToTh', "The read has been handed to the agent with every measured number in it.")}
                </p>
                <button type="button" className="rzr-jump" onClick={onOpenAgent}>
                  <span className="rzr-jt">{t('researchPro.rzmRead.rzmread.openTheAgent', "Open the agent")}<em>{t('researchPro.rzmRead.rzmread.continueThisReadInTheChat', "continue this read in the chat")}</em></span>
                  <span className="rzr-ja">›</span>
                </button>
              </>
            )}
          </div>
        )}

        <div className="rzr-ft">
          <button
            type="button"
            className="rzr-cta"
            onClick={hasRead && !stale ? () => (chartTa.play ? chartTa.stopPlay() : chartTa.startPlay?.()) : runRead}
            disabled={busy || !region}
          >
            {busy
              ? 'Reading the chart…'
              : (!hasRead || stale)
                ? (stale ? 'Re-read this window' : 'Read this window')
                : (chartTa.play ? '■ Stop the walkthrough' : '▶ Walk me through it')}
          </button>
          {hasRead && (
            <button
              type="button"
              className="rzr-icobtn"
              aria-label={t('researchPro.rzmRead.rzmread.ariaClearTheDrawnLines', "Clear the drawn lines")}
              onClick={() => { chartTa.clearDrawings('all'); setFocusIdx(null) }}
            >
              ✕
            </button>
          )}
        </div>
    </div>
  )

  return createPortal(sheet, document.body)
}
