/**
 * AgentChatSurface - presentation-only chat internals (message list +
 * tool-activity rows + composer) shared by the desktop SpectreAgentPanel
 * and the future MobileAgentSheet. Receives useAgentChat state as props so
 * both shells stay thin. Trade/order cards land in Phase 2/3 - this
 * renders their placeholders defensively so old sessions never crash.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { ArrowUp, Loader2, ShieldAlert, AudioLines } from 'lucide-react'
import AgentTradeCard from './AgentTradeCard'
import AgentOrderTicket from './AgentOrderTicket'
import AgentChartCard from './AgentChartCard'
import AgentXActivityCard from './AgentXActivityCard'
import AgentBriefMessage from './AgentBriefMessage'
import AgentVoiceSession from './AgentVoiceSession'
import AgentOrbFace from './AgentOrbFace'
import AgentMarkdown from './AgentMarkdown'
import { voiceSessionSupported } from '../../hooks/useVoiceSession'
import { searchTokens } from '../../services/codexApi'
import './AgentCards.css'

// Solana + the EVM set the app trades on - cashtag clicks resolve across all.
const CASHTAG_NETWORKS = [1399811149, 1, 56, 8453, 42161, 137, 4663]

const TOOL_LABELS = {
  get_token_snapshot: 'reading market snapshot',
  get_bars_summary: 'analyzing the chart',
  get_security: 'checking contract security',
  get_x_intel: 'scanning X mentions',
  get_x_profile: 'reading the X account',
  get_wallet_balances: 'reading wallet balances',
  quote_swap: 'quoting the trade',
}

function ToolRow({ tool }) {
  return (
    <div className={`sagent-tool sagent-tool--${tool.status}`}>
      {tool.status === 'running'
        ? <Loader2 size={11} className="sagent-tool__spin" />
        : <span className={`sagent-tool__dot ${tool.status === 'failed' ? 'is-failed' : ''}`} />}
      <span className="sagent-tool__label">{TOOL_LABELS[tool.name] || tool.name}</span>
      {tool.summary && tool.status !== 'running' && <span className="sagent-tool__summary">{tool.summary}</span>}
    </div>
  )
}

function Message({ msg, surface, onCashtag }) {
  if (msg.role === 'system') {
    return (
      <div className="sagent-msg sagent-msg--system">
        <ShieldAlert size={12} />
        <span>{msg.text}</span>
      </div>
    )
  }
  const isUser = msg.role === 'user'
  return (
    <div className={`sagent-msg ${isUser ? 'sagent-msg--user' : 'sagent-msg--model'}`}>
      {!!msg.tools?.length && (
        <div className="sagent-msg__tools">
          {msg.tools.map((t) => <ToolRow key={t.id} tool={t} />)}
        </div>
      )}
      {msg.text ? (
        isUser
          ? <div className="sagent-msg__text">{msg.text}</div>
          : <div className="sagent-msg__text"><AgentMarkdown text={msg.text} profiles={msg.xProfiles} onCashtag={onCashtag} /></div>
      ) : null}
      {msg.streaming && !msg.text && !msg.tools?.length && (
        <div className="sagent-msg__thinking"><span /><span /><span /></div>
      )}
      {(msg.visuals || []).map((v, i) => (
        v.kind === 'x_activity'
          ? <AgentXActivityCard key={`${v.kind}-${i}`} visual={v} />
          : <AgentChartCard key={`${v.kind}-${v.resolution || i}`} visual={v} />
      ))}
      {msg.proposal && <AgentTradeCard proposal={msg.proposal} surface={surface} />}
      {msg.ticket && <AgentOrderTicket ticket={msg.ticket} surface={surface} />}
    </div>
  )
}

const SUGGESTIONS = [
  "What's happening with this token right now?",
  'Is this contract safe?',
  "How's the chart looking - trend and levels?",
  "What's X saying about it?",
]

export default function AgentChatSurface({ chat, tokenSymbol, surface = 'desktop', onSelectToken, brief, briefLoading, voice, autoVoice = false, voiceEpoch = 0, onVoiceActiveChange }) {
  const { messages, send, streaming } = chat
  const [draft, setDraft] = useState('')
  const listRef = useRef(null)
  const pinnedRef = useRef(true)
  const cashtagBusyRef = useRef(false)

  // The live voice session (Jarvis open dialog): JWT-only server lane +
  // Web Speech STT, so the orb only exists signed-in, outside the iframe,
  // on browsers that HAVE SpeechRecognition (iOS Safari does not).
  const voiceAvailable = voiceSessionSupported() && chat.authenticated && surface !== 'embed'

  // VOICE FIRST: a deliberate open (FAB tap) drops straight into the live
  // conversation when it is possible - typing is the second option. The
  // auto-open (token load) never hot-mics; it shows the speaking face.
  const [voiceOpen, setVoiceOpen] = useState(() => !!autoVoice && voiceAvailable)

  // "Hey Spectre" while the panel is ALREADY open (text mode): the launcher
  // bumps voiceEpoch and we enter the live conversation. Rising-edge only -
  // the mount-time value must never hot-mic an auto-open.
  const epochRef = useRef(voiceEpoch)
  useEffect(() => {
    if (voiceEpoch !== epochRef.current) {
      epochRef.current = voiceEpoch
      if (voiceAvailable) setVoiceOpen(true)
    }
  }, [voiceEpoch, voiceAvailable])

  // Tell the launcher when a session actually RUNS (it owns the page's one
  // SpeechRecognition - the wake-word listener yields exactly then).
  useEffect(() => {
    onVoiceActiveChange?.(voiceOpen)
    return () => onVoiceActiveChange?.(false)
  }, [voiceOpen, onVoiceActiveChange])

  // $CASHTAG click -> resolve the symbol via token search, hand the best
  // match to the app's own selectToken (same path as the header search).
  // Exact-symbol match wins; results come liquidity-ranked so [0] is the
  // real one, not an impersonator.
  const handleCashtag = useCallback(async (tag) => {
    if (!onSelectToken || cashtagBusyRef.current) return
    const sym = String(tag || '').replace(/^\$/, '')
    if (!sym || sym.toUpperCase() === String(tokenSymbol || '').replace(/^\$/, '').toUpperCase()) return
    cashtagBusyRef.current = true
    try {
      const r = await searchTokens(sym, CASHTAG_NETWORKS)
      const results = r?.filterTokens?.results || []
      const exact = results.find((x) => String(x.symbol || '').replace(/^\$/, '').toUpperCase() === sym.toUpperCase())
      const pick = exact || results[0]
      if (pick) onSelectToken(pick, 'agent-cashtag')
    } catch { /* leave the chat untouched on a failed lookup */ }
    finally { cashtagBusyRef.current = false }
  }, [onSelectToken, tokenSymbol])

  // Pinned auto-scroll: follow the stream unless the user scrolled up.
  useEffect(() => {
    const el = listRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }, [])

  const submit = useCallback(() => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    pinnedRef.current = true
    send(text)
  }, [draft, streaming, send])

  // Voice turns are session-memory, not transcript: the text surface shows
  // only typed exchanges (plus any voice turn carrying a confirm card or a
  // presentation - those artifacts outlive the spoken exchange).
  const visibleMessages = messages.filter((m) => !m.voice || m.proposal || m.ticket || m.visuals?.length)

  // Voice session replaces the whole surface while open (mount = mic on).
  if (voiceOpen) {
    return (
      <div className="sagent-surface">
        <AgentVoiceSession
          chat={chat}
          tokenSymbol={tokenSymbol}
          surface={surface}
          onClose={() => setVoiceOpen(false)}
        />
      </div>
    )
  }

  return (
    <div className="sagent-surface">
      {/* The agent's FACE - the voice-first identity, FIXED above the
          scrolling thread (the pinned auto-scroll must never push Jarvis
          out of view). Animates while the brief speaks or a reply streams;
          tapping it starts the live conversation when available. */}
      <AgentOrbFace
        speaking={voice?.status === 'playing' || voice?.status === 'loading'}
        thinking={streaming}
        canTalk={voiceAvailable}
        onTalk={() => { voice?.stop?.(); setVoiceOpen(true) }}
        statusText={voice?.status === 'playing' ? 'Speaking' : streaming ? 'Thinking' : null}
      />
      <div className="sagent-list" ref={listRef} onScroll={onScroll}>
        {/* The opening brief ("Jarvis mode") sits above the thread - it is
            NOT a session message; follow-ups carry it via the digest. */}
        {(brief || briefLoading) && (
          <AgentBriefMessage brief={brief} loading={briefLoading} tokenSymbol={tokenSymbol} voice={voice} />
        )}
        {!visibleMessages.length && !brief && !briefLoading && (
          <div className="sagent-empty">
            <div className="sagent-empty__title">Ask me about {tokenSymbol || 'this token'}</div>
            <div className="sagent-empty__hint">I've got the live market data, the chart, contract safety, X chatter - all from this page.</div>
            <div className="sagent-empty__chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="sagent-chip" onClick={() => { pinnedRef.current = true; send(s) }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {!visibleMessages.length && (brief || briefLoading) && (
          <div className="sagent-empty__chips sagent-empty__chips--underbrief">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="sagent-chip" onClick={() => { pinnedRef.current = true; send(s) }}>
                {s}
              </button>
            ))}
          </div>
        )}
        {visibleMessages.map((m, i) => <Message key={`${m.ts || i}-${i}`} msg={m} surface={surface} onCashtag={onSelectToken ? handleCashtag : undefined} />)}
      </div>

      <div className="sagent-composer">
        <textarea
          className="sagent-composer__input"
          placeholder={`Ask about ${tokenSymbol || 'this token'}...`}
          value={draft}
          rows={1}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          }}
        />
        {voiceAvailable && (
          <button
            type="button"
            className="sagent-composer__voice"
            title="Talk to the agent"
            aria-label="Start voice conversation"
            onClick={() => { voice?.stop?.(); setVoiceOpen(true) }}
          >
            <AudioLines size={14} />
          </button>
        )}
        <button
          type="button"
          className="sagent-composer__send"
          disabled={!draft.trim() || streaming}
          onClick={submit}
          aria-label="Send"
        >
          {streaming ? <Loader2 size={14} className="sagent-tool__spin" /> : <ArrowUp size={14} />}
        </button>
      </div>
    </div>
  )
}
