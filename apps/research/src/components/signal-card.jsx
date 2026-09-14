/**
 * SignalCard — one row of the intelligence feed.
 *
 * Extracted from notification-panel so the bell popover and the Intel Desk page
 * render the SAME card. Two implementations of this would drift within a week,
 * and the whole point of the lane work is that a signal means the same thing
 * wherever you meet it.
 *
 * Styles live in notification-panel.css (the `np-` prefix) — both consumers
 * import it, so there is one stylesheet as well as one component.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { parseNotificationSource } from '@/lib/notification-source'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { LANES, laneOf } from '@/lib/notification-lanes'
import { PSEUDO_ASSETS, resolveDestination } from '@/lib/notification-destination'

// Re-exported so existing importers keep working — the implementation, and the
// reasoning behind it, live in lib/notification-destination.js.
export { resolveDestination }

export const CATEGORY_META = {
  breaking: { label: 'Breaking', color: '#EF4444', icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z' },
  market:   { label: 'Market',   color: '#3B82F6', icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z' },
  watchlist: { label: 'Watchlist', color: '#F59E0B', icon: 'M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z' },
  news:     { label: 'News',     color: '#06B6D4', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
  whale:    { label: 'Whale',    color: '#A78BFA', icon: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  calendar: { label: 'Calendar', color: '#10B981', icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5' },
  // KOL Radar convergence / new-follow alerts. Amber (the KOL tier color)
  // with a radar-sweep glyph keeps it visually grouped with X Dash signals.
  'kol-follow': { label: 'KOL Radar', color: '#F59E0B', icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-4.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM12 12l5.5-5.5' },
  // Intelligence Feed detector — breakout radar (bull green) + black-swan fragility (amber)
  breakout:  { label: 'Breakout',  color: '#34D399', icon: 'M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z' },
  fragility: { label: 'Fragility', color: '#F59E0B', icon: 'M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285zm0 13.036h.008v.008H12v-.008z' },
  // Brain desk — directional call (indigo, targeting glyph — never a brain/sparkle icon)
  brain:     { label: 'Brain',     color: '#818CF8', icon: 'M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
}

// Panel ordering is STRICTLY newest-first. It used to tier by category
// (brain/breakout, then whale, then breaking, then news), which buried a
// 9-minute-old breaking headline under a 12-hour-old breakout and made the
// feed read as unsorted — the timestamps ran 33m, 2h, 8h, 12h, 7h, 13h…
// A feed's one job is to answer "what just happened".

export function timeAgo(ts) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

/* ── Token extraction ───────────────────────────────────────────────────────
   A signal names its assets in three places and none of them were clickable:
   the structured `meta.asset`, cashtags in the prose, and bare major tickers
   ("BTC $63.5K"). Bare tickers are only accepted when they are a KNOWN major —
   an arbitrary 3-letter uppercase word ("AI", "US", "GDP") is not a token, and
   linking it would send the user to an empty Research Zone. */
const TICKER_RE = /\$([A-Za-z][A-Za-z0-9]{1,11})\b|\b([A-Z][A-Z0-9]{1,5})\b/g
// Uppercase words that read as tickers but never are.
const TICKER_STOPWORDS = new Set([
  'AI', 'US', 'USA', 'UK', 'EU', 'CEO', 'CFO', 'ETF', 'ETFS', 'IPO', 'GDP', 'CPI',
  'FOMC', 'SEC', 'NEW', 'ATH', 'ATL', 'RSI', 'OI', 'TVL', 'APY', 'APR', 'DAO',
  'NFT', 'DEX', 'CEX', 'KOL', 'RT', 'AND', 'THE', 'FOR', 'NOT', 'ALL', 'ONE',
])


function extractTokens(signal) {
  const out = []
  const push = (sym) => {
    const s = String(sym || '').toUpperCase()
    if (!s || out.includes(s) || PSEUDO_ASSETS.has(s)) return
    out.push(s)
  }
  push(signal.meta?.asset)

  const haystack = [signal.title, signal.detail, signal.body].filter(Boolean).join(' ')
  TICKER_RE.lastIndex = 0
  let m
  while ((m = TICKER_RE.exec(haystack)) !== null) {
    const cashtag = m[1]
    const bare = m[2]
    if (cashtag) { push(cashtag); continue }
    if (!bare || TICKER_STOPWORDS.has(bare)) continue
    // A bare uppercase word is a token only if we can name it.
    if (SYMBOL_TO_COINGECKO_ID[bare]) push(bare)
  }
  return out.slice(0, 4)
}

/* ── Stat parsing ───────────────────────────────────────────────────────────
   The Brain writes its scoreboard as `label value (note) · label value (note)`.
   Printed as one sentence it is unreadable; split into labelled cells it is a
   scoreboard again. */
function parseStats(text) {
  if (!text || !text.includes('·')) return null
  const chunks = text.split('·').map(s => s.trim()).filter(Boolean)
  if (chunks.length < 2) return null
  return chunks.slice(0, 6).map((chunk) => {
    const noteM = chunk.match(/\(([^)]+)\)\s*$/)
    const note = noteM ? noteM[1] : null
    const rest = (noteM ? chunk.slice(0, noteM.index) : chunk).trim()
    // The value is the trailing number-bearing token ("15.6%", "30.1%/4h",
    // "$63.5K", "56.3%"). Everything before it is the label.
    const valM = rest.match(/(\S*\d[\d.,]*\s*[%KMB]?(?:\/\w+)?)\s*$/)
    const value = valM ? valM[1].trim() : null
    const label = valM ? rest.slice(0, valM.index).trim() : rest
    return { label: label || rest, value, note }
  })
}

