/**
 * useNotificationPoller - fetches live notifications from the data API
 * and pushes them into the Zustand notification store.
 *
 * Polls /data-api/v1/notifications/feed every 60s.
 * New items trigger toast popups via the callback.
 * Strips AI dashes (--) from all text.
 */
import { useEffect, useRef, useCallback } from 'react'
import useNotificationStore from '@/store/useNotificationStore'
import useSettingsStore from '@/store/useSettingsStore'
import { isAppActive } from '@/lib/idleManager'
import { cleanSyndicatedText } from '@/lib/notification-source'
import { laneOf, isDetectorNoise } from '@/lib/notification-lanes'

const POLL_INTERVAL = 60_000
const FEED_URL = '/data-api/v1/notifications/feed?limit=40&min_severity=medium'
// Toast frequency: 'hourly' (default) shows at most one popup burst per hour,
// EXCEPT breaking news which always pops; 'realtime' = every new signal; 'off' = none.
const TOAST_MIN_GAP_MS = 60 * 60 * 1000
const LAST_TOAST_KEY = 'spectre-notif-last-toast'

// Filter out noise: BSC shitcoin pumps, duplicate signal types, low-value alerts
const BLOCKED_PATTERNS = [
  /pumping on bsc/i,
  /dumping on bsc/i,
  /move on \$\d+K volume/i,
]

const ALLOWED_SIGNAL_TYPES = new Set([
  'breaking_news', 'convergence', 'whale_move',
  'fear_greed_extreme', 'funding_rate_extreme', 'volume_spike_cex',
  'smart_money_flow', 'exchange_flow', 'stablecoin_flow',
  'btc_dominance_shift', 'liquidation_cascade', 'momentum_divergence',
  // Intelligence Feed detector + Brain desk (breakout, fragility, brain calls + intel)
  // early_runner = pre-CoinGecko ticker buzz confirmed on-chain (early-runner-detector)
  'breakout_radar', 'early_runner', 'fragility_warning', 'brain_call', 'brain_intel',
  // Macro wire + market pulse (macro-news-radar) — these were reaching the
  // feed but silently dropped here; the Iran-class world headlines belong in
  // the bell. alpha_report = the brain's daily self-study scoreboard.
  'macro_news', 'market_pulse', 'alpha_report',
  // Stock key events (worker-equity-events): IPO-price crossings on new
  // listings + outsized daily movers (the SPCX-below-IPO class, 2026-07-13)
  'equity_event',
])

// Signal-type -> feed category. Detector signals get their own categories so the
// panel/toast render them with a distinct glyph + tint (never a left-line stripe).
function mapSignalCategory(signalType) {
  switch (signalType) {
    case 'breakout_radar': return 'breakout'
    case 'early_runner': return 'breakout'
    case 'fragility_warning': return 'fragility'
    case 'brain_call': return 'brain'
    case 'brain_intel': return 'brain'
    case 'alpha_report': return 'brain'
    default: return 'market'
  }
}

function cleanText(text) {
  if (!text) return text
  // Remove AI dashes: -- and — used as separators
  return text
    .replace(/\s*--\s*/g, '. ')
    .replace(/\s*—\s*/g, '. ')
    .replace(/\.\.\s/g, '. ')
    .replace(/\.\s*\./g, '.')
    .trim()
}

/**
 * Upstream writes every signal title as `Headline — supporting detail`. The
 * old cleaner flattened that em-dash into a period, which turned the Brain's
 * desk scoreboard into one unreadable run-on sentence
 * ("Desk scoreboard. published 4h 15.6% (n=90) · 24h 35.6% (n=90) · …").
 *
 * The dash is STRUCTURE, not an AI tic: keep the split and hand the panel two
 * fields so it can render a headline and its numbers separately. Only the
 * literal `--` typographic tic is scrubbed, inside each half.
 */
function splitTitleDetail(rawTitle) {
  const raw = typeof rawTitle === 'string' ? rawTitle.trim() : ''
  if (!raw) return { title: raw, detail: null }
  // First em/en dash surrounded by spaces. A dash inside a word ("post-reset")
  // or a negative number never matches.
  const idx = raw.search(/\s[—–]\s/)
  if (idx === -1) return { title: cleanText(raw), detail: null }
  const head = raw.slice(0, idx).trim()
  const tail = raw.slice(idx + 3).trim()
  if (!head || !tail) return { title: cleanText(raw), detail: null }
  return {
    title: head.replace(/\s*--\s*/g, ' ').trim(),
    detail: tail.replace(/\s*--\s*/g, ' ').trim(),
  }
}

