/**
 * useNarrativeRadar — the "what's moving sentiment beyond crypto-Twitter"
 * layer: Spectre Brain narratives/risks/catalysts, the policy + macro news
 * tape (Trump, Fed, SEC, tariffs, ETFs…), and upcoming high-impact calendar
 * events — all filtered to THIS token and its class.
 *
 * Class contract (Sunny 2026-07-02): majors trade on the policy/macro tape,
 * onchain small caps mostly don't — so micro/nano/meme surfaces token-specific
 * headlines + Brain reads only, and the consumer renders an honest note
 * instead of irrelevant Fed prints.
 *
 * Sources (all existing, dev + prod):
 *   /api/brain                    -> data.state.{narratives, conviction}
 *   /data-api/v1/news?limit=40    -> categorized headlines w/ relatedAssets
 *   /api/calendar/economic        -> econ events w/ impact / isFedEvent / isCrypto
 *
 * Progressive: each source lands independently; module-cached.
 */
import { useState, useEffect } from 'react'
import { decodeHtmlEntities } from '@/utils/html'

const _cache = new Map()
const _inflight = new Map()

function cached(key, ttl, fetchFn) {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.data)
  if (_inflight.has(key)) return _inflight.get(key)
  const p = fetchFn()
    .then((data) => {
      _cache.set(key, { data, ts: Date.now() })
      _inflight.delete(key)
      return data
    })
    .catch((err) => {
      _inflight.delete(key)
      throw err
    })
  _inflight.set(key, p)
  return p
}

async function fetchJson(url, timeoutMs = 12_000) {
  // credentials: 'include' — /api/brain + /api/calendar are gate-cookie'd; the iOS
  // PWA drops the cookie without this -> 401 -> empty Narrative Radar on the phone.
  const r = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`${url} ${r.status}`)
  return r.json()
}

/* Policy / macro-politics detector — headlines that move the whole tape. */
const POLICY_RE = /\b(trump|tariff|white house|congress|senate|the sec|sec sues?|sec approv|sec chair|cftc|fed\b|fomc|rate (cut|hike|decision)|powell|treasury|sanction|election|regulat\w*|executive order|stablecoin (bill|act)|genius act|mica|lawsuit|etf (approval|inflow|outflow|launch)|spot etf|strategic reserve|debt ceiling|shutdown|inflation|cpi\b|nonfarm|geopolit)\b/i
const POLICY_CATEGORIES = new Set(['regulatory', 'regulation', 'policy', 'politics', 'government', 'macro', 'legal'])

function normalizeHeadline(row) {
  const ts = row.published_at || row.publishedAt || row.date || row.created_at || row.time || null
  return {
    id: row.id || row.url,
    title: decodeHtmlEntities(String(row.title || '')).trim(),
    url: row.url || null,
    source: row.source || row.sourceDomain || null,
    category: (row.category || '').toLowerCase() || null,
    assets: Array.isArray(row.relatedAssets) ? row.relatedAssets.map((a) => String(a).toUpperCase()) : [],
    ts: ts ? new Date(ts).getTime() : null,
  }
}

/* Raw SEC EDGAR filing dumps ("8-K — SOME CORP (Filer)") technically match the
   regulatory bucket but are noise, not narrative. */
const FILING_SPAM_RE = /\(filer\)\s*$|^(8-k|10-[kq]|s-\d|6-k|form\s)/i
const isFilingSpam = (h) => FILING_SPAM_RE.test(h.title) || /edgar/i.test(h.source || '')

function pickNews(rows, sym) {
  const seen = new Set()
  const tokenNews = []
  const policyNews = []
  for (const raw of rows) {
    const h = normalizeHeadline(raw)
    if (!h.title || seen.has(h.title)) continue
    seen.add(h.title)
    if (isFilingSpam(h)) continue
    const isToken = h.assets.includes(sym)
    const isPolicy = POLICY_CATEGORIES.has(h.category) || POLICY_RE.test(h.title)
    if (isToken && tokenNews.length < 4) tokenNews.push({ ...h, bucket: 'token' })
    else if (isPolicy && policyNews.length < 4) policyNews.push({ ...h, bucket: 'policy' })
    if (tokenNews.length >= 4 && policyNews.length >= 4) break
  }
  return { tokenNews, policyNews }
}

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function pickEvents(events, sym) {
  const now = Date.now()
  const horizon = now + 7 * 86400e3
  // Escape metachars — tickers like "C+" or "$FOO" would otherwise throw in
  // new RegExp and silently drop all events for the token (caught upstream).
  const symRe = new RegExp(`\\b${escapeRegExp(sym)}\\b`, 'i')
  return (events || [])
    .map((e) => ({
      id: e.id,
      name: e.nameShort || e.name,
      country: e.country || null,
      impact: e.impact || null,
      isFed: !!e.isFedEvent,
      isCrypto: !!e.isCryptoRelevant || !!e.isCrypto,
      t: e.dateTime ? new Date(e.dateTime).getTime() : null,
    }))
    .filter((e) => e.t && e.t > now - 6 * 3600e3 && e.t < horizon)
    // Macro prints (Fed / high impact) always matter to the tape; crypto
    // calendar items (DAO votes, unlocks…) only when they NAME this asset —
    // Arbitrum governance is not a BTC catalyst.
    .filter((e) => e.isFed || e.impact === 'high' || (e.isCrypto && symRe.test(e.name || '')))
    .sort((a, b) => a.t - b.t)
    .slice(0, 5)
}

