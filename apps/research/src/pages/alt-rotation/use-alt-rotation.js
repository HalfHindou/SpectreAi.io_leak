// Alt Rotation Radar — the data brain of /alt-rotation.
// Answers ONE question: is capital rotating out of majors down the curve into
// alts (on-chain memes + utilities), or are the micros dead? Deterministic,
// grounded in real feeds — no fabricated numbers.
//
// The chain map, the DEX-volume feed, the verdict/setup/depth math live in
// ./alt-rotation-core — Spectre Lite's Microcaps view reads the SAME module, so
// the two surfaces can never disagree. This file is orchestration only.
//
// Inputs (all app-reachable, no MCP):
//   getSpectreGlobalMetrics   — BTC/ETH/SOL dominance
//   getSpectreDominanceHistory— dominance 30d ago (is BTC.D rising = alts bleed)
//   getSpectreAltSeason       — 30d Alt Season Index (CMC-style)
//   getOthers2Data            — top-50 alt breadth + agg 7d/30d changes
//   getSpectreOthers2History  — OTHERS2 (ex-top-100) value + 7d trend
//   getCategoryCoins(cat)     — per-chain ecosystem cohorts (ETH/SOL/Base/RH)
//   getSpectreTokenMovers     — where the isolated strength is
import { useState, useEffect, useCallback, useRef } from 'react'
import { isAppActive, subscribeActivity } from '@/lib/idleManager'
import { getOthers2Data } from '@/services/coinGeckoApi'
import {
  getSpectreGlobalMetrics, getSpectreDominanceHistory, getSpectreAltSeason,
  getSpectreOthers2History, getSpectreTokenMovers, getSpectrePricesBySymbols,
} from '@/services/spectreMarketApi'
import {
  CHAINS, dexVolume, loadChainCohort, vibeFor, onchainPulse,
  buildVerdict, buildSetup, buildTrendWindow, buildDepth, findSeam, chainLink,
} from './alt-rotation-core'

export { CHAINS }

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

async function loadChain(chain) {
  const [cohort, dex] = await Promise.all([
    loadChainCohort(chain),
    dexVolume(chain.dexSlug).catch(() => null),
  ])
  return {
    ...cohort,
    dex,
    vibe: vibeFor({ med30d: cohort.med30d, br7d: cohort.breadth7d, runners: cohort.runners, dex }),
  }
}

// FRONT-RUN pockets — macro not-go-time but a chain already has runners firing
// = the early front-run ("go time on RH, ETH waiting"). Computed in wave 2.
function computeFrontrun(chains, band) {
  if (!chains || !chains.length) return null
  const hot = chains.filter((c) => c.vibe?.tone === 'hot')
  const waiting = chains.filter((c) => c.vibe?.tone === 'atl' || c.vibe?.tone === 'bleed')
  if (!hot.length || !['dead', 'notyet', 'stirring'].includes(band)) return null
  const hotNames = hot.map((c) => c.name), waitNames = waiting.map((c) => c.name)
  // the opening clause has to agree with the headline: once the on-chain leg
  // pushes the score into 'stirring', "market-wide it's not go-time" is arguing
  // with the word printed six inches above it.
  const macro = band === 'stirring' ? 'Market-wide it is only stirring' : "Market-wide it's not go-time"
  return {
    hot: hotNames, waiting: waitNames,
    text: `${macro} — but ${hotNames.join(' & ')} ${hot.length > 1 ? 'are' : 'is'} already running (runners live). That's the front-run: on-chain degens move first${waitNames.length ? `, ${waitNames.join(' & ')} still waiting` : ''}. When it spreads off ${hotNames[0]}, that's the tell.`,
  }
}

const EMPTY = {
  loading: true, verdict: null, signals: null, chains: [], others2: null, movers: null,
  majors: null, depth: null,
  // when the numbers on screen were last read off a live feed, so the page can
  // SAY how old it is instead of printing "Live" over a ten-minute-old verdict
  updatedAt: null, refreshing: false,
}