function mapCategory(type) {
  switch (type) {
    case 'breaking_news': return 'breaking'
    case 'signal_alert': return 'market'
    case 'convergence': return 'market'
    case 'whale_move': return 'whale'
    default: return 'market'
  }
}

function mapPriority(severity) {
  switch (severity) {
    case 'critical': return 1
    case 'high': return 1
    case 'medium': return 2
    default: return 3
  }
}

export default function useNotificationPoller(onNewNotification, { enabled = true } = {}) {
  const addSignals = useNotificationStore((s) => s.addSignals)
  const clearOld = useNotificationStore((s) => s.clearOld)
  const notifPrefs = useSettingsStore((s) => s.notificationPrefs)
  const seenIds = useRef(new Set())
  const onNew = useRef(onNewNotification)
  onNew.current = onNewNotification

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return
      const json = await res.json()
      const items = json.data || []

      if (items.length === 0) return

      // Filter out junk
      const filtered = items.filter(item => {
        // Block known spam patterns
        const text = `${item.title || ''} ${item.body || ''}`
        if (BLOCKED_PATTERNS.some(p => p.test(text))) return false

        // A funding flip where every number rounds to zero is the detector
        // talking to itself, not a signal. Measured 2026-08-18: 64 of 100 live
        // breaking rows were these.
        if (isDetectorNoise({ title: item.title, body: item.body })) return false

        // Drop low-value brain/intel chatter that reads as nonsense in the bell:
        //  - raw KOL tweet echoes: a t.co link, a raw contract dump, or a
        //    "bought exactly X% of supply" quote (sounds like the brain itself
        //    bought the token, and carries no read)
        //  - trivially small funding blips ("stretched by 0.0011%") — not stretched
        if (/t\.co\/|bought exactly [\d.]+% of supply|(?:solana:)?[1-9A-HJ-NP-Za-km-z]{40,}|0x[a-fA-F0-9]{40}/i.test(text)) return false
        const fundingBlip = text.match(/funding rate stretched by ([\d.]+)%/i)
        if (fundingBlip && parseFloat(fundingBlip[1]) < 0.05) return false

        // For signal alerts, only allow known high-value signal types
        if (item.type === 'signal_alert' && item.signalType) {
          if (!ALLOWED_SIGNAL_TYPES.has(item.signalType)) return false
        }

        // Require minimum score of 7 for signals
        if (item.type === 'signal_alert' && (item.score || 0) < 7) return false

        // User preference filtering
        if (notifPrefs) {
          if (item.type === 'breaking_news' && notifPrefs.breakingNews === false) return false
          if (item.type === 'signal_alert') {
            if (item.signalType === 'breakout_radar' || item.signalType === 'early_runner') { if (notifPrefs.breakout === false) return false }
            else if (item.signalType === 'fragility_warning') { if (notifPrefs.fragility === false) return false }
            else if (notifPrefs.signals === false) return false
          }
          if (item.type === 'whale_move' && notifPrefs.whales === false) return false
          if (item.type === 'convergence' && notifPrefs.convergence === false) return false
        }

        return true
      })

      if (filtered.length === 0) return

      const mapped = filtered.map(item => {
        const isBreaking = item.type === 'breaking_news'
        // Syndicated items arrive wrapped in their origin
        // (`@WSJ (@WSJ): "…"`, `RT @x:`, a dangling "Watch more: 🔗").
        // Peel it here, once, so every consumer — panel, toast, badge —
        // reads the event instead of the envelope.
        const rawTitle = isBreaking ? cleanSyndicatedText(item.title) : item.title
        const { title, detail } = splitTitleDetail(rawTitle)
        const rawBody = isBreaking ? cleanSyndicatedText(item.body) : item.body
        const body = cleanText(rawBody)
        const category = item.type === 'signal_alert'
          ? mapSignalCategory(item.signalType)
          : mapCategory(item.type)
        const meta = {
          type: item.type,
          signalType: item.signalType || null,
          severity: item.severity,
          asset: item.asset,
          score: item.score,
          direction: item.direction || null,
          conviction: item.conviction || null,
          // WHICH token the call is about. `asset` is a ticker, and a micro-cap
          // ticker collides across chains — CATALORIAN named a $1.42M Solana
          // token and the card opened a $254K Ethereum namesake (Nick, TG
          // 2026-08-24). X Dash knows the exact token it scored, so the feed
          // now ships its identity and the card routes by THAT, never by the
          // ticker. Absent on older signals; the card degrades to symbol.
          cgId: item.cgId || null,
          chain: item.chain || null,
          contractAddress: item.contractAddress || null,
          tokenName: item.tokenName || null,
          mcap: Number.isFinite(Number(item.mcap)) ? Number(item.mcap) : null,
        }
        return {
          id: item.id,
          category,
          title,
          // The numbers half of the headline. Rendered as its own line (or as
          // stat chips when it is `·`-separated), never glued onto the title.
          detail,
          // A body that merely restates the title adds a second identical
          // paragraph to the card — the breaking-news case, where upstream
          // sends title and body as the same sentence.
          body: body && body !== title ? body : null,
          timestamp: new Date(item.createdAt).getTime(),
          priority: mapPriority(item.severity),
          // The server stamps `lane` once /v1/notifications/feed ships it;
          // laneOf() returns that field untouched when present and only derives
          // as a bridge, so this line goes cold on its own after the API lands.
          lane: laneOf({ title, detail, body, category, lane: item.lane, meta }),
          meta,
        }
      })

      // Collapse per-token signal spam (breakout/fragility repeated for one
      // asset) to the newest; dedupe everything else by title.
      const COLLAPSE = new Set(['breakout', 'fragility', 'signal'])
      const seen = new Set()
      const deduped = mapped.filter(m => {
        const token = m.meta?.asset || (m.title || '').trim().split(/\s+/)[0]
        const key = (COLLAPSE.has(m.category) && token)
          ? `${m.category}|${String(token).toUpperCase()}`
          : m.title
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      // Find truly new items for toast popups
      const newItems = deduped.filter(m => !seenIds.current.has(m.id))
      for (const item of deduped) seenIds.current.add(item.id)

      // Push to store
      addSignals(deduped)

      // Fire toasts — frequency-gated. Default 'hourly': at most one popup burst
      // per hour, EXCEPT breaking news (always pops). 'realtime' = no gate, 'off' = none.
      const freq = notifPrefs?.toastFrequency || 'hourly'
      if (onNew.current && freq !== 'off' && (!notifPrefs || notifPrefs.toastsEnabled !== false)) {
        const now = Date.now()
        const last = parseInt(localStorage.getItem(LAST_TOAST_KEY) || '0', 10)
        const windowOpen = freq === 'realtime' || (now - last) >= TOAST_MIN_GAP_MS
        // Only a NON-breaking pop advances the hourly gate. Breaking news always
        // pops (bypasses the gate) but must NOT stamp LAST_TOAST_KEY, or a steady
        // stream of breaking headlines would push the window forward forever and
        // silently starve the whale/brain/breakout/fragility toast channel.
        let firedNonBreaking = false
        for (const n of newItems.filter(x => x.priority <= 1).slice(0, 2)) {
          const isBreaking = n.category === 'breaking'
          if (isBreaking || windowOpen) { onNew.current(n); if (!isBreaking) firedNonBreaking = true }
        }
        if (firedNonBreaking) { try { localStorage.setItem(LAST_TOAST_KEY, String(now)) } catch { /* quota */ } }
      }
    } catch {
      // silent - data API may be unreachable
    }
  }, [addSignals, notifPrefs])

  useEffect(() => {
    // Notifications are a desktop-only experience — the bell/panel is hidden on
    // mobile (header) so the poll + toasts must be off there too (PWA + browser).
    if (!enabled) return
    clearOld()
    if (!document.hidden) fetchFeed()
    const tick = () => { if (document.hidden || !isAppActive()) return; fetchFeed() }
    const interval = setInterval(tick, POLL_INTERVAL)
    const onVis = () => { if (!document.hidden) fetchFeed() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [enabled, fetchFeed, clearOld])
}
