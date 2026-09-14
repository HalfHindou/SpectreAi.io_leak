// Majors watch — BTC/ETH the WatcherGuru way: round-number key-level crosses
// ("BITCOIN CROSSES $120,000") and violent one-hour moves, delivered as
// Market Pulse cards through the normal signal pipeline. Fully deterministic:
// one /v1/prices call per tick, levels on a 1/2/5×10^n grid sized to ~4% of
// price, every fire fingerprinted via store.contentSeen so restarts and grid
// chop never replay an alert.
const api = require('./spectre-api')
const store = require('./store')
const { pct } = require('./format')

const WATCH = [
  { sym: 'BTC', name: 'Bitcoin', surge1h: 2.5 },
  { sym: 'ETH', name: 'Ethereum', surge1h: 3.5 },
]

// in-memory price ring per symbol (~80 min of 45s ticks). A restart only
// blinds the surge lane for its first half hour — level crosses need just the
// previous tick, which the first post-boot tick primes.
const hist = new Map()

// round step ≈4% of price on a 1/2/5 grid: $118k → $5,000 · $4.2k → $200
function niceStep(p) {
  const raw = p * 0.04
  const mag = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag
  return 10 * mag
}

const lvlFmt = (n) => `$${Math.round(n).toLocaleString('en-US')}`

// deterministic read — level and surge lanes each speak risk-first
function watchRead(kind, dir, name, lvl, chg1h) {
  const hour = Number.isFinite(chg1h) ? `${chg1h > 0 ? '+' : ''}${chg1h.toFixed(1)}% on the hour` : null
  if (kind === 'level' && dir === 'up') return `${name} took out the ${lvl} round number${hour ? ` (${hour})` : ''}. Round levels are liquidity magnets — acceptance above turns them into support; a fast rejection is the trap.`
  if (kind === 'level') return `${name} lost the ${lvl} round number${hour ? ` (${hour})` : ''}. Lost round levels flip to resistance — wait for a reclaim before knife-catching.`
  if (dir === 'up') return `${name} vertical — ${hour} without a headline attached. Chasing green candles is exit liquidity; the retrace tells you if it's real.`
  return `${name} air-pocket — ${hour}. Cascades overshoot; let the tape stabilize before catching.`
}

function card(sym, name, kind, dir, headline, priceNow, chg1h, chg24) {
  const tape = []
  tape.push(`<b>${name}</b> <code>$${Math.round(priceNow).toLocaleString('en-US')}</code>`)
  if (Number.isFinite(chg1h)) tape.push(`1h ${pct(chg1h, 1)}`)
  if (Number.isFinite(chg24)) tape.push(`24h ${pct(chg24, 1)}`)
  return {
    cat: 'pulse',
    asset: sym,
    readText: watchRead(kind, dir, name, headline.match(/\$[\d,]+/)?.[0], chg1h),
    text: [
      `🚨 <b>${headline}</b>`,
      `▸ ${tape.join(' · ')}`,
      `<i>⌁ Spectre Intelligence · Majors Watch</i>`,
    ].join('\n'),
  }
}

// one scan per poller tick — returns outbox-ready messages (usually none)
async function scan() {
  const out = []
  const px = await api.prices(WATCH.map((w) => w.sym), { ttlMs: 20e3 }).catch(() => null)
  if (!px) return out
  for (const w of WATCH) {
    const row = px[w.sym]
    const cur = Number(row?.price ?? row?.usd ?? NaN)
    if (!Number.isFinite(cur) || cur <= 0) continue
    const chg24 = Number(row?.change?.['24h'] ?? row?.change_24h_pct ?? row?.change24h ?? NaN)
    const now = Date.now()
    const ring = hist.get(w.sym) || []
    const prev = ring.length ? ring[ring.length - 1].p : null
    ring.push({ t: now, p: cur })
    while (ring.length && now - ring[0].t > 80 * 60e3) ring.shift()
    hist.set(w.sym, ring)
    if (prev == null) continue // first tick primes only

    // 1h move — measured against the oldest point at least 30 min back
    const base = ring.find((r) => now - r.t >= 30 * 60e3)
    const chg1h = base ? ((cur - base.p) / base.p) * 100 : NaN

    // key-level cross: fire the outermost round number crossed since last tick.
    // No price hysteresis — a $100-past-the-level print IS the cross (a gate
    // there can miss it forever); chop is bounded instead by the per-level+
    // direction 12h fingerprint and the 45-min per-symbol lane cooldown.
    const step = niceStep(Math.max(prev, cur))
    const dir = cur > prev ? 'up' : 'down'
    const lo = Math.min(prev, cur)
    const hi = Math.max(prev, cur)
    const levels = []
    for (let k = Math.ceil(lo / step) * step; k <= hi; k += step) levels.push(k)
    const lvl = dir === 'up' ? levels[levels.length - 1] : levels[0]
    let leveled = false
    if (
      lvl != null &&
      !store.contentSeen(`mj:lvl:${w.sym}:${lvl}:${dir}`, 12 * 3600e3) &&
      !store.contentSeen(`mj:lvl-lane:${w.sym}`, 45 * 60e3)
    ) {
      leveled = true
      const headline = dir === 'up' ? `${w.name.toUpperCase()} CROSSES ${lvlFmt(lvl)}` : `${w.name.toUpperCase()} FALLS BELOW ${lvlFmt(lvl)}`
      out.push({ id: `mj:lvl:${w.sym}:${lvl}:${dir}`, ...card(w.sym, w.name, 'level', dir, headline, cur, chg1h, chg24) })
    }

    // violent hour — suppressed when a level card already carries the move
    if (!leveled && Number.isFinite(chg1h) && Math.abs(chg1h) >= w.surge1h) {
      const sdir = chg1h > 0 ? 'up' : 'down'
      if (!store.contentSeen(`mj:surge:${w.sym}:${sdir}`, 3 * 3600e3)) {
        const headline =
          sdir === 'up'
            ? `${w.name.toUpperCase()} SURGES ${chg1h.toFixed(1)}% IN AN HOUR`
            : `${w.name.toUpperCase()} DUMPS ${Math.abs(chg1h).toFixed(1)}% IN AN HOUR`
        out.push({ id: `mj:surge:${w.sym}:${sdir}:${Math.round(Date.now() / 3600e3)}`, ...card(w.sym, w.name, 'surge', sdir, headline, cur, chg1h, chg24) })
      }
    }
  }
  return out
}

module.exports = { scan }
