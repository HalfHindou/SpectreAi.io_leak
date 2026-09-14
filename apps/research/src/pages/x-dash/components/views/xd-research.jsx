import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useHypeForensics } from '../use-hype-forensics'
import { formatNum } from '../x-dash-utils'
import '../xd-research.css'

/* X Dash → Research: Hype Forensics. Decompose a token's X attention into
   organic vs engineered, name the tactic, then (on demand) an LLM teardown. */

const SHOWCASE = [
  { symbol: 'ASTER', name: 'Aster' },
  { symbol: 'PUMP', name: 'Pump.fun' },
  { symbol: 'WLFI', name: 'World Liberty Financial' },
]

const VERDICT_LABEL = { engineered: 'Engineered', mixed: 'Mixed', organic: 'Organic' }

function ScoreRing({ score, verdict }) {
  const r = 46
  const c = 2 * Math.PI * r
  const off = c * (1 - (score || 0) / 100)
  return (
    <svg className={`xr-ring xr-ring--${verdict}`} width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r={r} className="xr-ring__track" />
      <circle cx="60" cy="60" r={r} className="xr-ring__fill" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 60 60)" />
      <text x="60" y="56" className="xr-ring__num">{score}</text>
      <text x="60" y="76" className="xr-ring__cap">/ 100</text>
    </svg>
  )
}

function SignalCard({ s }) {
  const sev = s.score >= 0.66 ? 'high' : s.score >= 0.4 ? 'mid' : 'low'
  return (
    <div className={`xr-sig xr-sig--${sev}`}>
      <div className="xr-sig__head">
        <span className="xr-sig__label">{s.label}</span>
        <span className="xr-sig__pct">{Math.round(s.score * 100)}</span>
      </div>
      <div className="xr-sig__bar"><span style={{ width: `${Math.round(s.score * 100)}%` }} /></div>
      <p className="xr-sig__detail">{s.detail}</p>
    </div>
  )
}

