/**
 * Localized relative-time helper for the economic-calendar page.
 *
 * Usage:
 *   import { formatTimeAgo } from '../utils/relativeTime'
 *   const { t } = useTranslation()
 *   formatTimeAgo(isoString, t)  // -> "5 м назад" / "5m ago" / "5 perc"
 *
 * Translations live under `economicCalendar.timeAgo.*` in the locale JSONs.
 */

export function formatTimeAgo(isoStr, t) {
  if (!isoStr) return ''
  const time = new Date(isoStr).getTime()
  if (!Number.isFinite(time)) return ''
  const ms = Date.now() - time
  if (ms < 60_000) {
    return t('economicCalendar.timeAgo.justNow', 'just now')
  }
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000)
    return t('economicCalendar.timeAgo.minutes', '{{count}}m ago', { count: minutes })
  }
  if (ms < 86_400_000) {
    const hours = Math.floor(ms / 3_600_000)
    return t('economicCalendar.timeAgo.hours', '{{count}}h ago', { count: hours })
  }
  const days = Math.floor(ms / 86_400_000)
  return t('economicCalendar.timeAgo.days', '{{count}}d ago', { count: days })
}
