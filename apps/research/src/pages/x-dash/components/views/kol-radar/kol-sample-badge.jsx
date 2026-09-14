/**
 * SAMPLE-DATA badge for the follow-graph surfaces.
 *
 * The follow graph (new follows, follow network, convergence) is SAMPLE data
 * until a real source is connected (twitterapi.io). Those "X followed $Y" events
 * are fabricated and must never be mistaken for real follows — so we mark every
 * follow surface clearly. Hidden only when a known-live provider is set.
 */
import { useTranslation } from 'react-i18next'
import './kol-sample-badge.css'

const LIVE_PROVIDERS = new Set(['twitterapiio', 'socialdata', 'tweetscout'])

export default function SampleFollowBadge({ provider, size = 'md', className = '' }) {
  const { t } = useTranslation()
  // safe default: anything that isn't a known live provider (incl. undefined) = sample
  if (provider && LIVE_PROVIDERS.has(provider)) return null
  return (
    <span
      className={`xd-kol-samplebadge xd-kol-samplebadge--${size} ${className}`}
      title={t(
        'kolRadar.sample.tip',
        'Sample follow data — these are NOT real follows yet. Connect a live source (twitterapi.io) to track real follows.'
      )}
    >
      <span className="xd-kol-samplebadge__dot" aria-hidden="true" />
      {t('kolRadar.sample.label', 'Sample data')}
    </span>
  )
}
