// Exhaustion watch — the shared signal behind Pro /why and Lite Why.
//
// Extracted from why-page.jsx on 2026-08-03 when Lite needed it too. It lives
// here rather than being copied because a second implementation of a SIGNAL is
// how two surfaces start disagreeing about the market on the same account —
// the same drift that put a literal in NEWS_NOISE the feed had reworded around,
// and that keeps two ET clocks from agreeing on the header. One number, one
// place, both surfaces read it.
//
// Read the backtest note inside before changing any threshold: this signal was
// measured INVERTED, and the copy it returns depends on that measurement.

const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

// A dateless "15:30" from an anchor two days back reads as TODAY'S 15:30 — or
// a future one (2026-08-07: the 08-05 13:30Z low rendered as "15:30" on a
// screen photographed at 15:13). An anchor that isn't from today names its day.
const stamp = (t) => {
  const d = new Date(t)
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? hhmm(t) : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hhmm(t)}`
}

// The founder read the 5/5 panel and asked, reasonably: "is this retrace spent
// meaning its now room for new leg up? i have tough time understanding the
// logic." That is the copy failing, not the reader. Three things made it
// unreadable:
//   1. "Retrace" is ambiguous. The retrace being measured is the BOUNCE off the
//      low, but a reader hears "the pullback", so "retrace spent" sounds like
//      the selling is done and up is next. It means the opposite.
//   2. "5 of 5 tests pass" reads like a score, and a full score reads bullish.
//      Here every test passing is the BEARISH condition, because each one
//      confirms a bounce that has already been paid for.
//   3. Nothing on the panel said which way it leaned, so the reader had to
//      infer direction from two percentages and a hit rate.
// So each state now names its subject, states its lean with an arrow, and says
// the inversion out loud. Baseline travels with the number, because "44% up"
// only means something next to the 55% it is being compared against.
function verdictFor(score, off) {
  const bias = score >= 4 ? 'spent' : score <= 2 ? 'coiled' : 'neutral'
  const pct = Number(off).toFixed(1)
  const lean = bias === 'spent'
    ? { dir: 'down', arrow: '↓', word: 'leans lower', title: 'Historically gave back ground over the next 24h' }
    : bias === 'coiled'
      ? { dir: 'up', arrow: '↑', word: 'leans higher', title: 'Historically still had upside over the next 24h' }
      : { dir: 'flat', arrow: '→', word: 'no lean', title: 'Historically a coin flip over the next 24h' }
  const verdict = bias === 'spent'
    ? `The BOUNCE is what looks spent, not the selling. All ${score} of 5 bounce conditions are already met ${pct}% off the low: the low held, shorts got squeezed, volume confirmed. That is the catch, more green here is worse, not better, because the leg you would have bought is already behind you. Historically this all-clear state gave back 0.2% to 0.4% over the next 24h and finished higher only 44-46% of the time, against 55% for any random bar.`
    : bias === 'coiled'
      ? `Forced selling is still running, and the bounce has NOT been paid for yet: only ${score} of 5 conditions are met ${pct}% off the low. Counter-intuitively that is the better setup, because the move is still ahead rather than behind. Historically these bars added 0.67% to 0.97% over the next 24h and finished higher 69-74% of the time, against 55% for any random bar.`
      : `Mid-flush, ${score} of 5 bounce conditions met ${pct}% off the low. The structure is turning but the move is neither exhausted nor confirmed. Historically the least informative state on the tape: +0.10% over the next 24h and higher 53% of the time, which is the coin flip.`
  // measured receipt, rendered beside the verdict — a claim on this page carries
  // its evidence or it does not ship
  const evidence = bias === 'spent'
    ? { label: 'next 24h, historically', value: '−0.2% to −0.4% · up 44-46%', base: 'baseline +0.15% · up 55%', n: '1,141 of 3,705 bars' }
    : bias === 'coiled'
      ? { label: 'next 24h, historically', value: '+0.67% to +0.97% · up 69-74%', base: 'baseline +0.15% · up 55%', n: '850 of 3,705 bars' }
      : { label: 'next 24h, historically', value: '+0.10% · up 53%', base: 'baseline +0.15% · up 55%', n: '1,427 of 3,705 bars' }
  return { score, bias, lean, verdict, evidence }
}

export function exhaustionWatch(bars, events, now = Date.now()) {
  if (bars.length < 12) return null
  const loBar = bars.reduce((m, b) => (b.l < m.l ? b : m), bars[0])
  const since = bars.filter((b) => b.t > loBar.t)
  const fmtT = stamp
  const tests = []

  // 1. the low is holding
  const newLow = since.some((b) => b.l < loBar.l)
  tests.push({
    ok: since.length >= 2 && !newLow,
    name: 'Low intact',
    detail: `${fmtT(loBar.t)} low $${Math.round(loBar.l).toLocaleString('en-US')}${since.length >= 2 ? (newLow ? ' — broken since' : ' — untouched since') : ' — too fresh to judge'}`,
  })

  // 2. higher lows forming
  let hl = 0
  for (let i = since.length - 1; i > 0 && since[i].l > since[i - 1].l; i--) hl++
  tests.push({ ok: hl >= 2, name: 'Higher lows', detail: hl >= 2 ? `${hl + 1} rising 15m lows in a row` : 'no rising-low structure yet' })

  // 3. forced selling exhausted
  const lastLongFlush = [...events].reverse().find((e) => e.kind === 'liquidation_flush' && /of longs/.test(e.text))
  const quietMin = lastLongFlush ? Math.round((now - lastLongFlush.at) / 60e3) : null
  tests.push({
    ok: quietMin == null || quietMin >= 45,
    name: 'Forced selling done',
    detail: lastLongFlush ? `last long flush ${quietMin}m ago` : 'no long flush in window',
  })

  // 4. the squeeze flipped
  const squeeze = events.find((e) => e.kind === 'liquidation_flush' && /of shorts/.test(e.text) && e.at > loBar.t)
  tests.push({ ok: !!squeeze, name: 'Shorts now paying', detail: squeeze ? `${fmtT(squeeze.at)} — skew flipped to shorts` : 'no short squeeze since the low' })

  // 5. the bounce has volume (drift retraces fade; bid retraces hold)
  const hourBefore = bars.filter((b) => b.t <= loBar.t && b.t > loBar.t - 6 * 900e3 && b.v > 0)
  const upSince = since.filter((b) => b.c >= b.o && b.v > 0)
  const dv = hourBefore.length ? hourBefore.reduce((a, b) => a + b.v, 0) / hourBefore.length : null
  const uv = upSince.length ? upSince.reduce((a, b) => a + b.v, 0) / upSince.length : null
  const volOk = dv != null && uv != null && uv >= dv * 0.6
  tests.push({
    ok: volOk,
    name: 'Bounce has volume',
    detail: dv && uv ? `up-bars run ${Math.round((uv / dv) * 100)}% of the selloff's volume` : 'volume data thin',
  })

  const score = tests.filter((t) => t.ok).length
  const last = bars[bars.length - 1]
  const off = loBar.l > 0 ? ((last.c - loBar.l) / loBar.l) * 100 : 0

  // 🪤🪤 BACKTESTED 2026-08-03 — AND IT RUNS THE OTHER WAY.
  // Replayed point-in-time over BTC 15m bars, 06-26 → 08-03 (3,705 bars), with
  // flushes rebuilt from liquidation_events under the recorder's own rules.
  // Forward 24h return by score, MONOTONIC across all six buckets:
  //     0/5 +0.97% (70% up)   3/5 +0.10% (53%)
  //     1/5 +0.78% (74%)      4/5 −0.17% (46%)
  //     2/5 +0.67% (69%)      5/5 −0.38% (44%)   baseline +0.15% (55%)
  // Checked and it is NOT a "fires too late" artifact: early(≤2) beats
  // confirmed(≥4) at every distance off the low. Passing the tests IS the
  // bearish condition — all five green describes a bounce that has already been
  // paid for, and what follows is the give-back.
  // So this panel now reads BOTH sides off the same evidence instead of calling
  // 5/5 "reversal forming", which is the state that historically underperformed
  // the unconditional baseline by ~0.5pp at 24h.
  // Sample honesty: 38 days, BTC only, one chop regime, overlapping 48h windows
  // (so the n's overstate independence). Directional, not proven — the copy says
  // "historically" and never promises.
  return { tests, ...verdictFor(score, off) }

}