export function SignalCard({ signal, onRead, onDismiss, onToken, onOpen }) {
  const { t } = useTranslation()
  const meta = CATEGORY_META[signal.category] || CATEGORY_META.market
  // The LANE is what the card announces itself as, not the raw category.
  // A world headline used to arrive tagged BREAKING in alarm-red — which is
  // exactly the "a rocket hitting every day is normalized, it's not a shock"
  // complaint. It lands on `headline` now, so it reads as a headline: no red,
  // no pulse. The red treatment is reserved for crypto-native breaking, the
  // events the tape is actually trading.
  const lane = signal.lane || laneOf(signal)
  const laneLabel = LANES[lane]?.label
  const isBreaking = lane === 'breaking'
  const src = isBreaking ? parseNotificationSource(signal) : null
  const displayTitle = src?.cleanTitle || signal.title
  const direction = signal.meta?.direction
  const tokens = useMemo(() => extractTokens(signal), [signal])
  const dest = useMemo(() => resolveDestination(signal), [signal])
  // Stat chips: always for the headline's detail half; for the body only on
  // the two categories that actually write scoreboards.
  const detailStats = useMemo(() => parseStats(signal.detail), [signal.detail])
  const bodyStats = useMemo(
    () => ((signal.category === 'brain' || signal.category === 'market') ? parseStats(signal.body) : null),
    [signal.body, signal.category]
  )

  return (
    <div
      className={`np-signal${signal.read ? '' : ' is-unread'}${isBreaking ? ' np-signal--breaking' : ''}${dest ? '' : ' np-signal--inert'}`}
      onClick={() => { onRead(signal.id); if (dest) onOpen(dest) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRead(signal.id); if (dest) onOpen(dest) } }}
      role={dest ? 'button' : undefined}
      tabIndex={dest ? 0 : undefined}
    >
      <div className="np-signal-icon" style={{ color: meta.color }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={meta.icon} />
        </svg>
      </div>
      <div className="np-signal-content">
        <div className="np-signal-header">
          <span className="np-signal-category" style={{ color: meta.color }}>{laneLabel || meta.label}</span>
          {direction === 'bullish' && <span className="np-signal-dir np-signal-dir--bull">▲</span>}
          {direction === 'bearish' && <span className="np-signal-dir np-signal-dir--bear">▼</span>}
          <span className="np-signal-time">{timeAgo(signal.timestamp)}</span>
          {!signal.read && <span className="np-signal-dot" style={{ background: meta.color }} aria-hidden />}
        </div>

        <p className="np-signal-title">{displayTitle}</p>

        {/* When the BODY is the scoreboard (daily market pulse), the detail
            half of the headline is a condensed restatement of the very same
            numbers — printing both put "BTC $63.5K (+0.7%), F&G 38" directly
            above a grid saying BTC $63.5K / F&G 38. */}
        {signal.detail && !(bodyStats && !detailStats) && (
          detailStats
            ? <StatRow stats={detailStats} />
            : <p className="np-signal-detail">{signal.detail}</p>
        )}

        {signal.body && (
          bodyStats
            ? <StatRow stats={bodyStats} muted />
            : <p className="np-signal-body">{signal.body}</p>
        )}

        {/* Which token this call is ABOUT, spelled out. A micro-cap ticker
            collides across chains (the CATALORIAN-on-ETH mis-landing), so the
            card names the chain and shows the contract it scored — the reader
            can check that against the card's numbers before clicking, and the
            click goes to that exact contract. */}
        {dest?.kind === 'screener' && (
          <div className="np-signal-idline">
            {dest.chainName && <span className="np-signal-chain">{dest.chainName}</span>}
            <span className="np-signal-ca" title={dest.address}>
              {`${dest.address.slice(0, 4)}…${dest.address.slice(-4)}`}
            </span>
          </div>
        )}

        {dest && (
          <span className="np-signal-go">
            {dest.kind === 'screener'
              ? t('notifications.openScreener', 'Open {{symbol}} in AI Screener', { symbol: dest.symbol })
              : dest.kind === 'rz'
                ? t('notifications.openResearch', 'Open {{symbol}} in Research Zone', { symbol: dest.symbol })
                : dest.kind === 'edition'
                  ? t('notifications.openEdition', 'Open the Edition')
                  : t('notifications.readStory', 'Read the story')}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        )}

        {tokens.length > 0 && (
          <div className="np-signal-tokens">
            {tokens.map(sym => (
              <button
                key={sym}
                type="button"
                className="np-token-chip"
                onClick={(e) => {
                  e.stopPropagation(); onRead(signal.id)
                  // The card's own asset carries identity (chain + contract);
                  // routing its chip by bare ticker would re-open the same
                  // same-symbol stranger the destination was built to avoid.
                  if (dest && sym === dest.symbol) onOpen(dest)
                  else onToken(sym)
                }}
                title={t('notifications.openToken', 'Open {{symbol}}', { symbol: sym })}
              >
                {sym}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="np-signal-dismiss"
        onClick={(e) => { e.stopPropagation(); onDismiss(signal.id) }}
        title={t('notifications.dismiss', 'Dismiss')}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

export function StatRow({ stats, muted = false }) {
  return (
    <div className={`np-stats${muted ? ' np-stats--muted' : ''}`}>
      {stats.map((s, i) => (
        <div className="np-stat" key={`${s.label}-${i}`}>
          <span className="np-stat-label">{s.label}</span>
          {s.value && <span className="np-stat-value">{s.value}</span>}
          {s.note && <span className="np-stat-note">{s.note}</span>}
        </div>
      ))}
    </div>
  )
}