// ── refresh clocks ──────────────────────────────────────────────────────────
// The header legs (dominance, alt index, breadth, OTHERS2, majors) are cheap
// box/price calls — they tick on a fast clock, because the hero is the thing
// being read. The chain cohorts are ~7 CoinGecko calls per pass, so they ride a
// slower one; the on-chain leg of the verdict keeps using the last chains we
// hold, which is honest (DEX days move on an hourly clock, not a per-second one).
const HEAD_MS = 60_000
const CHAIN_MS = 180_000
const WAKE_MIN_MS = 20_000

// Instant repaint on revisit: the whole computed page state is one small
// serializable object — seed it, then revalidate in the background.
const LS_KEY = 'spectre-altrot-v1'
const LS_TTL = 10 * 60_000
function readAltSeed() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY))
    if (raw && raw.ts && Date.now() - raw.ts < LS_TTL && raw.state?.verdict) {
      // seeded, NOT live: carry the real age so the pill can say "4m ago" and
      // flip to Live only once a fetch has actually answered.
      return { ...EMPTY, ...raw.state, loading: false, updatedAt: raw.ts, refreshing: true }
    }
  } catch { /* private mode / corrupt */ }
  return null
}
function writeAltSeed(state) {
  try {
    const { loading, refreshing, updatedAt, ...rest } = state
    localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), state: rest }))
  } catch { /* quota */ }
}

