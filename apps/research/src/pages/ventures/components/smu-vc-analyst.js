/**
 * smu-vc-analyst — derives a "what is this fund actually doing" read from the
 * data we already have (holdings × live prices × sector taxonomy × stated 2026
 * focus). Pure + deterministic, so the AI Analyst box always has something real
 * to say; an LLM narrative layer can be grafted on top later without changing
 * this contract.
 */
import { SECTORS, parseUsdAum, fmtUsdCompact, fmtPct, isTradeableSymbol } from './smu-shared'

const U = (s) => String(s || '').toUpperCase()

function topHoldings(entity, priceMap) {
  const out = []
  const seen = new Set()
  for (const raw of entity.known_portfolio_tokens || []) {
    if (!isTradeableSymbol(raw)) continue
    const sym = U(raw)
    if (seen.has(sym)) continue
    seen.add(sym)
    const p = priceMap?.[sym] || null
    out.push({ symbol: sym, marketCap: p?.marketCap ?? 0, change24h: p?.change24h ?? null, image: p?.image || null })
  }
  // Conviction proxy: biggest market caps first (a fund's mega-cap exposure
  // anchors its book), then alphabetic for stability.
  out.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0) || a.symbol.localeCompare(b.symbol))
  return out
}

function sectorMix(entity) {
  const held = new Set((entity.known_portfolio_tokens || []).map(U))
  const mix = []
  for (const s of SECTORS) {
    const sig = s.tokens.map(U)
    const n = sig.filter((t) => held.has(t)).length
    if (n > 0) mix.push({ key: s.key, label: s.label, count: n })
  }
  const total = mix.reduce((a, b) => a + b.count, 0) || 1
  mix.forEach((m) => { m.weight = m.count / total })
  mix.sort((a, b) => b.count - a.count)
  return mix
}

export function analyzeVc(entity, priceMap) {
  if (!entity) return null
  const holdings = topHoldings(entity, priceMap)
  const mix = sectorMix(entity)
  const priced = holdings.filter((h) => Number.isFinite(h.change24h))
  const momentum = priced.length ? priced.reduce((s, h) => s + h.change24h, 0) / priced.length : null

  // Best / worst live mover in the book today.
  let leader = null
  let laggard = null
  for (const h of priced) {
    if (!leader || h.change24h > leader.change24h) leader = h
    if (!laggard || h.change24h < laggard.change24h) laggard = h
  }

  const n = holdings.length
  const concentration = n === 0 ? 'no tracked' : n <= 4 ? 'concentrated' : n <= 9 ? 'focused' : 'diversified'
  const top = mix.slice(0, 2).map((m) => m.label)
  const conviction = holdings.slice(0, 4).map((h) => h.symbol)
  const focus = entity.recent_focus_2026 || []
  const aum = parseUsdAum(entity.aum_estimate)

  // Templated narrative that reads like a desk analyst note — built only from
  // real, current numbers.
  const parts = []
  if (top.length) {
    parts.push(`${entity.name} runs a ${concentration} book${aum ? ` (${fmtUsdCompact(aum)} AUM)` : ''} tilted toward ${top.join(' and ')}.`)
  } else {
    parts.push(`${entity.name} — limited public token positioning on file.`)
  }
  if (conviction.length) {
    parts.push(`Highest-conviction exposure: ${conviction.map((c) => `$${c}`).join(', ')}.`)
  }
  if (Number.isFinite(momentum)) {
    const dir = momentum >= 0 ? 'up' : 'down'
    let tail = ''
    if (momentum >= 0 && leader) tail = `, led by $${leader.symbol} (${fmtPct(leader.change24h)})`
    if (momentum < 0 && laggard) tail = `, dragged by $${laggard.symbol} (${fmtPct(laggard.change24h)})`
    parts.push(`The tracked book is ${dir} ${fmtPct(Math.abs(momentum))} over 24h${tail}.`)
  }
  if (focus.length) {
    parts.push(`2026 conviction is rotating into ${focus.join(', ')}.`)
  }

  return {
    narrative: parts.join(' '),
    mix: mix.slice(0, 5),
    conviction: holdings.slice(0, 6),
    momentum,
    leader,
    laggard,
    concentration,
    holdingsCount: n,
    focus,
  }
}
