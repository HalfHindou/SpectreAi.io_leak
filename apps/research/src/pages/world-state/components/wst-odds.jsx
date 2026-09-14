/**
 * WstOdds — the odds ladder. Shared by the rates band and the policy band
 * (the rhyme is deliberate: same instrument, two subjects).
 *
 * Four honesty rules are load-bearing here (packet §"The odds ladder"), and
 * all four exist to stop the page presenting a price as a probability:
 *
 * 1. NO FILLED BAR WITHOUT MONEY. A market with null or zero recorded volume
 *    draws an OUTLINE track. A filled bar is a claim about conviction; an
 *    empty book cannot make one. (Today every crypto_policy_odds row ships
 *    vol_usd_m: 0 — this is the live case, not a defensive branch.)
 * 2. THIN BOOKS ARE MARKED AND ROUNDED. Under $1M the row carries a marker and
 *    the percentage drops to whole numbers. Money is the n of a prediction
 *    market, and precision must scale with the sample like any other rate.
 * 3. SORTED BY MONEY, NEVER BY PROBABILITY. Sorting by yes_pct would rank a
 *    $0 market above a $19M one. The band head says so out loud.
 * 4. EXPIRED MARKETS LEAVE THE LADDER. They drop to a sub-list below, still
 *    printed, never mixed in with what is live.
 */
import React, { useMemo, useState } from 'react'
import { fmtVol, fmtYes, fmtLongDay, numWord, toNum } from './wst-format'

const DAY_MS = 86_400_000

/** null → unknown · 0 → none · <$1M → thin · else ok. */
function priceState(volM) {
  const v = toNum(volM)
  if (v == null) return 'unknown'
  if (v <= 0) return 'none'
  if (v < 1) return 'thin'
  return 'ok'
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** The band-level statement of rule 1, in English rather than in a template. */
function unpricedNote(unpriced, total) {
  if (unpriced < total) {
    return `${cap(numWord(unpriced))} of ${numWord(total)} markets carry no recorded volume. Those tracks are drawn open.`
  }
  if (total === 1) return 'This market has no recorded volume. The price is shown; it is not read as a probability.'
  if (total === 2) return 'Neither of these markets has recorded volume. Both prices are shown; neither is read as a probability.'
  return `None of these ${numWord(total)} markets has recorded volume. Prices are shown; none is read as a probability.`
}

const FLAG = {
  unknown: 'Volume not reported. The percentage is a price without a size.',
  none: 'No money on this market. The price is not a probability.',
  thin: (vol) => `${vol} traded. Too thin to read as a probability.`,
}

function OddsRow({ row, index }) {
  const [open, setOpen] = useState(false)
  const state = priceState(row.vol_usd_m)
  const pct = toNum(row.yes_pct)
  const filled = state === 'ok' || state === 'thin'
  const vol = fmtVol(row.vol_usd_m)
  const ends = fmtLongDay(row.ends)
  /* The ladder is sorted by money (rule 3), so row 0 is the richest book on
     the band — the one line here whose price is worth reading as a probability.
     A slow shimmer marks it. A thin or unpriced book never gets it: the mark
     means "there is real money behind this", not "this is first". */
  const lead = index === 0 && state === 'ok'

  return (
    <li className="wst-odds-li">
      <button
        type="button"
        className={`wst-odds-row${open ? ' is-open' : ''}`}
        style={{ '--i': index }}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="wst-odds-q" title={row.q}>
          <span className="wst-odds-qt">{row.q}</span>
          {state === 'thin' && <span className="wst-flagchip">THIN</span>}
          {(state === 'none' || state === 'unknown') && <span className="wst-flagchip">NO VOL</span>}
        </span>
        <span className={`wst-odds-track${filled ? '' : ' is-outline'}`} aria-hidden="true">
          {filled && pct != null && (
            <span
              className={`wst-odds-fill${lead ? ' is-lead' : ''}`}
              style={{ '--w': Math.max(0, Math.min(100, pct)) / 100 }}
            />
          )}
        </span>
        <span className={`wst-odds-pct wst-num${filled ? '' : ' is-quiet'}`}>
          {fmtYes(pct, row.vol_usd_m) ?? '—'}
        </span>
        <span className={`wst-odds-vol wst-num${state === 'ok' ? '' : ' is-quiet'}`}>
          {state === 'unknown' ? 'unknown' : vol}
        </span>
      </button>
      {open && (
        <div className="wst-odds-more">
          <p className="wst-odds-full">{row.q}</p>
          <p className="wst-odds-meta">
            {ends && <span>Resolves {ends}</span>}
            {ends && <span className="wst-dot-sep">·</span>}
            <span>{state === 'unknown' ? 'Volume not reported' : `${vol} of open interest`}</span>
          </p>
          {state !== 'ok' && (
            <p className="wst-odds-flag">
              {state === 'thin' ? FLAG.thin(vol) : FLAG[state]}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

export default function WstOdds({ rows, now = Date.now(), emptyNote = 'No markets priced.', foot = true }) {
  const { live, expired, unpriced } = useMemo(() => {
    const all = (Array.isArray(rows) ? rows : []).filter((r) => r && r.q)
    const isExpired = (r) => {
      const t = Date.parse(r.ends)
      return Number.isFinite(t) && t + DAY_MS < now
    }
    const liveRows = all.filter((r) => !isExpired(r))
    /* Rule 3: money, not probability. Nulls sort last rather than to the top. */
    liveRows.sort((a, b) => (toNum(b.vol_usd_m) ?? -1) - (toNum(a.vol_usd_m) ?? -1))
    return {
      live: liveRows,
      expired: all.filter(isExpired),
      unpriced: liveRows.filter((r) => priceState(r.vol_usd_m) !== 'ok').length,
    }
  }, [rows, now])

  if (!live.length && !expired.length) return <p className="wst-none">{emptyNote}</p>

  return (
    <div className="wst-odds">
      {live.length > 0 && (
        <ul className="wst-odds-list">
          {live.map((r, i) => <OddsRow key={`${r.q}-${i}`} row={r} index={i} />)}
        </ul>
      )}

      {/* Rule 1, stated at band level so five identical row flags don't shout. */}
      {unpriced > 0 && (
        <p className="wst-foot">{unpricedNote(unpriced, live.length)}</p>
      )}

      {expired.length > 0 && (
        <div className="wst-odds-exp">
          <span className="wst-eyebrow wst-eyebrow--sm">Expired</span>
          <ul className="wst-odds-explist">
            {expired.map((r, i) => (
              <li key={`${r.q}-x-${i}`} className="wst-odds-exprow">
                <span className="wst-odds-qt" title={r.q}>{r.q}</span>
                <span className="wst-num is-quiet">{fmtLongDay(r.ends) ?? '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suppressed on a second ladder in the same band — one band, one footnote. */}
      {foot && (
        <p className="wst-foot">Prediction-market prices, not forecasts. Shown with the money behind them.</p>
      )}
    </div>
  )
}
