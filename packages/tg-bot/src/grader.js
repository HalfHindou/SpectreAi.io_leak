// Alert self-grading: every signal alert the bot delivers gets an entry
// snapshot at send time and is graded at +4h / +24h / +72h against live data.
// Contract tokens grade by DexScreener mcap (survives CG identity bugs);
// majors grade by /v1/prices. This is the receipts layer — the thing that
// lets alert copy say "this alert type: X% hit rate, n=Y" honestly.
const api = require('./spectre-api')
const store = require('./store')
const { esc, pct } = require('./format')

const HORIZONS = [4, 24, 72] // hours
const WIN_PCT = 15 // "win" = +15% at any graded horizon (matches the FIRE-rule backtest)

async function snapshot(asset, contract) {
  if (contract) {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contract}`, { signal: AbortSignal.timeout(10e3) }).catch(() => null)
    const pairs = res?.ok ? (await res.json().catch(() => null))?.pairs || [] : []
    if (pairs.length) {
      const p = pairs.reduce((a, b) => ((b.liquidity?.usd || 0) > (a.liquidity?.usd || 0) ? b : a))
      const val = p.marketCap || p.fdv || (p.priceUsd ? +p.priceUsd : null)
      if (val) return { value: val, basis: p.marketCap || p.fdv ? 'mcap' : 'price' }
    }
  }
  if (asset) {
    const data = await api.prices([asset], { ttlMs: 1 }).catch(() => null)
    const row = data?.[String(asset).toUpperCase()]
    if (row?.price) return { value: row.price, basis: 'price' }
  }
  return null
}

// called fire-and-forget right after an alert is first delivered
async function track(msg) {
  try {
    if (!msg.asset && !msg.contract) return
    const snap = await snapshot(msg.asset, msg.contract)
    store.recordDelivery({
      id: msg.id,
      cat: msg.cat,
      asset: msg.asset || null,
      contract: msg.contract || null,
      at: new Date().toISOString(),
      entry: snap, // may be null — grades stay pending-null (honest gap)
      grades: {},
    })
  } catch (e) {
    console.error('[grader] track failed:', e.message)
  }
}

function startGrader() {
  setInterval(async () => {
    try {
      const now = Date.now()
      const due = store.allDeliveries().filter((d) => {
        if (!d.entry?.value) return false
        return HORIZONS.some((h) => d.grades?.[`h${h}`] === undefined && now - new Date(d.at).getTime() >= h * 3600e3)
      })
      for (const d of due.slice(0, 10)) {
        const snap = await snapshot(d.asset, d.contract)
        if (!snap?.value) continue
        const ret = ((snap.value - d.entry.value) / d.entry.value) * 100
        const grades = { ...d.grades }
        for (const h of HORIZONS) {
          if (grades[`h${h}`] === undefined && now - new Date(d.at).getTime() >= h * 3600e3) {
            grades[`h${h}`] = Math.round(ret * 100) / 100
          }
        }
        store.updateDelivery(d.id, { grades })
        await new Promise((r) => setTimeout(r, 400))
      }
    } catch (e) {
      console.error('[grader] cycle failed:', e.message)
    }
  }, 30 * 60e3)
}

function receiptsCard() {
  const all = store.allDeliveries()
  if (!all.length) return '🧾 No graded alerts yet — receipts build as alerts fire and mature.'
  const lines = ['🧾 <b>Alert Receipts</b> — every alert graded vs live data', '']
  const byCat = {}
  for (const d of all) (byCat[d.cat] = byCat[d.cat] || []).push(d)
  for (const [cat, ds] of Object.entries(byCat)) {
    const graded24 = ds.filter((d) => d.grades?.h24 !== undefined)
    const graded72 = ds.filter((d) => d.grades?.h72 !== undefined)
    const wins = (set, h) => set.filter((d) => d.grades[`h${h}`] >= WIN_PCT).length
    const line = [`<b>${esc(cat)}</b> — ${ds.length} sent`]
    if (graded24.length) line.push(`24h: ${wins(graded24, 24)}/${graded24.length} hit +${WIN_PCT}%`)
    if (graded72.length) line.push(`72h: ${wins(graded72, 72)}/${graded72.length}`)
    if (!graded24.length && !graded72.length) line.push('grading…')
    lines.push(line.join(' · '))
  }
  const recent = all.filter((d) => d.grades?.h24 !== undefined).slice(-6).reverse()
  if (recent.length) {
    lines.push('', '<b>Recent graded</b>')
    for (const d of recent) {
      const g = d.grades
      lines.push(
        `${g.h24 >= WIN_PCT ? '🟢' : g.h24 >= 0 ? '⚪' : '🔴'} <b>${esc(d.asset || '?')}</b> ${pct(g.h4)} 4h · ${pct(g.h24)} 24h${g.h72 !== undefined ? ` · ${pct(g.h72)} 72h` : ''}`,
      )
    }
  }
  lines.push('', '<i>Win = +15%. Small n = directional only. We grade ourselves so you don’t have to trust us.</i>')
  return lines.join('\n')
}

module.exports = { track, startGrader, receiptsCard }
