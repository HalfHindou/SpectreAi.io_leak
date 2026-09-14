/**
 * The derived read for the cross-asset board.
 *
 * Rule that keeps this honest: the read may only restate numbers that are
 * visible on the same screen. No model, no LLM prose, no hidden inputs. If the
 * sentence claims a pair has decoupled, the two correlations behind that claim
 * are printed underneath it.
 *
 * The page this replaces failed by writing its conclusions by hand and dressing
 * them as output; the guard against repeating that is not good intentions, it's
 * that every branch below is a function of `drift` and nothing else.
 */

/* A drift below this is noise on a 30-observation window — say nothing. */
export const DRIFT_FLOOR = 0.15

/* How a pair reads in plain language when its link to the anchor moves. Only
   pairs whose economic meaning is unambiguous get a phrase; everything else
   falls back to the neutral wording. */
const PHRASE = {
  GOLD: { on: 'is trading like a debasement hedge', off: 'has broken step with gold' },
  SPX: { on: 'is trading as a risk asset again', off: 'has left the equity trade' },
  NDX: { on: 'is tracking tech again', off: 'has left the tech trade' },
  RUT: { on: 'is tracking small caps again', off: 'has left the small-cap trade' },
  BTC: { on: 'is moving with bitcoin again', off: 'has broken step with bitcoin' },
  ETH: { on: 'is moving with ether again', off: 'has broken step with ether' },
}

const pc = (v) => (Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) : '—')

export function deriveRead(data) {
  if (!data?.drift?.length) return null
  const anchor = data.anchor
  const strong = data.drift.filter((d) => Math.abs(d.drift) >= DRIFT_FLOOR)
  if (!strong.length) {
    return {
      headline: `${anchor} is sitting close to its usual relationships.`,
      detail: `No pair has moved more than ${DRIFT_FLOOR.toFixed(2)} from its one-year norm.`,
      inputs: data.drift.slice(0, 3),
      quiet: true,
    }
  }

  const top = strong[0]
  // A correlation that rises toward the anchor is "on"; one that falls away is
  // "off". For an inverse pair like the dollar, the sign is already negative,
  // so a MORE negative drift means the inverse link tightened.
  const tightened = top.drift > 0 ? top.w30 > 0 : top.w30 < 0
  const named = PHRASE[top.b]

  let headline
  if (top.b === 'DXY') {
    headline = top.drift < 0
      ? `${anchor} is more dollar-sensitive than it has been all year.`
      : `${anchor} has loosened its grip on the dollar.`
  } else if (top.b === 'VIX') {
    headline = top.drift < 0
      ? `${anchor} is punished harder by volatility spikes than usual.`
      : `${anchor} is shrugging off volatility better than usual.`
  } else if (named) {
    headline = `${anchor} ${tightened ? named.on : named.off}.`
  } else {
    headline = `${anchor}'s link to ${top.b} has ${top.drift > 0 ? 'tightened' : 'loosened'} sharply.`
  }

  // A second clause only when another pair moved the OTHER way — that is what
  // makes it a rotation rather than one number drifting.
  const counter = strong.slice(1).find((d) => Math.sign(d.drift) !== Math.sign(top.drift))
  const detail = counter
    ? `${top.b} ${pc(top.w250)} → ${pc(top.w30)}, while ${counter.b} went ${pc(counter.w250)} → ${pc(counter.w30)}.`
    : `${top.b} ${pc(top.w250)} → ${pc(top.w30)} against its one-year norm.`

  return { headline, detail, inputs: strong.slice(0, 3), quiet: false }
}

/** Diverging fill for a correlation cell, −1 → +1. */
export function corrFill(v, day = false) {
  if (!Number.isFinite(v)) return { bg: 'transparent', fg: 'var(--xa-ink-3)' }
  const t = Math.pow(Math.min(1, Math.abs(v)), 0.8)
  const rgb = v >= 0 ? '16, 185, 129' : '239, 68, 68'
  const a0 = day ? 0.1 : 0.06
  const a1 = day ? 0.52 : 0.62
  return {
    bg: `rgba(${rgb}, ${(a0 + t * a1).toFixed(3)})`,
    fg: t > 0.55
      ? (day ? (v >= 0 ? '#053d2c' : '#5f1512') : (v >= 0 ? '#d7fbee' : '#ffe3e0'))
      : 'var(--xa-ink-2)',
    t,
  }
}

export const fmtCorr = (v) => (Number.isFinite(v) ? (v >= 0 ? '' : '−') + Math.abs(v).toFixed(2) : '—')
export const fmtPct = (v, dp = 2) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(dp)}%` : '—')
export function fmtLevel(v, unit) {
  if (!Number.isFinite(v)) return '—'
  if (unit === 'pct') return `${v.toFixed(2)}%`
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (v >= 100) return v.toFixed(1)
  return v.toFixed(2)
}

/* ─────────────────────────────────────────────────────────────────────────────
 * The state — what the macro environment is doing, rebuilt from The Loop's
 * regime card.
 *
 * The old one printed "Distribution 97/100" beside a badge reading BULLISH, and
 * the 0-100 never showed a single input. This is a plain average of four
 * readings that are all on screen, and each one's push is labelled. It is not a
 * forecast and it is not a score with a hidden curve behind it.
 *
 * The anchor is deliberately NOT part of the composite. The environment is the
 * thing being measured; how the anchor responded to it is the interesting part,
 * and folding the two together would hide exactly that.
 * ────────────────────────────────────────────────────────────────────────── */

/* How far a 30-day move has to run to count as a full push in one direction.
   Rough dispersion of each series, not a fitted parameter. */
const PUSH_SCALE = { SPX: 0.08, NDX: 0.10, VIX: 0.35, DXY: 0.04, US10Y: 0.15 }

/* +1 means a RISE in this series pushes toward risk-on. A stronger dollar,
   higher yields and higher volatility all tighten conditions. */
const PUSH_SIGN = { SPX: 1, NDX: 1, VIX: -1, DXY: -1, US10Y: -1 }

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function deriveState(data) {
  if (!data?.assets?.length) return null
  const by = Object.fromEntries(data.assets.map((a) => [a.sym, a]))
  const anchor = by[data.anchor]

  const inputs = ['SPX', 'NDX', 'VIX', 'DXY', 'US10Y']
    .filter((s) => s !== data.anchor && by[s] && Number.isFinite(by[s].d30))
    .map((s) => {
      const move = by[s].d30
      const push = clamp(move / PUSH_SCALE[s], -1, 1) * PUSH_SIGN[s]
      return { sym: s, move, push: Math.round(push * 100) / 100, toward: push >= 0 ? 'on' : 'off' }
    })

  if (inputs.length < 3) return null
  const score = inputs.reduce((s, i) => s + i.push, 0) / inputs.length

  const label = score <= -0.4 ? 'Risk-off'
    : score <= -0.12 ? 'Leaning risk-off'
      : score < 0.12 ? 'Mixed'
        : score < 0.4 ? 'Leaning risk-on'
          : 'Risk-on'

  return {
    score: Math.round(score * 100) / 100,
    label,
    inputs,
    anchor: anchor ? { sym: anchor.sym, d30: anchor.d30 } : null,
    // Said plainly so nobody reads the composite as a forecast.
    basis: `Average of ${inputs.length} thirty-day moves, each shown below.`,
  }
}
