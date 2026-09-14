/**
 * RZ Narrative Radar — sentiment beyond crypto-Twitter.
 *
 * Four instruments, class-aware:
 *   Brain narratives   — Spectre Brain's building/fading narratives touching
 *                        this asset (falls back to the top market narratives
 *                        for majors), each with stance tone.
 *   Catalysts ahead    — Brain catalysts (asset-tagged, dated) merged with
 *                        upcoming high-impact / Fed / crypto calendar events.
 *   Policy & macro tape— Trump / Fed / SEC / tariff / ETF headlines that move
 *                        the whole market. Majors only: for onchain small caps
 *                        the panel says so honestly and sticks to token news.
 *   Brain risk flags   — asset-tagged risks with severity.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import useNarrativeRadar from '../data/useNarrativeRadar'
import './rz-sentiment-engine.css'

function relTime(ts) {
  if (!ts) return null
  const diff = Date.now() - ts
  const mins = Math.round(Math.abs(diff) / 60000)
  const fmt = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`
  return diff >= 0 ? `${fmt} ago` : `in ${fmt}`
}

function eventTime(t) {
  const d = new Date(t)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// Case-insensitive lookups - upstream LLM output sometimes capitalizes
// ("Bullish"/"HIGH"), which would silently fall through to the warn tone.
const NARRATIVE_TONE_MAP = { bullish: 'bull', bearish: 'bear', neutral: 'neutral', mixed: 'warn' }
const SEVERITY_TONE_MAP = { high: 'bear', medium: 'warn', low: 'neutral' }
const narrativeTone = (s) => NARRATIVE_TONE_MAP[String(s || '').toLowerCase()]
const severityTone = (s) => SEVERITY_TONE_MAP[String(s || '').toLowerCase()]

const RzNarrativeRadar = React.memo(function RzNarrativeRadar({ sym, tokenClass, dayMode }) {
  const { t } = useTranslation()
  // tokenClass may be the class key (legacy) or the full {key, isMeme} object.
  const classKey = typeof tokenClass === 'string' ? tokenClass : (tokenClass?.key || 'mid')
  const isMeme = typeof tokenClass === 'object' ? !!tokenClass?.isMeme : false
  // Memecoins trade on their own attention/meme, NOT the ETH/DeFi/Fed tape — mute
  // the macro layer for them at ANY size. Only BTC/ETH/top-10 majors ARE the
  // macro tape, so only they get the market-wide narrative fallback + verdict.
  const isSmallCap = classKey === 'micro' || classKey === 'nano' || isMeme
  const isMajor = classKey === 'btc' || classKey === 'major'
  const { brain, tokenNews, policyNews, events, loading } = useNarrativeRadar(sym, {
    includeMacroTape: !isSmallCap,
    marketFallback: isMajor,
  })

  if (loading && !brain && !tokenNews.length && !policyNews.length) {
    return (
      <div className={`rz-sen-nr ${dayMode ? 'rz-sen--day' : ''}`}>
        <div className="rz-sen-shimmer-block animate-shimmer" style={{ height: 15, width: '55%' }} />
        <div className="rz-sen-grid" style={{ marginTop: 10 }}>
          {[0, 1, 2].map((i) => <div key={i} className="rz-sen-shimmer-block animate-shimmer" style={{ height: 130 }} />)}
        </div>
      </div>
    )
  }

  const hasAnything = brain?.narratives?.length || brain?.risks?.length || brain?.catalysts?.length
    || tokenNews.length || policyNews.length || events.length
  if (!hasAnything) {
    return (
      <div className={`rz-sen-nr ${dayMode ? 'rz-sen--day' : ''}`}>
        <div className="rz-sen-ai-empty">No live narratives or catalysts on the radar for ${sym} right now.</div>
      </div>
    )
  }

  const catalystItems = [
    ...(brain?.catalysts || []).map((c) => ({
      key: `b-${c.event}`,
      when: c.date || null,
      whenTs: null,
      label: c.event,
      sub: Array.isArray(c.assets) ? c.assets.map((a) => `$${a}`).join(' ') : null,
      kind: 'brain',
    })),
    ...events.map((e) => ({
      key: `e-${e.id}`,
      when: eventTime(e.t),
      whenTs: e.t,
      label: e.name,
      sub: [e.country, e.isFed ? 'Fed' : null, e.impact === 'high' ? 'high impact' : null].filter(Boolean).join(' · '),
      kind: 'calendar',
    })),
  ]

  return (
    <div className={`rz-sen-nr ${dayMode ? 'rz-sen--day' : ''}`}>
      {brain?.verdict && isMajor && (
        <p className="rz-sen-ctx-read">
          {brain.verdict}
          {brain.updatedAt && (
            <span className="rz-sen-nr-stamp mono"> · brain read {relTime(new Date(brain.updatedAt).getTime())}</span>
          )}
        </p>
      )}

      <div className="rz-sen-grid">
        {/* Brain narratives */}
        {brain?.narratives?.length > 0 && (
          <div className="rz-sen-card">
            <span className="rz-sen-card-title">
              Brain Narratives{brain.narrativesScope === 'market' ? ' · Market-Wide' : ''}
            </span>
            <div className="rz-sen-card-rows" style={{ gap: 10 }}>
              {brain.narratives.map((n) => (
                <div key={n.name} className="rz-sen-nr-item">
                  <div className="rz-sen-nr-item-head">
                    <span className="rz-sen-nr-item-title">{n.name}</span>
                    <span className={`rz-sen-chip ${n.status === 'building' ? 'rz-sen-chip--bull' : n.status === 'fading' ? 'rz-sen-chip--warn' : ''}`}>
                      {n.status}
                    </span>
                    {n.sentiment && (
                      <span className={`rz-sen-chip rz-sen-chip--${narrativeTone(n.sentiment) === 'bull' ? 'bull' : narrativeTone(n.sentiment) === 'bear' ? 'bear' : 'warn'}`}>
                        {n.sentiment}
                      </span>
                    )}
                  </div>
                  {n.summary && <p className="rz-sen-card-body">{n.summary}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Catalysts ahead */}
        {catalystItems.length > 0 && (
          <div className="rz-sen-card">
            <span className="rz-sen-card-title">{t('researchPro.narrativeRadar.rznarrativeradar.catalystsAhead', "Catalysts Ahead")}</span>
            <div className="rz-sen-card-rows" style={{ gap: 9 }}>
              {catalystItems.slice(0, 6).map((c) => (
                <div key={c.key} className="rz-sen-nr-cat">
                  <span className={`rz-sen-nr-cat-dot ${c.kind}`} />
                  <div className="rz-sen-nr-cat-body">
                    <span className="rz-sen-nr-item-title">{c.label}</span>
                    <span className="rz-sen-nr-meta">
                      {c.when}{c.sub ? ` · ${c.sub}` : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Risk flags */}
        {brain?.risks?.length > 0 && (
          <div className="rz-sen-card">
            <span className="rz-sen-card-title">{t('researchPro.narrativeRadar.rznarrativeradar.brainRiskFlags', "Brain Risk Flags")}</span>
            <div className="rz-sen-card-rows" style={{ gap: 9 }}>
              {brain.risks.map((r) => (
                <div key={r.title} className="rz-sen-nr-item">
                  <div className="rz-sen-nr-item-head">
                    <span className="rz-sen-nr-item-title">{r.title}</span>
                    <span className={`rz-sen-chip rz-sen-chip--${severityTone(r.severity) === 'bear' ? 'bear' : severityTone(r.severity) === 'warn' ? 'warn' : ''}`.trim()}>
                      {r.severity}
                    </span>
                  </div>
                  {r.probability && <span className="rz-sen-nr-meta">probability {r.probability}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Token headlines */}
        {tokenNews.length > 0 && (
          <div className="rz-sen-card">
            <span className="rz-sen-card-title">${sym} Headlines</span>
            <div className="rz-sen-card-rows" style={{ gap: 9 }}>
              {tokenNews.map((h) => (
                <a key={h.id} className="rz-sen-nr-news" href={h.url || undefined} target="_blank" rel="noopener noreferrer">
                  <span className="rz-sen-nr-news-title">{h.title}</span>
                  <span className="rz-sen-nr-meta">
                    {h.source}{h.ts ? ` · ${relTime(h.ts)}` : ''}{h.category ? ` · ${h.category}` : ''}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Policy & macro tape — majors only */}
        {!isSmallCap && policyNews.length > 0 && (
          <div className="rz-sen-card">
            <span className="rz-sen-card-title">Policy &amp; Macro Tape</span>
            <div className="rz-sen-card-rows" style={{ gap: 9 }}>
              {policyNews.map((h) => (
                <a key={h.id} className="rz-sen-nr-news" href={h.url || undefined} target="_blank" rel="noopener noreferrer">
                  <span className="rz-sen-nr-news-title">{h.title}</span>
                  <span className="rz-sen-nr-meta">
                    {h.source}{h.ts ? ` · ${relTime(h.ts)}` : ''}{h.category ? ` · ${h.category}` : ''}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {isSmallCap && (
        <span className="rz-sen-chart-note">
          {isMeme
            ? `The Fed/ETF/DeFi macro tape doesn't drive a memecoin — $${sym} trades on its own attention and meme flow. Token-specific news and Brain reads only.`
            : 'Policy and macro headlines are muted for a token this size — attention flow and liquidity drive it. Token-specific news and Brain reads only.'}
        </span>
      )}
    </div>
  )
})

export default RzNarrativeRadar
