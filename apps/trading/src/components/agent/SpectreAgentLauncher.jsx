/**
 * SpectreAgentLauncher - mounts the draggable FAB + the chat panel on the
 * token view. Lives INSIDE TokenDetailsProvider (App.jsx) so the panel's
 * context assembler can read useSharedTokenDetails. Panel open state is
 * local (transient UI never goes in the persisted store); only the FAB
 * position persists (useSettingsStore.agentFab).
 *
 * The panel never opens itself - the FAB is the only way in. It greets with
 * the server-generated brief once opened. (It used to auto-open on every
 * token load; see the note on the visit-memory effect below for why that was
 * removed outright rather than gated behind a pref.)
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import useSettingsStore from '../../store/useSettingsStore'
import { usePrivySafe } from '../../lib/use-privy-safe'
import { markAutoOpened, bumpVisit } from '../../hooks/useAgentBrief'
import { voiceSessionSupported, warmSpeechLine, markWakeTriggered, wakeAckLine } from '../../hooks/useVoiceSession'
import { getGreeting, deriveAccountName, humanizeName } from '../../lib/greeting'
import { useWakeWord } from '../../hooks/useWakeWord'
import { track, Events } from '../../services/analytics'
import SpectreAgentFab from './SpectreAgentFab'
import SpectreAgentPanel from './SpectreAgentPanel'

export default function SpectreAgentLauncher({ token, surface = 'desktop', onSelectToken }) {
  const [open, setOpen] = useState(false)
  // VOICE FIRST: a deliberate FAB tap enters the live conversation directly
  // (chat is the second option); the token-load auto-open never hot-mics.
  const [voiceFirst, setVoiceFirst] = useState(false)
  // "Hey Spectre" while the panel is already open flips it into voice via a
  // rising counter (the mount-time autoVoice prop is initial-only).
  const [voiceEpoch, setVoiceEpoch] = useState(0)
  // True only while a live voice session RUNS (lifted from the surface) -
  // that session owns the page's one SpeechRecognition, so the wake-word
  // listener yields exactly then, not whenever the panel merely sits open.
  const [voiceActive, setVoiceActive] = useState(false)
  const agentFab = useSettingsStore((s) => s.agentFab)
  const agentPanel = useSettingsStore((s) => s.agentPanel)
  const setAgentPanel = useSettingsStore((s) => s.setAgentPanel)
  const agentVoicePref = useSettingsStore((s) => s.agentVoice)
  const privy = usePrivySafe()
  const side = agentFab?.side || 'right'

  const handleOpen = useCallback(() => {
    if (token?.address) markAutoOpened(token) // manual open counts as briefed
    setVoiceFirst(true)
    setOpen(true)
    track(Events.AGENT_OPENED, { surface, chain: token?.networkId, symbol: token?.symbol, voiceFirst: true })
  }, [surface, token?.networkId, token?.symbol, token])

  // "Hey Spectre" - hands-free activation whenever no voice session is
  // running (panel closed OR open in text mode - the auto-open brief keeps
  // the panel open on every token, so gating on !open killed the wake word
  // in the app's default state). Arms only when a session COULD start
  // (voice opted-in + signed in + SR support + mic already granted - the
  // hook never prompts) and yields the mic to a running session.
  const wakeEnabled = !voiceActive
    && surface !== 'embed'
    && voiceSessionSupported()
    && !!privy?.authenticated
    && agentVoicePref?.enabled === true
    && agentVoicePref?.wakeWord !== false
  const handleWake = useCallback(() => {
    if (token?.address) markAutoOpened(token)
    markWakeTriggered() // session opens with the cached short "Yes?" ack
    setVoiceFirst(true) // mount-time voice when the panel opens fresh
    setVoiceEpoch((e) => e + 1) // flips an already-open panel into voice
    setOpen(true)
    track(Events.AGENT_WAKE_WORD, { surface, symbol: token?.symbol })
  }, [surface, token])
  const { armed: wakeArmed } = useWakeWord({ enabled: wakeEnabled, onWake: handleWake })

  // Pre-warm the wake ack while the listener is armed: the personal "Hey
  // Gleb. Listening." synthesizes + caches so a wake plays it instantly.
  // Keyed by the EXACT line (not a boolean): if the name resolves after
  // the first warm (Privy hydrates late), the personal line re-warms -
  // otherwise the wake cache-misses, live-synthesizes, and the wait cap
  // used to cut it mid-word ("Hey Gl-", live report).
  const prewarmedRef = useRef('')
  const profileName = useSettingsStore((s) => s.profile?.name)
  const wakeName = humanizeName(profileName) || (privy?.authenticated ? deriveAccountName(privy?.user) : '')
  useEffect(() => {
    if (!wakeArmed) return
    const line = wakeAckLine(wakeName)
    if (prewarmedRef.current === line) return
    const getTok = () => privy?.getAccessToken?.()
    warmSpeechLine(line, getTok)
      .then((r) => { if (r?.url) prewarmedRef.current = line })
      .catch(() => {})
    warmSpeechLine(`${getGreeting(wakeName)} I'm listening.`, getTok).catch(() => {})
  }, [wakeArmed, wakeName, privy])

  const handleClose = useCallback(() => {
    setOpen(false)
    setVoiceActive(false) // surface unmount also reports this; belt and braces
    track(Events.AGENT_CLOSED, { surface, symbol: token?.symbol })
  }, [surface, token?.symbol])

  // The agent NEVER opens itself. Landing on a token page - by deep link, by
  // "Launch Terminal", or by clicking any token - leaves the panel closed; the
  // FAB is how it opens.
  //
  // The old "Jarvis mode" auto-opened the panel, gated on agentBrief.autoOpen
  // (default TRUE, and PERSISTED). That persistence is why neither softer fix
  // worked: making the guard once-per-session still fired on the session's
  // first token, and flipping the store default would never reach anyone who
  // already had `true` written to localStorage. So the open call is gone
  // rather than re-tuned - the only way the behaviour cannot come back.
  //
  // What this effect still does: keep the visit + brief memory warm, so a
  // manually-opened panel greets correctly ("Back to TEMPO.") instead of
  // treating a repeat visit as a first one.
  const tokenKey = `${String(token?.address || '').toLowerCase()}:${token?.networkId}`
  useEffect(() => {
    if (!token?.address || token.symbol === '...') return
    bumpVisit(token) // salutation's visit memory (30s same-key dedupe inside)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenKey, token?.symbol])

  // Placeholder token during deep-link resolution: keep the FAB visible but
  // the panel gates its own data assembly until chainReady lands.
  return (
    <>
      <SpectreAgentFab open={open} onOpen={handleOpen} listening={wakeArmed} />
      {open && (
        <SpectreAgentPanel
          token={token}
          fab={agentFab}
          panelPos={agentPanel}
          onPanelMove={setAgentPanel}
          side={side}
          surface={surface}
          onClose={handleClose}
          onSelectToken={onSelectToken}
          autoVoice={voiceFirst}
          voiceEpoch={voiceEpoch}
          onVoiceActiveChange={setVoiceActive}
        />
      )}
    </>
  )
}