export default function XDResearch() {
  // `t` is taken by exemplars.map((t) => ...) below, so alias the hook.
  const { t: tr } = useTranslation()
  const { forensics, tweets, token, loading, error, analyze, retry, teardown, teardownState, runTeardown } = useHypeForensics()
  const [q, setQ] = useState('')

  const run = useCallback((t) => {
    const tok = t || { query: q.trim(), symbol: q.trim().replace(/^\$/, '') }
    if (!tok.query && !tok.symbol) return
    setQ(tok.symbol ? `$${tok.symbol}` : tok.query)
    analyze(tok)
  }, [q, analyze])

  // Auto-load Aster as the showcase on first mount.
  useEffect(() => { analyze(SHOWCASE[0]) /* eslint-disable-next-line */ }, [])

  const verdict = forensics?.verdict
  const exemplars = [...tweets].sort((a, b) => (b.views + b.likes * 50) - (a.views + a.likes * 50)).slice(0, 6)

  return (
    <div className="xr">
      <header className="xr-hero">
        <div className="xr-hero__title">
          <h2>{tr('xDash.research.title', 'Hype Forensics')}</h2>
          <span className="xr-hero__tag">{tr('xDash.research.tag', 'organic vs engineered')}</span>
        </div>
        <p className="xr-hero__sub">
          Is a token's attention real, or manufactured? Spectre reads its live X corpus and decomposes the hype —
          paste-the-brief campaigns, sock-account rings, reward-bait, bought impressions — into a manufactured score, with the receipts.
        </p>
        <form className="xr-search" onSubmit={(e) => { e.preventDefault(); run() }}>
          <input
            className="xr-search__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr('xDash.research.placeholder', 'Analyze a token - symbol or name (e.g. Aster)')}
            spellCheck={false}
          />
          <button type="submit" className="xr-search__go" disabled={loading}>{loading ? 'Reading X…' : 'Analyze'}</button>
        </form>
        <div className="xr-chips">
          {SHOWCASE.map((s) => (
            <button key={s.symbol} type="button" className="xr-chip" onClick={() => run(s)}>${s.symbol}</button>
          ))}
        </div>
      </header>

      {loading && <div className="xr-skel animate-shimmer" />}
      {!loading && error && (
        <div className="xr-msg">
          {error}
          <button type="button" className="xr-msg__retry" onClick={retry}>{tr('xDash.research.retry', 'Retry')}</button>
        </div>
      )}

      {!loading && forensics && forensics.score != null && (
        <>
          <section className="xr-verdict">
            <ScoreRing score={forensics.score} verdict={verdict} />
            <div className="xr-verdict__body">
              <div className="xr-verdict__line">
                <span className={`xr-badge xr-badge--${verdict}`}>{VERDICT_LABEL[verdict]}</span>
                <span className="xr-verdict__headline">
                  {forensics.score}% of {token?.symbol ? `$${token.symbol}` : 'this token'}'s attention looks manufactured
                </span>
              </div>
              <div className="xr-split" role="img" aria-label={tr('xDash.research.splitAria', '{{organic}}% organic, {{engineered}}% engineered', { organic: forensics.organicPct, engineered: forensics.score })}>
                <span className="xr-split__organic" style={{ width: `${forensics.organicPct}%` }}>{forensics.organicPct > 12 ? tr('xDash.research.pctOrganic', '{{pct}}% organic', { pct: forensics.organicPct }) : ''}</span>
                <span className="xr-split__eng" style={{ width: `${forensics.score}%` }}>{forensics.score > 12 ? tr('xDash.research.pctEngineered', '{{pct}}% engineered', { pct: forensics.score }) : ''}</span>
              </div>
              <div className="xr-meta">
                <span><b>{formatNum(forensics.sampleSize)}</b> {tr('xDash.research.posts', 'posts')}</span>
                <span><b>{formatNum(forensics.authors)}</b> {tr('xDash.research.authors', 'authors')}</span>
                <span><b>{formatNum(forensics.impressions)}</b> {tr('xDash.research.impressions', 'impressions')}</span>
                <span><b>{forensics.engagementRate != null ? (forensics.engagementRate * 100).toFixed(2) + '%' : '—'}</b> {tr('xDash.research.er', 'ER')}</span>
                <span className="xr-meta__conf">{tr('xDash.research.confidence', '{{level}} confidence', { level: forensics.confidence })}</span>
              </div>
              {forensics.tactics.length > 0 && (
                <div className="xr-tactics">
                  {forensics.tactics.map((tt) => <span key={tt} className="xr-tactic">{tt}</span>)}
                </div>
              )}
            </div>
          </section>

          <section className="xr-signals">
            {forensics.signals.map((s) => <SignalCard key={s.key} s={s} />)}
          </section>

          <section className="xr-teardown">
            <div className="xr-teardown__head">
              <span className="xr-teardown__label">{tr('xDash.research.teardownLabel', 'Spectre AI · forensic teardown')}</span>
              {teardownState !== 'streaming' && (
                <button type="button" className="xr-teardown__run" onClick={runTeardown}>
                  {teardownState === 'done' || teardownState === 'error' ? 'Re-run' : 'Run forensic analysis'}
                </button>
              )}
              {teardownState === 'streaming' && <span className="xr-teardown__live">{tr('xDash.research.analyzing', 'analyzing…')}</span>}
            </div>
            {teardown
              ? <p className="xr-teardown__body">{teardown}</p>
              : teardownState !== 'streaming' && <p className="xr-teardown__hint">{tr('xDash.research.teardownHint', "Run the LLM teardown to get the verdict in plain English - how they're engineering it, with the evidence quoted.")}</p>}
          </section>

          {exemplars.length > 0 && (
            <section className="xr-evidence">
              <span className="xr-evidence__label">{tr('xDash.research.loudest', 'Loudest posts in the sample')}</span>
              {exemplars.map((t) => {
                // no URL = plain card, never a dead '#' anchor
                const Tag = t.url ? 'a' : 'div'
                const linkProps = t.url ? { href: t.url, target: '_blank', rel: 'noopener noreferrer' } : {}
                return (
                  <Tag key={t.id} className="xr-ev" {...linkProps}>
                    <span className="xr-ev__top">
                      <span className="xr-ev__user">@{t.username}</span>
                      <span className="xr-ev__stats">{formatNum(t.followers)}f · {formatNum(t.views)}v · {formatNum(t.likes)}♥</span>
                    </span>
                    <span className="xr-ev__text">{t.text}</span>
                  </Tag>
                )
              })}
            </section>
          )}
        </>
      )}
    </div>
  )
}