// ── Prefer the published signal ────────────────────────────────────────────
// The box computes this same signal in src/brain/market-state.js and publishes
// it on /v1/market/state, which is also what the TG DM alert reads. Three
// surfaces deciding independently is how they start disagreeing about the
// market on one account, so when the published payload is present it WINS and
// the local computation above is only the fallback for when it is not.
//
// Split of responsibility: the box owns the decision (score, bias, which tests
// passed) and ships the raw numbers behind them; this file owns presentation —
// the detail strings and the reader's local clock, which the box cannot know.
export function fromPublished(ex) {
  // 🪤 `facts` must be present, not just `tests`. An older box publishes the
  // booleans without the supporting numbers, and rendering from that produced
  // "undefined rising 15m lows in a row" and four other wrong detail lines on a
  // panel whose whole job is to be checkable. Returning null here sends the
  // caller to the local computation, which has real bars to describe.
  if (!ex || typeof ex.score !== 'number' || !ex.tests || !ex.facts) return null
  const f = ex.facts
  const loAt = Date.parse(ex.low?.at)
  const t = ex.tests
  const tests = [
    {
      ok: !!t.low_intact,
      name: 'Low intact',
      detail: `${Number.isFinite(loAt) ? stamp(loAt) : '—'} low $${Math.round(ex.low?.price || 0).toLocaleString('en-US')}${
        f.bars_since_low >= 2 ? (f.broke_low ? ' — broken since' : ' — untouched since') : ' — too fresh to judge'}`,
    },
    {
      ok: !!t.higher_lows,
      name: 'Higher lows',
      detail: t.higher_lows ? `${f.higher_low_run} rising 15m lows in a row` : 'no rising-low structure yet',
    },
    {
      ok: !!t.forced_selling_done,
      name: 'Forced selling done',
      detail: f.last_long_flush_min == null ? 'no long flush in window' : `last long flush ${f.last_long_flush_min}m ago`,
    },
    {
      ok: !!t.shorts_paying,
      name: 'Shorts now paying',
      detail: f.squeeze_at ? `${stamp(Date.parse(f.squeeze_at))} — skew flipped to shorts` : 'no short squeeze since the low',
    },
    {
      ok: !!t.bounce_has_volume,
      name: 'Bounce has volume',
      detail: f.bounce_vol_pct == null ? 'volume data thin' : `up-bars run ${f.bounce_vol_pct}% of the selloff's volume`,
    },
  ]
  return { ...verdictFor(ex.score, ex.off_low_pct ?? 0), tests, score: ex.score }
}
