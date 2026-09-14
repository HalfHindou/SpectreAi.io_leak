/**
 * XDashUpdatingNotice — what a landing-page X Dash panel shows when the feed
 * cannot answer the question the panel is asking.
 *
 * The case this exists for is NOT a failed request. The upstream answers 200,
 * the ribbon counts populate, and the board comes back empty because the window
 * asked for was never materialised (see lib/xdash-health.js). Rendered as an
 * ordinary empty state that reads as "nothing is happening in crypto right
 * now", which is a lie the panel has no business telling.
 *
 * Polls `onRetry` while mounted so the panel heals itself when the rebuild
 * lands — idle and hidden tabs skip the tick, since an outage is exactly when
 * hammering the upstream helps least.
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppActive } from '@/lib/idleManager'
import { timeframeLabel, xdashUpdatingCopy } from '@/lib/xdash-health'
import './xdash-updating-notice.css'

export default function XDashUpdatingNotice({
  health,
  onRetry,
  retryMs = 30000,
  flush = false,
  onOpenLive,
}) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!onRetry) return undefined
    const id = window.setInterval(() => {
      if (document.hidden || !isAppActive()) return
      onRetry()
    }, retryMs)
    return () => window.clearInterval(id)
  }, [onRetry, retryMs])

  const live = health?.liveTimeframe || null

  return (
    <div className={`xdun${flush ? ' xdun--flush' : ''}`} role="status" aria-live="polite">
      <div className="xdun__beacon" aria-hidden="true">
        <span className="xdun__dot" />
      </div>
      <div className="xdun__title">{t('xDash.bits.updating.title', 'X Dash is updating')}</div>
      <div className="xdun__detail">{xdashUpdatingCopy(health, t)}</div>
      <div className="xdun__bars" aria-hidden="true">
        <div className="xdun__bar" />
        <div className="xdun__bar" />
        <div className="xdun__bar" />
      </div>
      {(onOpenLive && live) || onRetry ? (
        <div className="xdun__action">
          {onOpenLive && live && (
            <button type="button" className="xdun__btn" onClick={() => onOpenLive(live)}>
              {t('xDash.updating.openLive', { defaultValue: 'Open {{tf}}', tf: timeframeLabel(live) })}
            </button>
          )}
          {onRetry && (
            <button type="button" className="xdun__btn" onClick={() => onRetry()}>
              {t('xDash.bits.updating.retry', 'Refresh now')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
