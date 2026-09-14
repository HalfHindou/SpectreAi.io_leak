/**
 * AgentBriefMessage - the agent's opening brief, rendered at the top of the
 * chat surface the moment a token page opens ("Jarvis mode"). Presentation
 * only: receives the server brief doc from useAgentBrief. Not part of the
 * chat session (never persisted into messages) - follow-up questions carry
 * it via the digest instead (briefForDigest).
 */
import { ShieldCheck, ShieldAlert, AlertTriangle, Activity, Users, MessageSquare, BookOpen, TrendingUp, Flame, Volume2, VolumeX, Pause, Loader2 } from 'lucide-react'
import useSettingsStore from '../../store/useSettingsStore'
import { agentSalutation, greetingHasSalutation, humanizeName } from '../../lib/greeting'
import { getVisitCount } from '../../hooks/useAgentBrief'
import { voiceSessionSupported } from '../../hooks/useVoiceSession'
import './AgentBriefMessage.css'

const STANCE_LABELS = {
  clean: 'No hard blockers',
  opportunity: 'Opportunity read',
  caution: 'Caution',
  avoid: 'Avoid',
  neutral: 'Neutral read',
}

const SECTION_ICONS = {
  security: ShieldCheck,
  holders: Users,
  social: MessageSquare,
  narrative: BookOpen,
  market: Activity,
  momentum: TrendingUp,
  risks: AlertTriangle,
}