function pickBrain(state, sym, marketFallback) {
  if (!state) return null
  const touches = (assets) => Array.isArray(assets) && assets.some((a) => String(a).toUpperCase() === sym)
  const allNarratives = Array.isArray(state.narratives) ? state.narratives : []
  let narratives = allNarratives.filter((n) => touches(n.assets))
  let narrativesScope = 'token'
  // Market-wide fallback (top narratives regardless of asset) ONLY for majors
  // that actually ARE the macro tape — BTC/ETH/top-10. A Solana memecoin must
  // never inherit "DeFi Resurgence / ETH liquidations" as its narrative.
  if (!narratives.length && allNarratives.length && marketFallback) {
    narratives = allNarratives.slice(0, 2)
    narrativesScope = 'market'
  }
  const conviction = state.conviction || {}
  const risks = (Array.isArray(conviction.risks) ? conviction.risks : []).filter((r) => touches(r.assets)).slice(0, 3)
  const catalysts = (Array.isArray(conviction.catalysts) ? conviction.catalysts : [])
    .filter((c) => touches(c.assets))
    // A catalyst with a parseable PAST date is not "ahead" — drop it rather
    // than render yesterday's event as upcoming. Unparseable dates ("Q4",
    // "soon") pass through — the copy carries its own vagueness.
    .filter((c) => {
      const t = c.date ? Date.parse(c.date) : NaN
      return !Number.isFinite(t) || t > Date.now() - 12 * 3600e3
    })
    .slice(0, 4)
  return {
    narratives: narratives.slice(0, 3),
    narrativesScope,
    risks,
    catalysts,
    verdict: typeof conviction.verdict === 'string' ? conviction.verdict : null,
    updatedAt: state.updated_at || null,
  }
}

export default function useNarrativeRadar(symbol, { includeMacroTape = true, marketFallback = false, enabled = true } = {}) {
  const sym = String(symbol || '').toUpperCase()
  const [state, setState] = useState({ brain: null, tokenNews: [], policyNews: [], events: [], loading: true })

  useEffect(() => {
    if (!enabled || !sym) {
      setState({ brain: null, tokenNews: [], policyNews: [], events: [], loading: false })
      return undefined
    }
    let cancelled = false
    // Reset on token switch so the previous token's brain/news/events don't
    // linger under the new symbol (and a skeleton shows while it loads).
    setState({ brain: null, tokenNews: [], policyNews: [], events: [], loading: true })
    const merge = (patch) => { if (!cancelled) setState((s) => ({ ...s, ...patch })) }

    const pBrain = cached('brain', 120_000, () => fetchJson('/api/brain'))
      .then((d) => merge({ brain: pickBrain(d?.data?.state || d?.state || null, sym, marketFallback) }))
      .catch(() => {})

    const pNews = cached('news40', 120_000, () => fetchJson('/data-api/v1/news?limit=40'))
      .then((d) => {
        const rows = Array.isArray(d?.data) ? d.data : []
        merge(pickNews(rows, sym))
      })
      .catch(() => {})

    const pCal = includeMacroTape
      ? cached('calendar', 300_000, () => fetchJson('/api/calendar/economic'))
        .then((d) => merge({ events: pickEvents(d?.events || d?.data || [], sym) }))
        .catch(() => {})
      : Promise.resolve()

    Promise.allSettled([pBrain, pNews, pCal]).then(() => merge({ loading: false }))
    return () => { cancelled = true }
  }, [enabled, sym, includeMacroTape, marketFallback])

  return state
}
