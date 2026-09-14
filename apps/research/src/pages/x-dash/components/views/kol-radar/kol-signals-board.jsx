/**
 * Smart Signals convergence board — the hero of KOL Radar.
 *
 * Each card is a ConvergenceSignal: stacked avatars of the KOLs who converged,
 * the project (real logo + symbol), a PRE-PUSH badge + lead-time, a score ring,
 * and a status pill (emerging / confirmed / hot). This is the alpha money shot:
 * "they followed it N hours before the first mention."
 *
 * Pure presentational — data + scope come from the parent (useKolSignals).
 */
import { useTranslation } from 'react-i18next'
import { Avatar, Shimmer, EmptyState, ErrorState } from '../../xd-bits'
import { formatNum, relativeTime } from '../../x-dash-utils'
import { tierMeta } from './kol-tier'

const STATUS_META = {
  hot: { key: 'kolRadar.status.hot', fallback: 'Hot', cls: 'xd-kol-status--hot' },
  confirmed: { key: 'kolRadar.status.confirmed', fallback: 'Confirmed', cls: 'xd-kol-status--confirmed' },
  emerging: { key: 'kolRadar.status.emerging', fallback: 'Emerging', cls: 'xd-kol-status--emerging' },
}

/* 0-100 score as a thin radial ring + the number, mirroring SignalScore's
   full variant but driven by the precomputed signal score (not a row fuse). */
function ScoreRing({ score }) {
  const pct = Math.max(0, Math.min(100, Number(score || 0)))
  const R = 20
  const C = 2 * Math.PI * R
  const dash = (pct / 100) * C
  const tone = pct >= 80 ? 'hot' : pct >= 60 ? 'warm' : 'cool'
  return (
    <div className={`xd-kol-ring xd-kol-ring--${tone}`}>
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
        <circle className="xd-kol-ring__track" cx="26" cy="26" r={R} fill="none" strokeWidth="3.5" />
        <circle
          className="xd-kol-ring__fill"
          cx="26" cy="26" r={R} fill="none" strokeWidth="3.5"
          strokeDasharray={`${dash} ${C}`}
          strokeLinecap="round"
          transform="rotate(-90 26 26)"
        />
      </svg>
      <span className="xd-kol-ring__num xd-num">{Math.round(pct)}</span>
    </div>
  )
}

function leadCopy(signal, t) {
  const hrs = signal.lead_time_hours
  if (hrs != null && Number(hrs) > 0) {
    const h = Math.round(Number(hrs))
    return t('kolRadar.signals.leadBefore', 'followed {{count}}h before first mention', { count: h })
  }
  if (signal.is_pre_push) {
    return t('kolRadar.signals.preMention', 'followed before any mention')
  }
  return null
}

/* A signal with several S/Tier-1 KOLs converging is "smart money" — the highest-
   conviction case. We surface the count + score and visually strengthen the card.
   The threshold is deliberately conservative (≥2 smart KOLs OR score ≥70) so the
   accent stays meaningful — server already sorts smart-money-first, so the loud
   cards naturally lead. */
function isSmartMoney(signal) {
  return Number(signal.smart_kol_count || 0) >= 2 || Number(signal.smart_money_score || 0) >= 70
}

