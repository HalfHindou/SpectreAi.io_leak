/**
 * DeskBriefCard — the Bloomberg-style desk introduction pinned above the feed.
 *
 * Three layers, one card: Today (the morning desk note — what happened
 * overnight, the mechanism, today's catalysts), This Week (the Monday setup —
 * the calendar and why it matters), and a standing big-picture line. Written
 * by the desk engine on the box (deterministic fact context first, the model
 * narrates only whitelisted numbers), served from /v1/briefs/desk, and shown
 * here with its own timestamps — a brief that cannot say when it was written
 * does not render.
 *
 * Mounted twice by design (founder call 2026-08-27): pinned above the Intel
 * Desk feed, and again at the head of the Market Summary tab on Welcome — the
 * same note the Telegram desk push carries. `className` lets each host set its
 * own spacing without a second copy of the card.
 *
 * Honesty: absence hides the card entirely (no skeleton promising content the
 * engine has not produced), and a note older than its cadence carries a stale
 * chip rather than pretending to be this morning's.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/hooks/useMediaQuery'
import './DeskBriefCard.css'

const POLL_MS = 5 * 60_000
const TYPES = [
  { key: 'morning', label: 'Today' },
  { key: 'week_ahead', label: 'This week' },
  { key: 'big_picture', label: 'Big picture' },
]
const STALE_MS = {
  morning: 30 * 60 * 60 * 1000,
  week_ahead: 8.5 * 24 * 60 * 60 * 1000,
  big_picture: 15 * 24 * 60 * 60 * 1000,
}

function ago(ts) {
  if (!ts) return null
  const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

async function fetchBriefs() {
  const r = await fetch('/data-api/v1/briefs/desk', { signal: AbortSignal.timeout(15_000) })
  if (!r.ok) return null
  const j = await r.json()
  const rows = j?.data?.briefs || j?.briefs
  return Array.isArray(rows) ? rows : null
}

function paragraphs(body) {
  return String(body || '')
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

// Founder call 2026-08-25: the engine's plain text was a wall — light up the
// asset names and set every figure in the app's number face so the eye can
// scan the note. Deterministic client-side markup only; the text itself is
// untouched (the engine's number-whitelist validator already guarantees it).
const RICH_RE = new RegExp(
  '(\\b(?:Bitcoin|Ethereum|Solana|Dogecoin|Cardano|Avalanche|Chainlink|Hyperliquid|Zcash|Litecoin|Toncoin|Sui|BTC|ETH|SOL|XRP|BNB|DOGE|ADA|AVAX|LINK|HYPE|ZEC|LTC|TON)\\b)' +
  '|(\\$\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?(?:\\s?(?:million|billion|trillion|[kKMBT]\\b))?|\\d+(?:\\.\\d+)?%|\\b\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?\\b)',
  'g',
)
function richText(text) {
  const out = []
  let last = 0
  let m
  RICH_RE.lastIndex = 0
  while ((m = RICH_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) out.push(<strong key={out.length} className="dbrief-asset">{m[0]}</strong>)
    else out.push(<span key={out.length} className="dbrief-num">{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function DeskBriefCard({ className = '' }) {
  const { t: tr } = useTranslation()
  const [briefs, setBriefs] = useState(null)
  const [tab, setTab] = useState('morning')
  const [expanded, setExpanded] = useState(false)
  const cancelled = useRef(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    cancelled.current = false
    const load = async () => {
      try {
        const rows = await fetchBriefs()
        if (!cancelled.current && rows) setBriefs(rows)
      } catch { /* absence hides the card */ }
    }
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    return () => { cancelled.current = true; clearInterval(t) }
  }, [])

  const byType = useMemo(() => {
    const m = {}
    for (const b of briefs || []) {
      if (!b?.type || !b?.body || !b?.generated_at) continue
      if (!m[b.type] || new Date(b.generated_at) > new Date(m[b.type].generated_at)) m[b.type] = b
    }
    return m
  }, [briefs])

  const available = TYPES.filter((t) => byType[t.key])
  if (!available.length) return null
  const active = byType[tab] ? tab : available[0].key
  const brief = byType[active]
  const paras = paragraphs(brief.body)
  const stale = Date.now() - new Date(brief.generated_at).getTime() > (STALE_MS[active] || STALE_MS.morning)
  // Two paragraphs is a readable preview on a desktop column and a wall of text
  // on a phone — the desk's second paragraph routinely runs 200+ words. Show the
  // lede alone on mobile and let the reader ask for the rest.
  const clampTo = isMobile ? 1 : 2
  const shown = expanded ? paras : paras.slice(0, clampTo)
  const clamped = paras.length > clampTo && !expanded

  return (
    <section className={`dbrief${className ? ` ${className}` : ''}`} aria-label={tr('deskBrief.deskbrief.ariaDeskBrief', "desk brief")}>
      <header className="dbrief-head">
        <div className="dbrief-head-left">
          <span className="dbrief-eyebrow">{tr('deskBrief.deskbrief.deskBrief', "Desk brief")}</span>
          {brief.title && <h2 className="dbrief-title">{brief.title}</h2>}
        </div>
        <div className="dbrief-head-right">
          {available.length > 1 && (
            <div className="dbrief-tabs" role="tablist" aria-label={tr('deskBrief.deskbrief.ariaBriefWindow', "brief window")}>
              {available.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active === t.key}
                  className={`dbrief-tab${active === t.key ? ' is-active' : ''}`}
                  onClick={() => { setTab(t.key); setExpanded(false) }}
                >{tr(`deskBrief.type.${t.key}`, t.label)}</button>
              ))}
            </div>
          )}
          <span className={`dbrief-when${stale ? ' dbrief-when--stale' : ''}`} title={brief.data_asof ? `data as of ${new Date(brief.data_asof).toLocaleString()}` : undefined}>
            {stale ? `stale · ${ago(brief.generated_at)}` : ago(brief.generated_at)}
          </span>
        </div>
      </header>
      <div className="dbrief-body">
        {shown.map((p, i) => <p key={i} className={i === 0 ? 'dbrief-lede' : undefined}>{richText(p)}</p>)}
      </div>
      {clamped && (
        <button type="button" className="dbrief-more" onClick={() => setExpanded(true)}>
          {tr('deskBrief.deskbrief.readTheFullNote', "Read the full note")}
        </button>
      )}
      {expanded && paras.length > clampTo && (
        <button type="button" className="dbrief-more" onClick={() => setExpanded(false)}>
          {tr('deskBrief.deskbrief.collapse', "Collapse")}
        </button>
      )}
      <p className="dbrief-foot">
        {tr('deskBrief.deskbrief.writtenBy', 'Written by the desk engine from live Spectre data')}
        {brief.data_asof ? ` · ${tr('deskBrief.deskbrief.dataAsOf', 'data as of {{time}}', { time: new Date(brief.data_asof).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}` : ''}
        {'. '}{tr('deskBrief.deskbrief.notAdvice', 'Not financial advice.')}
      </p>
    </section>
  )
}
