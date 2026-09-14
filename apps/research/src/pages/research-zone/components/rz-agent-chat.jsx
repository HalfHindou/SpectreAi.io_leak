/**
 * RzAgentChat - Spectre AI Agent Chat Panel
 * Embedded in Research Zone right sidebar "Agent" tab.
 * Streams responses from the AI agent SSE endpoint.
 * Includes voice mode with canvas waveform & real-time audio visualization.
 */
import React, { useState, useRef, useEffect, useCallback, memo } from 'react'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { spectreIcons } from '@/icons/spectreIcons'
import { buildCatalystBlock, buildStructureBlock, buildCrowdBlock } from './rz-catalysts'
import AppPortal from '@/components/app-portal'
import { extractAgentDrawings } from '@/lib/chart-ta-brief'
import './rz-agent-chat.css'
import { parseSseFrames } from '@/lib/monarch-stream'

// Curated structural alpha that the live data feed doesn't carry yet (free
// float %, index inclusion, lockup/unlock dynamics). The brain cites these as
// hard facts. Keyed by symbol; extend as we learn more / wire a real feed.
// 🎯 follow-up: a backend structural feed (free float, index membership,
// lockup expiry for stocks; vesting schedules for tokens) so this is automatic.
const STRUCTURAL_NOTES = {
  SPCX: 'Free float is only ~5% of shares outstanding — extreme scarcity. Pending major-index inclusion forces index/ETF tracker funds to BUY regardless of price (passive, price-insensitive demand into a tiny float). Classic low-float listing: scarcity squeezes price up near-term, but lockups/vesting unlock more supply over time (the same pattern as 2020-era token listings — tiny initial float, rising supply later), so float expands and dilution builds as it matures.',
}

// Spectre backend SSE chat — proxied in dev via Vite (/api → Express),
// and via Vercel rewrites in prod. Same origin, so no CORS.
const AI_AGENT_SSE_ENDPOINT = '/api/monarch/chat'

// Corners-out / corners-in: the standard "give me room" pair. Deliberately not
// a maximise square — this opens a WINDOW, not a full page, and the glyph
// should not promise otherwise.
const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" aria-hidden>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
)
const CollapseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" aria-hidden>
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
  </svg>
)

let msgIdCounter = 0
const nextId = () => `msg-${++msgIdCounter}-${Date.now()}`

// Rotating status lines shown while the agent thinks (before the first token).
// Mirror the brain's actual analysis order: tape -> structure -> crowd -> verdict.
const THINKING_PHRASES = [
  'Reading the tape',
  'Mapping structure & supply',
  'Gauging the crowd',
  'Weighing catalysts',
  'Forming the verdict',
]

// ────────────────────────────────────────────────────────────────────────────
// MARKDOWN RENDERING
// ────────────────────────────────────────────────────────────────────────────

// The agent streams from /api/monarch/chat, and that endpoint INJECTS rich
// data-block directives into the text — `\`\`\`token_card\n{"symbol":"BTC"}\n\`\`\``
// (monarch-chat.js). Monarch's own UI parses those fences and renders a card;
// this transcript had no fence handling at all, so every reply ended with the
// raw fence printed as prose plus an orphaned backtick in a code pill. The
// directives are redundant here anyway — you are already on that token's page —
// so a known block is swallowed, and any other fenced block renders as a real
// code block instead of leaking its markers.
const DATA_BLOCK_KINDS = new Set(['token_card', 'chart_spec', 'xdash_table', 'bubble_map', 'dashboard_spec', 'draw'])