function SignalCard({ signal, onOpenKol, onOpenProject }) {
  const { t } = useTranslation()
  const project = signal.project || signal.target || {}
  const sym = project.symbol ? `$${project.symbol}` : (project.name || signal.target?.screen_name || '—')
  const kols = Array.isArray(signal.kols) ? signal.kols : []
  const shown = kols.slice(0, 4)
  const extra = (signal.kol_count || kols.length) - shown.length
  const status = STATUS_META[String(signal.status || '').toLowerCase()] || STATUS_META.emerging
  const lead = leadCopy(signal, t)
  const logo = project.image || project.image_small || project.image_url

  const smartCount = Number(signal.smart_kol_count || 0)
  const smartScore = signal.smart_money_score != null ? Math.round(Number(signal.smart_money_score)) : null
  const smart = isSmartMoney(signal)

  const handleProject = () => {
    if (project.cg_id && onOpenProject) onOpenProject(project.cg_id)
  }

  return (
    <article className={`xd-kol-sigcard${signal.is_pre_push ? ' xd-kol-sigcard--prepush' : ''}${smart ? ' xd-kol-sigcard--smart' : ''}`}>
      <div className="xd-kol-sigcard__top">
        <button
          type="button"
          className="xd-kol-sigcard__project"
          onClick={handleProject}
          disabled={!project.cg_id}
          title={project.name || sym}
        >
          <Avatar src={logo} alt={project.symbol || project.name} size={34} />
          <span className="xd-kol-sigcard__project-text">
            <span className="xd-kol-sigcard__sym xd-num">{sym}</span>
            {project.name && <span className="xd-kol-sigcard__name">{project.name}</span>}
          </span>
        </button>
        <ScoreRing score={signal.score} />
      </div>

      <div className="xd-kol-sigcard__badges">
        <span className={`xd-kol-status ${status.cls}`}>{t(status.key, status.fallback)}</span>
        {signal.is_pre_push && (
          <span className="xd-kol-prepush" title={t('kolRadar.signals.prePushTip', 'These KOLs followed before the project started getting talked about')}>
            {t('kolRadar.signals.prePush', 'PRE-PUSH')}
          </span>
        )}
        {smart && (
          <span
            className="xd-kol-smart"
            title={t('kolRadar.signals.smartMoneyTip', 'Several S-Tier / Tier-1 KOLs are among those who converged — the highest-conviction case')}
          >
            <span className="xd-kol-smart__dot" aria-hidden="true" />
            {t('kolRadar.signals.smartMoney', 'Smart money')}
            {smartScore != null && <span className="xd-kol-smart__score xd-num">{smartScore}</span>}
          </span>
        )}
      </div>

      {lead && <p className="xd-kol-sigcard__lead">{lead}</p>}

      <div className="xd-kol-sigcard__kols">
        <span className="xd-kol-sigcard__stack">
          {shown.map((k, i) => {
            const tier = tierMeta(k.tier)
            return (
              <button
                type="button"
                key={k.screen_name || i}
                className={`xd-kol-sigcard__slot xd-kol-sigcard__slot--${tier.cls}`}
                style={{ zIndex: 10 - i }}
                onClick={() => onOpenKol && onOpenKol(k.screen_name)}
                title={`@${k.screen_name} · ${t(tier.key, tier.fallback)} · ${formatNum(k.followers_count)} ${t('kolRadar.followers', 'followers')}`}
              >
                <Avatar src={k.avatar_url} alt={k.screen_name} size={28} />
              </button>
            )
          })}
          {extra > 0 && <span className="xd-kol-sigcard__more xd-num">+{extra}</span>}
        </span>
        <span className="xd-kol-sigcard__kcount">
          <b className="xd-num">{signal.kol_count || kols.length}</b>{' '}
          {t('kolRadar.signals.kolsConverged', 'KOLs converged')}
          {smartCount > 0 && (
            <span className="xd-kol-sigcard__smartcount">
              <b className="xd-num">{smartCount}</b>{' '}
              {t('kolRadar.signals.smartOf', 'smart')}
            </span>
          )}
        </span>
      </div>

      <div className="xd-kol-sigcard__foot">
        <span className="xd-kol-sigcard__window">
          {t('kolRadar.signals.window', 'within {{count}}h', { count: signal.window_hours || 72 })}
        </span>
        <span className="xd-kol-sigcard__when">{relativeTime(signal.last_followed_at, t)}</span>
      </div>
    </article>
  )
}

export default function KolSignalsBoard({
  signals, loading, error, onRetry, scope, onOpenKol, onOpenProject, provider,
}) {
  const { t } = useTranslation()
  const list = Array.isArray(signals) ? signals : []
  // While the follow provider is still on sample data (no twitterapiio key set
  // in prod), flag the board as preview so users don't mistake it for live.
  const isPreview = provider === 'mock'

  return (
    <section className="xd-kol-signals">
      <header className="xd-kol-signals__head">
        <div className="xd-kol-signals__title-wrap">
          <div className="xd-kol-signals__title-row">
            <h2 className="xd-kol-signals__title">{t('kolRadar.signals.title', 'Smart Signals')}</h2>
            {isPreview && (
              <span
                className="xd-kol-previewchip"
                title={t('kolRadar.preview.tip', 'Sample follow data — live tracking activates once the data source is connected')}
              >
                <span className="xd-kol-previewchip__dot" aria-hidden="true" />
                {t('kolRadar.preview.label', 'Preview · sample data')}
              </span>
            )}
          </div>
          <p className="xd-kol-signals__sub">
            {t('kolRadar.signals.subtitle', 'Projects multiple tracked KOLs just started following — before the shill')}
          </p>
        </div>
      </header>

      {loading && list.length === 0 && (
        <div className="xd-kol-signals__grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div className="xd-kol-sigcard xd-kol-sigcard--loading" key={i}>
              <Shimmer variant="card" count={1} />
            </div>
          ))}
        </div>
      )}

      {error && list.length === 0 && <ErrorState message={error} onRetry={onRetry} />}

      {/* On mock these convergence cards are fabricated from sample follows — we
          do NOT present them as real. Show what the feature does + how to go live. */}
      {!loading && !error && isPreview && (
        <EmptyState
          title={t('kolRadar.signals.notLive.title', 'Smart Signals activate with live follow data')}
          detail={t('kolRadar.signals.notLive.detail', 'A signal fires when several tracked KOLs newly follow the same fresh project before they shill it. Connect the follow data source to go live — the KOL database, tiers and track records below are already real.')}
        />
      )}

      {!loading && !error && !isPreview && list.length === 0 && (
        <EmptyState
          title={scope === 'mine'
            ? t('kolRadar.signals.emptyMine.title', 'No convergence from your KOLs yet')
            : t('kolRadar.signals.empty.title', 'No convergence signals in this window')}
          detail={scope === 'mine'
            ? t('kolRadar.signals.emptyMine.detail', 'Follow more KOLs to widen the net — a signal fires when several of them pile into the same new project.')
            : t('kolRadar.signals.empty.detail', 'When several tracked KOLs newly follow the same project inside the window, it surfaces here.')}
        />
      )}

      {!isPreview && list.length > 0 && (
        <div className="xd-kol-signals__grid">
          {list.map((sig) => (
            <SignalCard
              key={sig.id}
              signal={sig}
              onOpenKol={onOpenKol}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      )}
    </section>
  )
}