function agoLabel(ts) {
  if (!ts) return null
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

// meta.missing entries -> one honest, human line (only the gaps a trader
// would act on; plumbing-level entries stay in the payload, not the UI).
function missingLine(missing) {
  if (!Array.isArray(missing) || !missing.length) return null
  const parts = []
  if (missing.some((m) => m.startsWith('security'))) parts.push('security scan')
  if (missing.some((m) => m.startsWith('holderDetail'))) parts.push('holder analytics')
  if (missing.includes('social')) parts.push('X chatter')
  if (missing.includes('chart')) parts.push('chart data')
  if (!parts.length) return null
  return `Not covered here: ${parts.join(', ')}.`
}

/** Compact speak/pause control - state comes from useAgentVoice (PR2). */
function VoiceControl({ voice }) {
  if (!voice) return null
  const { status } = voice
  if (status === 'loading') {
    return (
      <span className="sabrief__voicebtn sabrief__voicebtn--busy" title="Preparing audio">
        <Loader2 size={12} className="sabrief__voicespin" />
      </span>
    )
  }
  if (status === 'playing') {
    return (
      <button type="button" className="sabrief__voicebtn sabrief__voicebtn--live" title="Pause" onClick={voice.pause}>
        <span className="sabrief__eq" aria-hidden="true"><i /><i /><i /></span>
        <Pause size={11} />
      </button>
    )
  }
  if (status === 'blocked') {
    return (
      <button type="button" className="sabrief__voicebtn sabrief__voicebtn--cta" onClick={voice.play}>
        <Volume2 size={11} /> tap to hear
      </button>
    )
  }
  const Muted = voice.enabled === false
  return (
    <button
      type="button"
      className="sabrief__voicebtn"
      title={status === 'paused' ? 'Resume' : Muted ? 'Play this brief' : 'Speak this brief'}
      onClick={voice.play}
    >
      {Muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
    </button>
  )
}

export default function AgentBriefMessage({ brief, loading, tokenSymbol, voice }) {
  const agentBrief = useSettingsStore((s) => s.agentBrief)
  const setAgentBrief = useSettingsStore((s) => s.setAgentBrief)
  const agentVoice = useSettingsStore((s) => s.agentVoice)
  const setAgentVoice = useSettingsStore((s) => s.setAgentVoice)
  const profileName = useSettingsStore((s) => s.profile?.name)

  if (!brief && loading) {
    return (
      <div className="sabrief sabrief--loading" aria-label="Analyzing token">
        <div className="sabrief__head">
          <span className="sabrief__pulse" aria-hidden="true" />
          <span className="sabrief__label">Analyzing {tokenSymbol || 'token'}</span>
        </div>
        <div className="sabrief__skel" style={{ width: '82%' }} />
        <div className="sabrief__skel" style={{ width: '94%' }} />
        <div className="sabrief__skel" style={{ width: '68%' }} />
        <div className="sabrief__skel-hint">Security, chatter quality, holders, chart - one read.</div>
      </div>
    )
  }
  if (!brief?.verdict) return null

  const stance = brief.verdict.stance || 'neutral'
  const stale = brief.stale === true
  const autoOpenOn = agentBrief?.autoOpen !== false

  // Personal salutation - client-composed because the brief doc is KV-shared
  // across users. Wit variants are STANCE-GATED (the no-jokes-about-risk
  // persona rail applies here too); stale docs that still carry their own
  // salutation-style greeting are never doubled up.
  const salutation = greetingHasSalutation(brief.greeting) ? null : agentSalutation({
    name: humanizeName(profileName),
    visitCount: getVisitCount(brief.token || { address: '', networkId: 0 }),
    witAllowed: stance === 'clean' || stance === 'opportunity' || stance === 'neutral',
    symbol: brief.token?.symbol || tokenSymbol,
  })

  return (
    <div className={`sabrief sabrief--${stance}`}>
      <div className="sabrief__head">
        <span className={`sabrief__dot sabrief__dot--${stance}`} aria-hidden="true">
          {stance === 'avoid' ? <ShieldAlert size={11} /> : stance === 'caution' ? <Flame size={11} /> : <ShieldCheck size={11} />}
        </span>
        <span className="sabrief__label">Token brief</span>
        {voice && !voice.needsOptIn && <VoiceControl voice={voice} />}
        <span className={`sabrief__stance sabrief__stance--${stance}`}>{STANCE_LABELS[stance] || stance}</span>
      </div>

      {(salutation || brief.greeting) && (
        <div className="sabrief__greeting">
          {salutation ? `${salutation} ` : ''}{brief.greeting || ''}
        </div>
      )}

      {/* One-time voice opt-in - answering "Enable" is itself the browser
          autoplay-unlock gesture, so the first spoken brief starts here. */}
      {voice?.needsOptIn && (
        <div className="sabrief__voiceask">
          <Volume2 size={12} aria-hidden="true" />
          <span className="sabrief__voiceask-q">Voice briefings? The agent can speak these.</span>
          <button type="button" className="sabrief__voiceask-yes" onClick={voice.enable}>Enable</button>
          <button type="button" className="sabrief__voiceask-no" onClick={voice.decline}>Not now</button>
        </div>
      )}

      <div className="sabrief__verdict">{brief.verdict.line}</div>

      {!!brief.sections?.length && (
        <ul className="sabrief__sections">
          {brief.sections.map((s, i) => {
            const Icon = SECTION_ICONS[s.id] || Activity
            return (
              <li key={`${s.id}-${i}`} className={`sabrief__sec sabrief__sec--${s.severity || 'info'}`}>
                <span className="sabrief__sec-icon" aria-hidden="true"><Icon size={12} /></span>
                <span className="sabrief__sec-body">
                  <span className="sabrief__sec-title">{s.title}</span>
                  <span className="sabrief__sec-text">{s.text}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="sabrief__foot">
        <span className="sabrief__foot-note">{missingLine(brief.meta?.missing)}</span>
        <span className="sabrief__foot-meta">
          {stale ? 'refreshing - ' : ''}{agoLabel(brief.meta?.generatedAt)}
          <button
            type="button"
            className="sabrief__auto"
            title={autoOpenOn ? 'Stop opening the agent automatically on token pages' : 'Open the agent automatically on token pages'}
            onClick={() => setAgentBrief({ autoOpen: !autoOpenOn })}
          >
            auto-open {autoOpenOn ? 'on' : 'off'}
          </button>
          {agentVoice?.enabled === true && voiceSessionSupported() && (
            <button
              type="button"
              className="sabrief__auto"
              title={agentVoice?.wakeWord !== false ? 'Stop listening for "Hey Spectre"' : 'Activate the agent by saying "Hey Spectre"'}
              onClick={() => setAgentVoice({ wakeWord: agentVoice?.wakeWord === false })}
            >
              "Hey Spectre" {agentVoice?.wakeWord !== false ? 'on' : 'off'}
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