function renderMessageContent(text, isStreaming) {
  if (!text) return null
  const lines = text.split(/\n/)
  const elements = []
  let currentList = []
  let currentListType = null
  // Fence state: null = outside, otherwise { kind, body[] }
  let fence = null

  const flushList = () => {
    if (currentList.length > 0) {
      if (currentListType === 'ol') {
        elements.push(<ol key={`ol-${elements.length}`}>{currentList.map((item, i) => <li key={i}>{formatInline(item)}</li>)}</ol>)
      } else {
        elements.push(<ul key={`ul-${elements.length}`}>{currentList.map((item, i) => <li key={i}>{formatInline(item)}</li>)}</ul>)
      }
      currentList = []
      currentListType = null
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ── fenced blocks ──────────────────────────────────────────────────────
    const fenceMatch = line.match(/^\s*```(\w*)\s*$/)
    if (fenceMatch) {
      if (fence) {
        // closing fence — emit only when it is not a directive we swallow
        if (!DATA_BLOCK_KINDS.has(fence.kind) && fence.body.join('').trim()) {
          elements.push(<pre key={`code-${i}`} className="rz-agent-code">{fence.body.join('\n')}</pre>)
        }
        fence = null
      } else {
        flushList()
        fence = { kind: fenceMatch[1] || '', body: [] }
      }
      continue
    }
    if (fence) { fence.body.push(line); continue }

    const numberedMatch = line.match(/^\s*\d+\.\s+(.+)/)
    if (numberedMatch) { if (currentListType === 'ul') flushList(); currentListType = 'ol'; currentList.push(numberedMatch[1]); continue }
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)/)
    if (bulletMatch) { if (currentListType === 'ol') flushList(); currentListType = 'ul'; currentList.push(bulletMatch[1]); continue }
    flushList()
    const trimmed = line.trim()
    // any heading depth — the model emits ## as often as ### and a raw
    // "## Verdict" line is exactly the "weird formatted text" report
    const hMatch = trimmed.match(/^#{1,4}\s+(.+)/)
    if (hMatch) { elements.push(<h4 key={`h-${i}`} className="rz-agent-heading">{formatInline(hMatch[1])}</h4>); continue }
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) { elements.push(<hr key={`hr-${i}`} className="rz-agent-rule" />); continue }
    if (trimmed) elements.push(<p key={`p-${i}`}>{formatInline(trimmed)}</p>)
  }
  // An UNCLOSED fence is the mid-stream case: the opener has arrived but the
  // body is still coming. Render nothing for it rather than dumping the raw
  // JSON on screen for a second and then removing it.
  fence = null
  flushList()

  if (isStreaming && elements.length > 0) {
    const lastEl = elements[elements.length - 1]
    elements[elements.length - 1] = React.cloneElement(lastEl, {}, ...(
      Array.isArray(lastEl.props.children) ? lastEl.props.children : [lastEl.props.children]
    ), <span key="cursor" className="rz-agent-cursor" />)
  }
  return elements.length > 0 ? elements : <p>{text}</p>
}

function formatInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/)
    if (boldMatch) return <strong key={i}>{boldMatch[1]}</strong>
    const codeMatch = part.match(/^`(.+)`$/)
    if (codeMatch) return <code key={i}>{codeMatch[1]}</code>
    return part
  })
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ────────────────────────────────────────────────────────────────────────────
// ICONS
// ────────────────────────────────────────────────────────────────────────────

const SpectreLogoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M8 12h8M12 8v8" opacity="0.5" />
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" opacity="0.6" />
  </svg>
)
const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
)
const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
)
const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
)
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
)
const ClearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
  </svg>
)
const ErrorIcon = () => (
  <svg className="rz-agent-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)
const MicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0014 0" /><line x1="12" y1="20" x2="12" y2="24" />
  </svg>
)
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

// ────────────────────────────────────────────────────────────────────────────
// COPY BUTTON
// ────────────────────────────────────────────────────────────────────────────

const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }, [text])
  return (
    <button className={`rz-agent-copy-btn ${copied ? 'is-copied' : ''}`} onClick={handleCopy} title={copied ? 'Copied' : 'Copy message'}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}

// Cycling "thinking" phrases. Self-contained state so it doesn't force the
// parent (or sibling messages) to re-render every 1.5s.
function ThinkingIndicator() {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % THINKING_PHRASES.length), 1500)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="rz-agent-thinking">
      <div className="rz-agent-thinking-status">
        <span key={phase} className="rz-agent-thinking-word">{THINKING_PHRASES[phase]}</span>
        <span className="rz-agent-thinking-dots"><i /><i /><i /></span>
      </div>
      <div className="rz-agent-skeleton">
        <span className="rz-agent-skel-line" />
        <span className="rz-agent-skel-line" />
        <span className="rz-agent-skel-line" />
      </div>
    </div>
  )
}

// One chat message. memo'd on `msg` identity so a price tick (which re-renders
// RzAgentChat) does NOT re-run renderMessageContent's markdown parse for every
// message - only the streaming message (whose object changes per token) re-parses.
const AgentMessage = memo(function AgentMessage({ msg }) {
  if (msg.role === 'assistant') {
    return (
      <div className={`rz-agent-msg is-${msg.role}`}>
        <div className="rz-agent-msg-agent">
          <div className="rz-agent-msg-agent-head">
            <div className="rz-agent-msg-avatar"><SpectreLogoIcon /></div>
            <span className="rz-agent-msg-name">Spectre</span>
            <span className="rz-agent-msg-time">{formatTime(msg.timestamp)}</span>
          </div>
          <div className={`rz-agent-msg-body ${msg.streaming ? 'is-streaming' : ''}`}>
            {msg.streaming && !msg.content ? (
              <ThinkingIndicator />
            ) : (
              <div className="rz-agent-msg-content">{renderMessageContent(msg.content, msg.streaming)}</div>
            )}
          </div>
          {!msg.streaming && msg.content && (
            <div className="rz-agent-msg-actions"><CopyButton text={msg.content} /></div>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className={`rz-agent-msg is-${msg.role}`}>
      <div className="rz-agent-msg-user">
        <div className="rz-agent-msg-user-head">
          <span className="rz-agent-msg-time">{formatTime(msg.timestamp)}</span>
          <span className="rz-agent-msg-you">You</span>
        </div>
        <div className="rz-agent-msg-user-bubble">{msg.display || msg.content}</div>
      </div>
    </div>
  )
})

// ────────────────────────────────────────────────────────────────────────────
// CANVAS WAVEFORM DRAWING
// ────────────────────────────────────────────────────────────────────────────

const PARTICLE_COUNT = 24

function initParticles() {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: 68 + Math.random() * 35,
    speed: 0.0004 + Math.random() * 0.0006,
    size: 0.8 + Math.random() * 1.8,
    alpha: 0.15 + Math.random() * 0.35,
  }))
}

function drawVoiceCanvas(canvas, smoothData, particles, state, audioLevel, time, isDayMode) {
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const w = canvas.width / dpr
  const h = canvas.height / dpr

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(dpr, dpr)

  const cx = w / 2
  const cy = h / 2
  const barCount = 64
  const innerRadius = 48
  const maxBarHeight = 28
  const rotation = time * 0.00015

  // ── Circular waveform bars ──
  for (let i = 0; i < barCount; i++) {
    const angle = (i / barCount) * Math.PI * 2 + rotation - Math.PI / 2

    let value
    if (state === 'listening' && smoothData) {
      const idx = Math.floor((i / barCount) * Math.min(smoothData.length, 64))
      value = smoothData[idx] || 0
    } else if (state === 'speaking') {
      value = 0.25 + 0.3 * Math.sin(time * 0.004 + i * 0.28) + 0.15 * Math.sin(time * 0.007 + i * 0.6) + audioLevel * 0.3
    } else {
      // Processing - slow wave
      value = 0.08 + 0.07 * Math.sin(time * 0.002 + i * 0.15)
    }

    value = Math.max(0, Math.min(1, value))
    const barH = Math.max(1.5, value * maxBarHeight)
    const inH = barH * 0.35

    // Outer bar
    const ox1 = cx + Math.cos(angle) * innerRadius
    const oy1 = cy + Math.sin(angle) * innerRadius
    const ox2 = cx + Math.cos(angle) * (innerRadius + barH)
    const oy2 = cy + Math.sin(angle) * (innerRadius + barH)

    // Inner bar (mirror)
    const ix1 = cx + Math.cos(angle) * (innerRadius - inH)
    const iy1 = cy + Math.sin(angle) * (innerRadius - inH)

    // Warm-white waveform (zero saturation) — no purple slop.
    const lightness = isDayMode ? (35 + value * 15) : (78 + value * 14)
    const alpha = 0.12 + value * 0.6

    // Main bar (inner + outer connected)
    ctx.beginPath()
    ctx.moveTo(ix1, iy1)
    ctx.lineTo(ox2, oy2)
    ctx.strokeStyle = `hsla(0, 0%, ${lightness}%, ${alpha})`
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.stroke()

    // Glow for loud bars
    if (value > 0.35) {
      ctx.beginPath()
      ctx.moveTo(ox1, oy1)
      ctx.lineTo(ox2, oy2)
      ctx.strokeStyle = `hsla(0, 0%, ${isDayMode ? 50 : 92}%, ${value * 0.22})`
      ctx.lineWidth = 4.5
      ctx.stroke()
    }
  }

  // ── Floating particles ──
  for (const p of particles) {
    p.angle += p.speed * (1 + audioLevel * 3)
    const dist = p.radius + audioLevel * 12
    const px = cx + Math.cos(p.angle) * dist
    const py = cy + Math.sin(p.angle) * dist

    ctx.beginPath()
    ctx.arc(px, py, p.size * (0.8 + audioLevel * 0.5), 0, Math.PI * 2)
    ctx.fillStyle = isDayMode
      ? `rgba(15, 23, 42, ${p.alpha * 0.45})`
      : `rgba(245, 245, 247, ${p.alpha})`
    ctx.fill()
  }

  ctx.restore()
}

// ────────────────────────────────────────────────────────────────────────────
// VOICE HELPERS
// ────────────────────────────────────────────────────────────────────────────

function getPreferredVoice() {
  const voices = window.speechSynthesis.getVoices()
  // Ranked preference - try to find the best natural-sounding English voice
  const preferred = [
    'Google UK English Male',
    'Daniel',
    'Google US English',
    'Microsoft Mark Online',
    'Microsoft Guy Online',
    'Aaron',
    'Rishi',
    'Samantha',
    'Microsoft David',
    'Alex',
  ]
  for (const name of preferred) {
    const match = voices.find(v => v.name.includes(name) && v.lang.startsWith('en'))
    if (match) return match
  }
  // Fallback: any English voice, prefer male
  return voices.find(v => v.lang.startsWith('en-') && v.name.toLowerCase().includes('male'))
    || voices.find(v => v.lang.startsWith('en-US'))
    || voices.find(v => v.lang.startsWith('en'))
    || voices[0]
}

// ────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ────────────────────────────────────────────────────────────────────────────

// Format a human-readable live-data block for the LLM. Only includes fields that
// are actually present on tokenData — partial data is OK, fabricated data is not.
// The "brain": a causal market-reasoning directive so "why is $X moving?" gets
// a desk-analyst thesis (driver → mechanism → tape → second-order), not a list
// of headlines or "it's up on momentum" filler.
function brainDirective(sym, tokenName, hasCatalysts) {
  const name = tokenName || `$${sym}`
  return [
    `SPECTRE BRAIN — reason about ${name} like a sharp human investor weighing odds, not a headline reader. Work these lenses and LEAD with whichever dominates the move:`,
    hasCatalysts
      ? `• CATALYST: the single biggest named driver from CATALYSTS/live data (deal, person, number, product) and the MECHANISM by which it actually moves THIS asset — the causal link, not "it's news".`
      : `• CATALYST: name the dominant driver if one exists in context; if none, say the move looks technical/flow-driven and say so.`,
    `• STRUCTURE (often the most powerful and most overlooked): supply & float — how much is really tradeable vs locked? Low float = scarcity = violent moves both ways; a big FDV-vs-mcap gap or unlock/vesting schedule = future dilution / persistent supply. Forced/passive flows — index inclusion or ETF mandates create price-INSENSITIVE buying into that float. Use the MARKET STRUCTURE / structural notes below if present and weight them heavily.`,
    `• PSYCHOLOGY & LIFECYCLE: where is it in the cycle — listing/IPO euphoria (retail buys the top) → capitulation (retail sells the bottom) → quiet accumulation (strong hands) → institutions enter on the breakout → re-rating? Who holds it (weak vs strong hands), and is the move reflexive (price up → more attention → more price)?`,
    `• CROWD: read the room from the CROWD block — who's actually talking (real KOLs vs bots), is the chatter authentic conviction or manufactured hype, is mention velocity rising or fading, and which way is sentiment tilting? Weigh it against the price/structure — loud + bullish into a falling price is a warning, quiet + accumulating is the opposite.`,
    `• TAPE: tie it to the actual numbers (%/price/range/volume) — does the size of the move match the weight of the driver?`,
    `When the user asks for a thesis, outlook, bull/bear case, or "should I buy", STRUCTURE it: VERDICT (one line — directional lean + conviction high/med/low) · BULL CASE (2-3 concrete bullets) · BEAR CASE (2-3 concrete bullets) · KEY SWING FACTOR (the one thing that tips it). Always include the bear case even when bullish.`,
    `Be PROBABILISTIC and honest — this is NOT foolproof: give the base case AND the main risk that would invalidate it; never pretend certainty.`,
    `CRITICAL — keep it SHORT and concrete: a few tight sentences (or compact bullets), leading with the punch for ${name} specifically. The lenses above are how you THINK, not what you SAY — do NOT lecture, restate the framework, or spew generic market theory. Every sentence must be about THIS asset's actual situation right now. No "buying pressure/momentum" padding. Never invent drivers, float, unlocks, or index events not in context.`,
  ].join(' ')
}

function buildLiveDataBlock(sym, tokenName, tokenData, catalysts, social) {
  const catalystBlock = buildCatalystBlock(catalysts)
  // Structural read: computed supply/float facts + any curated structural edge.
  const note = STRUCTURAL_NOTES[String(sym || '').toUpperCase()]
  const computedStructure = buildStructureBlock(tokenData)
  const structureSection = [computedStructure, note ? `STRUCTURAL EDGE: ${note}` : '']
    .filter(Boolean).map((s) => `\n${s}`).join('')
  // Crowd read: what X is actually saying (top voices + sentiment tilt).
  const crowdBlock = buildCrowdBlock(social)
  const crowdSection = crowdBlock ? `\n${crowdBlock}` : ''
  if (!tokenData && !catalystBlock && !structureSection && !crowdSection) return ''
  if (!tokenData) {
    // Catalysts/structure/crowd only (price feed not ready yet) — still ground the "why".
    const headline = `[SPECTRE_INTERNAL_CONTEXT active_token=$${sym}${tokenName ? ` name="${tokenName}"` : ''}]`
    const catSec = catalystBlock ? `\nCATALYSTS (freshest real headlines on $${sym}, newest first):\n${catalystBlock}` : ''
    return `${headline}${catSec}${structureSection}${crowdSection}\nRULES: ${brainDirective(sym, tokenName, !!catalystBlock)} Cite sources. If a claim isn't in the catalysts, crowd, structure or live data, don't invent it.\n\n`
  }
  const fmt = (v, opts) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    return n.toLocaleString('en-US', opts || {})
  }
  const price = fmt(tokenData.price, { maximumFractionDigits: 8 })
  const ch1h = fmt(tokenData.change1h, { maximumFractionDigits: 2 })
  const ch24 = fmt(tokenData.change24h, { maximumFractionDigits: 2 })
  const ch7d = fmt(tokenData.change7d, { maximumFractionDigits: 2 })
  const ch30 = fmt(tokenData.change30d, { maximumFractionDigits: 2 })
  const low24 = fmt(tokenData.low24h, { maximumFractionDigits: 8 })
  const high24 = fmt(tokenData.high24h, { maximumFractionDigits: 8 })
  const vol24 = fmt(tokenData.volume24h, { maximumFractionDigits: 0 })
  const mcap = fmt(tokenData.marketCap, { maximumFractionDigits: 0 })

  const lines = []
  if (price) lines.push(`price: $${price}`)
  if (ch1h != null) lines.push(`1h: ${ch1h}%`)
  if (ch24 != null) lines.push(`24h: ${ch24}%`)
  if (ch7d != null) lines.push(`7d: ${ch7d}%`)
  if (ch30 != null) lines.push(`30d: ${ch30}%`)
  if (low24 && high24) lines.push(`24h range: $${low24}–$${high24}`)
  if (vol24) lines.push(`vol(24h): $${vol24}`)
  if (mcap) lines.push(`mcap: $${mcap}`)
  if (!lines.length) return ''

  // Hidden preamble. The backend's Spectre API sometimes returns stale prices
  // and market-wide news that the LLM mistakes as token-specific — these
  // directives override that. `[SPECTRE_INTERNAL_CONTEXT]` is a signal to the
  // model (not a real protocol), just a clear frame that survives preprocessing.
  const headline = `[SPECTRE_INTERNAL_CONTEXT active_token=$${sym}${tokenName ? ` name="${tokenName}"` : ''}]`
  const catalystSection = catalystBlock
    ? `\nCATALYSTS (freshest real headlines on $${sym}, newest first):\n${catalystBlock}`
    : ''
  const guards = [
    'AUTHORITATIVE live data follows — use these numbers verbatim. If any backend-provided price, 24h change, RSI or range conflicts, IGNORE it and use these.',
    `$${sym} is the asset being discussed. Do NOT conflate market-wide news, macro headlines, or other-token activity as $${sym}-specific.`,
    catalystBlock
      ? brainDirective(sym, tokenName, true)
      : `${brainDirective(sym, tokenName, false)} Do NOT invent links to unrelated headlines (Core Scientific, Coinbase quantum, Kalshi, etc. are macro unless they explicitly name this token).`,
    'Never fabricate technicals, RSI, MACD, support/resistance, holder counts, or catalysts not listed above. If a field is missing, omit it.',
  ].join(' ')
  return `${headline}\nLIVE: ${lines.join(' · ')}${catalystSection}${structureSection}${crowdSection}\nRULES: ${guards}\n\n`
}

const RzAgentChat = ({ sym, tokenName, tokenLogo, tokenData, catalysts, social, dayMode, taRequest = null, onAgentDrawings = null }) => {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  // Pop-out window (desktop). RzAgentChat itself is never remounted by the
  // toggle, so the conversation survives even though the DOM subtree relocates.
  const rootRef = useRef(null)
  const [windowed, setWindowed] = useState(false)

  /* 🪤 The window is PORTALLED to <body>, not un-trapped in place.
     Unwinding the ancestors (the old escapeContainingBlocks call that used to
     live here) means chasing one CSS property per engine, and we lost that race
     three times on Traders Corner in Safari alone: `.tc` / `.tc-center` are
     query containers, which WebKit treats as a containing block for
     `position: fixed` and Chrome does not; and even once positioned, the right
     rail still painted over the panel because a sibling stacking context won.
     On <body> there is nothing left to fight - no containing block, no capping
     stacking context, no engine-dependent containment - and `is-window`'s
     z-index competes directly with `.app` (z-index: 1). AppPortal carries the
     `.app…` theme classes so day mode still resolves.
     The body class is how the DOCKED hosts know to stand down while the panel
     is out; same pattern as `body.chart-fullscreen`. */
  useEffect(() => {
    if (!windowed) return undefined
    document.body.classList.add('rz-agent-windowed')
    const onKey = (e) => { if (e.key === 'Escape') setWindowed(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('rz-agent-windowed')
    }
  }, [windowed])

  const abortRef = useRef(null)
  const streamTextRef = useRef('')
  // Chart-TA plumbing: the last request we already ran (so remounting or a
  // re-render never re-fires the same analysis) and a one-shot guard so the
  // agent's drawings are handed to the chart exactly once per answer.
  const taRequestIdRef = useRef(null)
  const drawEmittedRef = useRef(false)
  const onAgentDrawingsRef = useRef(onAgentDrawings)
  onAgentDrawingsRef.current = onAgentDrawings

  // Voice mode state
  const [voiceMode, setVoiceMode] = useState(false)
  const [voiceState, setVoiceState] = useState('idle')
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)

  const recognitionRef = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const audioFrameRef = useRef(null)
  const voiceTranscriptRef = useRef('')
  const voiceModeRef = useRef(false)
  const voiceStateRef = useRef('idle')
  const onStreamCompleteRef = useRef(null)
  const canvasRef = useRef(null)
  const smoothDataRef = useRef(new Float32Array(128).fill(0))
  const particlesRef = useRef(initParticles())
  // Track every voice-mode re-listen timer so we can cancel all of them on
  // unmount or when voiceMode toggles off. Without this, multiple recursive
  // setTimeouts can stack and call startListening() after the component is
  // gone or after the user exited voice mode.
  const voiceTimersRef = useRef(new Set())
  const scheduleVoice = useCallback((fn, ms) => {
    const id = setTimeout(() => {
      voiceTimersRef.current.delete(id)
      fn()
    }, ms)
    voiceTimersRef.current.add(id)
    return id
  }, [])
  const clearVoiceTimers = useCallback(() => {
    voiceTimersRef.current.forEach(clearTimeout)
    voiceTimersRef.current.clear()
  }, [])

  const displayName = tokenName || sym
  const change24h = Number(tokenData?.change24h)
  const hasChange = Number.isFinite(change24h)

  const SUGGESTION_CARDS = [
    { icon: spectreIcons.trending, title: 'Bull vs Bear', desc: 'Thesis, verdict & swing factor', prompt: `Give me the bull case and bear case for ${displayName}. End with a verdict (lean + conviction) and the single key swing factor that decides it.` },
    { icon: spectreIcons.news, title: 'Why moving', desc: 'The real driver right now', prompt: `Why is ${displayName} moving right now? Lead with the real driver — catalyst, market structure (float/supply/flows), or positioning — and tie it to the price action.` },
    { icon: spectreIcons.sentiment, title: 'Crowd psychology', desc: 'Cycle phase & who is holding', prompt: `Where is ${displayName} in the market cycle, and what is the crowd doing — euphoria or capitulation, weak vs strong hands, is the move reflexive?` },
    { icon: spectreIcons.sector, title: 'Structure & supply', desc: 'Float, unlocks, forced flows', prompt: `Break down ${displayName}'s market structure: free float vs locked supply, unlock/dilution overhang, FDV vs market cap, and any forced or passive flows (index inclusion, ETF mandates).` },
  ]

  const FOLLOW_UPS = [
    { label: 'Bear case', prompt: `What's the strongest bear case for ${displayName} — what breaks this?` },
    { label: 'Structure', prompt: `What does the supply structure (float, unlocks, dilution) mean for ${displayName} from here?` },
    { label: 'Go deeper', prompt: 'Can you elaborate more on that?' },
  ]

  // Scroll the messages container directly, never via scrollIntoView - the
  // latter walks up and scrolls the whole document, yanking the page (and the
  // header) out of view every time a message streams in. preventScroll on the
  // mount-focus stops the browser from scrolling the input into view too.
  useEffect(() => {
    const c = messagesEndRef.current?.parentElement
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
  }, [messages])
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }) }, [])
  // The "thinking" status line now cycles inside <ThinkingIndicator/> (self-contained
  // state), so the parent no longer re-renders every 1.5s while waiting on a token.
  useEffect(() => { return () => cleanupVoice() }, [])
  // Abort any in-flight answer stream on unmount - the panel is normally kept
  // mounted via display:none, but a real unmount mid-stream would leak the
  // fetch reader and setState into a dead component.
  useEffect(() => () => { abortRef.current?.abort() }, [])
  // Token switch = new conversation. Abort the previous token's in-flight
  // stream and clear the thread so token A's answer can't keep streaming into
  // (or be spoken under) token B. The per-token system context makes a carried
  // thread wrong anyway.
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages([])
    setError(null)
    setIsStreaming(false)
  }, [sym])
  // Clear any pending voice re-listen timers on unmount, and also when the
  // user toggles voice mode off — pending recursive setTimeouts would
  // otherwise call startListening() after the user already exited.
  useEffect(() => () => { clearVoiceTimers() }, [clearVoiceTimers])
  useEffect(() => { if (!voiceMode) clearVoiceTimers() }, [voiceMode, clearVoiceTimers])

  // Keep voiceState ref in sync
  useEffect(() => { voiceStateRef.current = voiceState }, [voiceState])

  // Preload voices. `onvoiceschanged` is a singleton property on the
  // SpeechSynthesis interface: previously this assignment overwrote whatever
  // any other component had set, and we never restored it on unmount, so the
  // last mounted RzAgentChat owned the handler forever (memory leak + cross-
  // component interference). Save and restore the prior handler instead.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.getVoices()
    const previous = window.speechSynthesis.onvoiceschanged
    const handler = () => window.speechSynthesis.getVoices()
    window.speechSynthesis.onvoiceschanged = handler
    return () => {
      // Only restore if no other component clobbered our handler in the
      // meantime — otherwise we'd undo their setup.
      if (window.speechSynthesis.onvoiceschanged === handler) {
        window.speechSynthesis.onvoiceschanged = previous || null
      }
    }
  }, [])

  // ── Voice Functions ──────────────────────────────────────────────────────

  const cleanupVoice = useCallback(() => {
    if (recognitionRef.current) { try { recognitionRef.current.abort() } catch (e) {} recognitionRef.current = null }
    if (audioFrameRef.current) { cancelAnimationFrame(audioFrameRef.current); audioFrameRef.current = null }
    if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch (e) {} audioCtxRef.current = null }
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null }
    analyserRef.current = null
    window.speechSynthesis?.cancel()
  }, [])

  const startAudioTracking = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.75
      source.connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser

      const rawData = new Uint8Array(analyser.frequencyBinCount)

      const tick = () => {
        if (!analyserRef.current) return
        const now = performance.now()

        analyserRef.current.getByteFrequencyData(rawData)

        // Smooth decay buffer
        const sd = smoothDataRef.current
        for (let i = 0; i < rawData.length && i < sd.length; i++) {
          const target = rawData[i] / 255
          const current = sd[i]
          sd[i] = target > current
            ? current + (target - current) * 0.45
            : current + (target - current) * 0.08
        }

        // Audio level
        let sum = 0
        const s = 2, e = Math.min(40, rawData.length)
        for (let i = s; i < e; i++) sum += rawData[i]
        setAudioLevel(Math.min(1, (sum / ((e - s) * 255)) * 3))

        // Draw canvas
        if (canvasRef.current) {
          drawVoiceCanvas(canvasRef.current, sd, particlesRef.current, voiceStateRef.current, sum / ((e - s) * 255) * 2.5, now, false)
        }

        audioFrameRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch (e) {
      // silently handled
      // Fallback: CSS-only animation loop for canvas
      const fallbackTick = () => {
        if (!voiceModeRef.current) return
        const now = performance.now()
        if (canvasRef.current) {
          drawVoiceCanvas(canvasRef.current, null, particlesRef.current, voiceStateRef.current, 0, now, false)
        }
        audioFrameRef.current = requestAnimationFrame(fallbackTick)
      }
      fallbackTick()
    }
  }, [])

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    const recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.maxAlternatives = 1

    voiceTranscriptRef.current = ''
    setVoiceTranscript('')
    setVoiceState('listening')

    recognition.onresult = (event) => {
      let interim = '', final = ''
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript
        else interim += event.results[i][0].transcript
      }
      const text = final || interim
      voiceTranscriptRef.current = text
      setVoiceTranscript(text)
    }

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') {
        if (voiceModeRef.current && event.error === 'no-speech') {
          scheduleVoice(() => { if (voiceModeRef.current) startListening() }, 300)
        }
        return
      }
      // silently handled
    }

    recognition.onend = () => {
      const text = voiceTranscriptRef.current?.trim()
      if (text && voiceModeRef.current) {
        handleVoiceSend(text)
      } else if (voiceModeRef.current) {
        scheduleVoice(() => { if (voiceModeRef.current) startListening() }, 300)
      }
    }

    recognition.start()
    recognitionRef.current = recognition
  }, [])

  const speakText = useCallback((text) => {
    if (!text || !window.speechSynthesis || !voiceModeRef.current) return

    setVoiceState('speaking')
    setAudioLevel(0)

    const cleanText = text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/###?\s*/g, '')
      .replace(/[-*]\s+/g, ', ')
      .replace(/\d+\.\s+/g, '')

    const utterance = new SpeechSynthesisUtterance(cleanText)
    utterance.rate = 1.0
    utterance.pitch = 0.95
    utterance.volume = 1.0

    const voice = getPreferredVoice()
    if (voice) utterance.voice = voice

    // Simulate audio level while speaking for canvas visualization
    let speakFrame
    const sim = () => {
      if (!voiceModeRef.current) return
      const t = performance.now() / 1000
      const level = 0.3 + 0.22 * Math.sin(t * 4.2) + 0.18 * Math.sin(t * 6.8) + 0.12 * Math.sin(t * 11.3) + 0.08 * Math.random()
      setAudioLevel(Math.min(1, Math.max(0, level)))

      // Update canvas during speaking
      if (canvasRef.current) {
        drawVoiceCanvas(canvasRef.current, null, particlesRef.current, 'speaking', level, performance.now(), false)
      }
      speakFrame = requestAnimationFrame(sim)
    }
    sim()

    utterance.onend = () => {
      cancelAnimationFrame(speakFrame)
      setAudioLevel(0)
      if (voiceModeRef.current) scheduleVoice(() => { if (voiceModeRef.current) startListening() }, 600)
    }
    utterance.onerror = () => {
      cancelAnimationFrame(speakFrame)
      setAudioLevel(0)
      if (voiceModeRef.current) scheduleVoice(() => { if (voiceModeRef.current) startListening() }, 600)
    }

    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }, [startListening])

  const handleVoiceSend = useCallback((text) => {
    setVoiceState('processing')
    setAudioLevel(0)
    onStreamCompleteRef.current = (responseText) => {
      if (voiceModeRef.current) speakText(responseText)
    }
    sendMessage(text)
  }, [speakText])

  const startVoiceMode = useCallback(async () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setError('Voice not supported. Try Chrome.'); return }

    // Setup canvas for HiDPI
    requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (canvas) {
        const dpr = window.devicePixelRatio || 1
        canvas.width = 300 * dpr
        canvas.height = 300 * dpr
        canvas.style.width = '300px'
        canvas.style.height = '300px'
      }
    })

    setVoiceMode(true)
    voiceModeRef.current = true
    setVoiceTranscript('')
    setVoiceState('listening')
    setError(null)
    particlesRef.current = initParticles()
    smoothDataRef.current.fill(0)

    await startAudioTracking()
    startListening()
  }, [startAudioTracking, startListening])

  const exitVoiceMode = useCallback(() => {
    voiceModeRef.current = false
    setVoiceMode(false)
    setVoiceState('idle')
    setVoiceTranscript('')
    setAudioLevel(0)
    onStreamCompleteRef.current = null
    cleanupVoice()
  }, [cleanupVoice])

  // ── Core Chat ────────────────────────────────────────────────────────────

  // `opts.display` shows a short label in the bubble while the full grounded
  // brief still goes to the model — a 40-line measured prompt is context, not
  // something the user should have to read back at themselves.
  const sendMessage = useCallback(async (text, opts = {}) => {
    if (!text.trim() || isStreaming) return
    const userMsg = { id: nextId(), role: 'user', content: text.trim(), display: opts.display || null, timestamp: Date.now() }
    const assistantId = nextId()
    drawEmittedRef.current = false
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setError(null)
    setIsStreaming(true)
    streamTextRef.current = ''
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', timestamp: Date.now(), streaming: true }])

    const tokenId = SYMBOL_TO_COINGECKO_ID[sym] || sym.toLowerCase()
    // Spectre monarch-chat expects { messages: [{role, content}], context } —
    // we send the full conversation so the backend can do asset carryover and
    // follow-up topic inheritance, plus a context block pinning the active token.
    //
    // Asset-detection guard: the backend's ticker regex only picks up ALL-CAPS
    // symbols up to 6 chars (so "SPECTRE" / long tickers fall through), and it
    // ignores our `context` block for asset routing. We prepend an invisible
    // `$SYMBOL` hint to the latest user message only — it's detected by the
    // $TICKER regex on the server but never shown in the UI. Older messages
    // stay clean so we don't over-stuff the carryover history.
    const tickerHint = sym && /^[A-Za-z][A-Za-z0-9]{0,11}$/.test(sym) ? `$${sym.toUpperCase()} ` : ''
    // Built before the fetch — if any context builder throws, degrade to an
    // empty preamble rather than hanging the agent on "Analyzing…".
    let livePreamble = ''
    try {
      livePreamble = buildLiveDataBlock(sym, displayName, tokenData, catalysts, social)
    } catch (err) {
      console.error('[rz-agent] preamble build failed', err)
    }
    const history = [...messages, userMsg].map((m, i, arr) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: (i === arr.length - 1 && m.role === 'user')
        ? `${livePreamble}${tickerHint}${m.content}`
        : m.content,
    }))
    const contextBlock = {
      symbol: sym,
      tokenId,
      tokenName: displayName,
      surface: 'research-zone-agent',
      // Live metrics from the app's own Codex-backed feed. The server passes
      // `context` to the system prompt builder (monarch-chat.js:1160), so any
      // downstream prompt that respects context will see these first.
      live: tokenData ? {
        price: tokenData.price,
        change1h: tokenData.change1h,
        change24h: tokenData.change24h,
        change7d: tokenData.change7d,
        change30d: tokenData.change30d,
        low24h: tokenData.low24h,
        high24h: tokenData.high24h,
        volume24h: tokenData.volume24h,
        marketCap: tokenData.marketCap,
      } : null,
      // Freshest real headlines so the server prompt can explain the move with
      // named drivers (M&A, big investors, product, momentum) for this exact asset.
      catalysts: Array.isArray(catalysts)
        ? catalysts.slice(0, 6).map((c) => ({ title: c.title, source: c.source, date: c.date }))
        : [],
      // The crowd read — sentiment tilt + loudest voices — so the brain fuses
      // news with "what people are saying", like a human scanning the timeline.
      social: social ? {
        sentScore: social.sentScore || null,
        voices: Array.isArray(social.voices)
          ? social.voices.slice(0, 5).map((v) => ({ handle: v.handle, followers: v.followers, text: v.text }))
          : [],
      } : null,
    }

    try {
      const controller = new AbortController()
      abortRef.current = controller
      const response = await fetch(AI_AGENT_SSE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ messages: history, context: contextBlock }),
        signal: controller.signal,
      })
      if (!response.ok) {
        let detail = ''
        try { detail = (await response.json())?.error || '' } catch (_) {}
        throw new Error(detail || `Server error: ${response.status}`)
      }
      if (!response.body) throw new Error('Streaming not supported by this browser')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamDone = false

      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, tail } = parseSseFrames(buffer)
        buffer = tail

        for (const raw of frames) {
          if (raw === '[DONE]') { streamDone = true; break }
          let parsed
          try { parsed = JSON.parse(raw) } catch (_) { continue }
          if (parsed.type === 'text' && typeof parsed.content === 'string') {
            streamTextRef.current += parsed.content
            const t = streamTextRef.current
            // The trailing ```draw block is chart instructions, not prose —
            // hide it from the bubble the moment the fence appears. One
            // indexOf per token, not a regex over the whole accumulation
            // (that is the documented O(n²) streaming trap).
            const fence = t.indexOf('```draw')
            const shown = fence === -1 ? t : t.slice(0, fence).trimEnd()
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: shown } : m))
          } else if (parsed.type === 'error') {
            throw new Error(parsed.content || 'Agent error')
          }
          // parsed.type === 'meta' is informational (endpoints used, summary) — ignore in UI for now
        }
      }

      const finalText = streamTextRef.current
      const { drawings, text: cleanText } = extractAgentDrawings(finalText)
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: cleanText, streaming: false } : m))
      if (drawings.length && !drawEmittedRef.current) {
        drawEmittedRef.current = true
        onAgentDrawingsRef.current?.(drawings)
      }
      if (onStreamCompleteRef.current) { onStreamCompleteRef.current(cleanText); onStreamCompleteRef.current = null }
    } catch (err) {
      if (err.name === 'AbortError') {
        onStreamCompleteRef.current = null
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m))
        return
      }
      // silently handled
      setError(err.message || 'Connection failed')
      onStreamCompleteRef.current = null
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.id === assistantId && !last.content) return prev.slice(0, -1)
        return prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m)
      })
      if (voiceModeRef.current) scheduleVoice(() => { if (voiceModeRef.current) startListening() }, 1000)
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [sym, isStreaming, displayName, startListening, messages, tokenData])

  // A chart selection arrived. Fire it once — the id changes per request, so a
  // re-render (or the panel remounting when the sidebar tab flips) cannot
  // replay the last analysis.
  const sendMessageRef = useRef(sendMessage)
  sendMessageRef.current = sendMessage
  useEffect(() => {
    if (!taRequest?.id || !taRequest.prompt) return
    if (taRequestIdRef.current === taRequest.id) return
    // 🪤 Deferred by one tick on purpose. When a selection arrives while this
    // panel is MOUNTING (the mobile sheet is lazy, so that is the normal case),
    // firing synchronously loses the message: StrictMode's double-mount runs
    // the `[sym]` reset effect a second time and wipes the thread, while the
    // unmount cleanup aborts the in-flight stream — and the id guard then
    // blocks the retry. Scheduling past the mount, and claiming the id only
    // when the timer actually runs, makes it fire exactly once and survive.
    const id = setTimeout(() => {
      taRequestIdRef.current = taRequest.id
      sendMessageRef.current(taRequest.prompt, { display: taRequest.display })
    }, 0)
    return () => clearTimeout(id)
  }, [taRequest])

  const handleSubmit = useCallback((e) => { e.preventDefault(); sendMessage(input) }, [input, sendMessage])
  const handleKeyDown = useCallback((e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }, [input, sendMessage])
  const handleStop = useCallback(() => { if (abortRef.current) abortRef.current.abort() }, [])
  const handleClear = useCallback(() => { if (isStreaming && abortRef.current) abortRef.current.abort(); setMessages([]); setError(null); setIsStreaming(false) }, [isStreaming])
  const handleInputChange = useCallback((e) => { setInput(e.target.value); const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px' }, [])
  const handleRetry = useCallback(() => { setError(null); const m = [...messages].reverse().find(m => m.role === 'user'); if (m) sendMessage(m.content) }, [messages, sendMessage])

  const showFollowUps = messages.length > 0 && !isStreaming && !voiceMode &&
    messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.streaming

  const tree = (
    <>
    {windowed && <div className="rz-agent-scrim" onClick={() => setWindowed(false)} aria-hidden />}
    <div ref={rootRef} className={`rz-agent-chat ${dayMode ? 'day-mode' : ''} ${windowed ? 'is-window' : ''}`}>
      {/* Top strip. It used to appear only once a conversation existed, which
          left nowhere to expand FROM on an empty chat — the moment you most
          want the bigger window is before you start typing into a 340px
          column. Clear still waits for something to clear. */}
      {!voiceMode && (
        <div className="rz-agent-topbar">
          {messages.length > 0 && (
            <button className="rz-agent-clear-btn" onClick={handleClear} title="Clear conversation">
              <ClearIcon /><span>Clear</span>
            </button>
          )}
          <button
            type="button"
            className="rz-agent-expand-btn"
            onClick={() => setWindowed((v) => !v)}
            title={windowed ? 'Dock to sidebar' : 'Open in a window'}
            aria-label={windowed ? 'Dock to sidebar' : 'Open in a window'}
            aria-pressed={windowed}
          >
            {windowed ? <CollapseIcon /> : <ExpandIcon />}
          </button>
        </div>
      )}

      {/* ── Voice Mode Overlay ──────────────────────────────────────── */}
      {voiceMode && (
        <div className="rz-voice-overlay">
          <button className="rz-voice-close" onClick={exitVoiceMode}><CloseIcon /></button>

          <div className="rz-voice-content">
            {/* Aurora background */}
            <div className="rz-voice-aurora" />

            {/* Visualizer area: canvas + orb */}
            <div className="rz-voice-visualizer">
              <canvas ref={canvasRef} className="rz-voice-canvas" />
              <div className={`rz-voice-orb is-${voiceState}`} style={{ '--audio-level': audioLevel }}>
                <div className="rz-voice-glow" />
                <div className="rz-voice-ring rz-voice-ring-1" />
                <div className="rz-voice-ring rz-voice-ring-2" />
                <div className="rz-voice-ring rz-voice-ring-3" />
                <div className="rz-voice-core">
                  <div className="rz-voice-core-inner" />
                  <div className="rz-voice-core-shine" />
                </div>
              </div>
            </div>

            <div className="rz-voice-info">
              <span className={`rz-voice-status is-${voiceState}`}>
                {voiceState === 'listening' && 'Listening'}
                {voiceState === 'processing' && 'Thinking'}
                {voiceState === 'speaking' && 'Speaking'}
              </span>
              {voiceTranscript && <p className="rz-voice-transcript">{voiceTranscript}</p>}
              {voiceState === 'listening' && !voiceTranscript && <p className="rz-voice-hint">Say something...</p>}
            </div>
          </div>

          <button className="rz-voice-end" onClick={exitVoiceMode}>End conversation</button>
        </div>
      )}

      {/* Empty State */}
      {!voiceMode && messages.length === 0 ? (
        <div className="rz-agent-empty">
          <div className="rz-agent-empty-hero">
            <div className="rz-agent-eyebrow">
              <span className="rz-agent-eyebrow-dot" />
              <span className="rz-agent-eyebrow-sym">{sym}</span>
              {hasChange ? (
                <span className={`rz-agent-eyebrow-chg ${change24h >= 0 ? 'is-up' : 'is-down'}`}>
                  {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                </span>
              ) : (
                <><span className="rz-agent-eyebrow-sep">·</span><span>Live</span></>
              )}
            </div>
            <h3 className="rz-agent-empty-title">What do you want to know about <span className="rz-agent-empty-token">{displayName}</span>?</h3>
          </div>
          <div className="rz-agent-rows-label">Research angles</div>
          <div className="rz-agent-rows">
            {SUGGESTION_CARDS.map((card, i) => (
              <button
                key={card.title}
                className="rz-agent-row ui-glass"
                style={{ animationDelay: `${0.16 + i * 0.06}s` }}
                onClick={() => sendMessage(card.prompt)}
              >
                {/* No 01/02/03 markers: these are four parallel angles, not a
                    sequence, so the numbering encoded nothing. */}
                <span className="rz-agent-row-text">
                  <span className="rz-agent-row-title">{card.title}</span>
                  <span className="rz-agent-row-desc">{card.desc}</span>
                </span>
                <span className="rz-agent-row-arrow"><SendIcon /></span>
              </button>
            ))}
          </div>
        </div>
      ) : !voiceMode ? (
        <div className="rz-agent-messages">
          {messages.map((msg) => (
            <AgentMessage key={msg.id} msg={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      ) : null}

      {error && !voiceMode && (
        <div className="rz-agent-error"><ErrorIcon /><span>{error}</span><button className="rz-agent-error-retry" onClick={handleRetry}>Retry</button></div>
      )}

      {showFollowUps && (
        <div className="rz-agent-followups">
          {FOLLOW_UPS.map((f) => <button key={f.label} className="rz-agent-followup ui-glass" onClick={() => sendMessage(f.prompt)}>{f.label}</button>)}
        </div>
      )}

      {!voiceMode && (
        <form className="rz-agent-input-bar" onSubmit={handleSubmit}>
          <div className={`rz-agent-input-wrap ${isStreaming ? 'is-streaming' : ''}`}>
            <textarea ref={inputRef} className="rz-agent-input" value={input} onChange={handleInputChange} onKeyDown={handleKeyDown} placeholder={`Ask about ${displayName}...`} rows={1} disabled={isStreaming} />
            {isStreaming ? (
              <button type="button" className="rz-agent-stop-btn" onClick={handleStop} title="Stop generating"><StopIcon /></button>
            ) : (
              <>
                <button type="button" className="rz-agent-mic-btn" onClick={startVoiceMode} title="Voice mode"><MicIcon /></button>
                <button type="submit" className={`rz-agent-send-btn ${input.trim() ? 'is-ready' : ''}`} disabled={!input.trim()}><SendIcon /></button>
              </>
            )}
          </div>
        </form>
      )}
    </div>
    </>
  )

  return windowed ? <AppPortal>{tree}</AppPortal> : tree
}

export default React.memo(RzAgentChat)