export default function useAltRotation() {
  const [state, setState] = useState(() => readAltSeed() || EMPTY)
  const timer = useRef(null)
  // the chains we last held. A header-only tick still needs them: the on-chain
  // leg of the verdict is computed from `.dex`, and dropping it every fast tick
  // would make the score flap between "with on-chain" and "without".
  const chainsRef = useRef(state.chains?.length ? state.chains : null)
  const chainsAt = useRef(state.chains?.length ? (state.updatedAt || 0) : 0)
  const lastRun = useRef(0)
  const busy = useRef(false)

  const load = useCallback(async ({ withChains = true } = {}) => {
    if (busy.current) return
    busy.current = true
    lastRun.current = Date.now()
    setState((prev) => (prev.refreshing ? prev : { ...prev, refreshing: true }))
    try {
      // WAVE 2 kicks off FIRST — the per-chain cohorts are data-independent of
      // the verdict, so they load concurrently instead of waiting behind wave 1
      // (the old waterfall put chain cards at wave1+wave2 wall-clock).
      const wantChains = withChains || !chainsRef.current
      // stamped at KICK-OFF, not on landing: stamping when the wave lands puts
      // the clock ~3s behind the interval, so the 180s tick always just misses
      // and the chain cards quietly refresh every 4 minutes instead of 3.
      if (wantChains) chainsAt.current = Date.now()
      const chainsPromise = wantChains
        ? Promise.all(CHAINS.map((c) => loadChain(c).catch(() => null)))
        : null

      // movers ride OUTSIDE the blocking gate: /v1/bubbles measured 12-15s cold
      // (502-prone) and only feeds the below-the-fold movers panel — it must
      // never gate the verdict hero (founder 07-31: "microcaps loading speed").
      // It also rides the SLOW clock: a 12s endpoint has no business firing on
      // the header's cadence.
      if (wantChains) {
        getSpectreTokenMovers(12).catch(() => null).then((moversRaw) => {
          if (!moversRaw) return
          const movers = {
            gainers: (moversRaw.gainers || moversRaw.top_gainers || []).slice(0, 6),
            losers: (moversRaw.losers || moversRaw.top_losers || []).slice(0, 6),
          }
          setState((prev) => ({ ...prev, movers }))
        })
      }

      // WAVE 1 — the verdict + hero + cycle chart (fast). Paints immediately.
      const [gm, domHist, alt, o2d, o2box, majPx] = await Promise.all([
        getSpectreGlobalMetrics().catch(() => null),
        getSpectreDominanceHistory(35).catch(() => null),
        getSpectreAltSeason().catch(() => null),
        getOthers2Data().catch(() => null),
        getSpectreOthers2History().catch(() => null),
        getSpectrePricesBySymbols(['BTC', 'ETH', 'SOL']).catch(() => null),
      ])

      // dominance 30d delta (rising = bad for alts)
      const btcDomNow = num(gm?.btcDominance)
      let domDelta30d = null
      const dh = Array.isArray(domHist?.history) ? domHist.history : Array.isArray(domHist) ? domHist : []
      if (dh.length >= 2 && btcDomNow != null) {
        const first = dh[0]
        const past = num(first?.btc ?? first?.btcDominance ?? first?.btc_dominance ?? first?.value)
        if (past != null) domDelta30d = btcDomNow - past
      }

      // alt breadth + agg from the top-50 alt cohort
      const b = o2d?.breadth
      const altSeasonIdx = num(b?.index) ?? num(alt?.index) ?? null
      const breadth7d = num(b?.green7) ?? num(b?.green30) ?? null
      const alt7 = num(o2d?.aggChanges?.d7)

      // OTHERS2 7d trend + cycle depth ("how ATL are the micros?") — shared math
      // 🪤 `history` mixes a weekly MODEL (2020 → 2026-07-22, seeded before the
      // recorder existed) with the 15-min tape that follows it. Charting both as
      // one line draws a synthetic monotonic ramp welded to real data. The chart
      // and the 7d trend take the tape; cycle depth is an explicit
      // floor→2021-peak range read, so it keeps the full series.
      const rawHist = Array.isArray(o2box?.history) ? o2box.history : []
      // Chain-linked ONCE, here, so the chart, the 7d trend and the cycle-depth
      // gauge all read the same rebased tape. `seamAt` is kept off the RAW rows
      // — after linking there is nothing left to find.
      const seamAt = findSeam(rawHist.filter((p) => p.src !== 'modeled'))
      const hist = chainLink(rawHist)
      const live = hist.filter((p) => p.src !== 'modeled')
      const tape = live.length > 1 ? live : hist
      const o2now = num(o2box?.current?.others2) ?? (tape.length ? num(tape[tape.length - 1].o) : null)
      const o2trend = buildTrendWindow(tape, o2now)
      const others2Trend7d = o2trend ? o2trend.pct : null
      const depth = buildDepth(hist, o2now)

      // MAJORS momentum (BTC/ETH/SOL 7d) — the trigger the user cares about: when
      // majors push, are people bidding down into micros yet? Rotation = alts
      // OUTPERFORMING majors (money flowing down the curve), not just alts up.
      const majKeys = ['BTC', 'ETH', 'SOL']
      const majors = majKeys.map((sym) => {
        const p = majPx?.[sym] || {}
        return {
          sym,
          chg7d: num(p.change?.['7d'] ?? p.change_7d_pct ?? p.change7d),
          chg30d: num(p.change?.['30d'] ?? p.change_30d_pct ?? p.change30d),
          chg24h: num(p.change?.['24h'] ?? p.change_24h_pct ?? p.change24h),
        }
      }).filter((m) => m.chg30d != null || m.chg7d != null)
      // "the push" = 30d majors momentum (7d misses ETH/SOL's actual leg up)
      const majAvg30 = majors.filter((m) => m.chg30d != null)
      const majorsAvg30d = majAvg30.length ? majAvg30.reduce((sum, m) => sum + m.chg30d, 0) / majAvg30.length : null
      const topMajor = [...majors].filter((m) => m.chg30d != null).sort((x, y) => y.chg30d - x.chg30d)[0]
      // rotation tell: alt long-tail 30d MINUS majors 30d (alts leading = bidding down)
      const majorsVsAlts = (Number.isFinite(num(o2d?.aggChanges?.d30)) && majorsAvg30d != null)
        ? num(o2d.aggChanges.d30) - majorsAvg30d
        : alt7

      // ONE verdict builder, called twice: once on the macro legs we already
      // hold, again the moment the chain wave lands. The on-chain leg is what
      // lets the headline see a two-day DEX surge instead of printing "NOT GO
      // TIME" over four chain cards that are all lit up.
      const macro = { domDelta30d, altSeasonIdx, breadth7d, others2Trend7d, others2TrendDays: o2trend?.days, majorsVsAlts }
      const buildFor = (chains) => {
        const v = buildVerdict({ ...macro, onchain: onchainPulse(chains) })
        v.setup = buildSetup({ majorsAvg30d, topMajor, alt30d: num(o2d?.aggChanges?.d30), others2Trend7d })
        v.frontrun = computeFrontrun(chains, v.band)
        return v
      }

      const signals = {
        btcDominance: btcDomNow, ethDominance: num(gm?.ethDominance), solDominance: num(gm?.solDominance),
        domDelta30d, altSeasonIdx, breadth7d, alt7, others2Trend7d, majorsVsAlts,
        outperforming: num(b?.outperforming), totalAlts: num(b?.total),
      }
      const others2 = o2box ? {
        current: o2now, share: num(o2box?.current?.share), trend7d: others2Trend7d,
        history: tape.map((p) => ({ ts: p.ts, o: p.o })).filter((p) => p.ts && p.o > 0),
        recordedFrom: tape.length ? tape[0].ts : null,
        // when the number itself was last printed — the 15-min recorder can
        // stall (measured 4.7h behind on 2026-08-20) and the page has no way to
        // know unless the tape says so.
        currentAt: num(o2box?.current?.at) ?? (tape.length ? tape[tape.length - 1].ts : null),
        trendDays: o2trend?.days ?? null,
        // the moment the measurement changed, so the chart can disclose the rebase
        seamAt,
      } : null

      // paint the hero + cycle chart NOW; movers/chains keep prior values until
      // their own commits land
      const t1 = Date.now()
      setState((prev) => {
        const next = {
          ...prev, loading: false, refreshing: !!chainsPromise,
          verdict: buildFor(chainsRef.current), signals, depth, majors, others2, updatedAt: t1,
        }
        if (!chainsPromise) writeAltSeed(next)
        return next
      })

      // WAVE 2 — already in flight since the top of load(); commit + seed
      if (!chainsPromise) return
      const chains = (await chainsPromise).filter(Boolean)
      if (chains.length) chainsRef.current = chains
      setState((prev) => {
        const next = {
          ...prev, refreshing: false, updatedAt: Date.now(),
          chains: chains.length ? chains : prev.chains,
          verdict: buildFor(chainsRef.current),
        }
        writeAltSeed(next)
        return next
      })
    } finally {
      busy.current = false
      // a thrown leg must never leave the pill stuck on "Updating"
      setState((prev) => (prev.refreshing ? { ...prev, refreshing: false } : prev))
    }
  }, [])

  useEffect(() => {
    let alive = true
    const tick = () => {
      if (!alive) return
      load({ withChains: Date.now() - chainsAt.current >= CHAIN_MS })
    }
    load({ withChains: true })
    timer.current = setInterval(() => { if (!document.hidden && isAppActive()) tick() }, HEAD_MS)
    // Coming back to the tab must not leave a minutes-old header on screen until
    // the next interval fires — that is exactly the stale hero a screenshot
    // catches. Revalidate on return, guarded so tab-flicking can't hammer it.
    const wake = () => {
      if (document.hidden || !isAppActive()) return
      if (Date.now() - lastRun.current < WAKE_MIN_MS) return
      tick()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    const unsub = subscribeActivity((active) => { if (active) wake() })
    return () => {
      alive = false
      if (timer.current) clearInterval(timer.current)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      unsub()
    }
  }, [load])

  return { ...state, reload: load }
}
