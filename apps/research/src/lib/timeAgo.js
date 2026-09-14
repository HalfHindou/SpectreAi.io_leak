/**
 * timeAgo - i18n-aware "X ago" formatter
 *
 * Replaces the duplicated "Xs/m/h/d ago" pattern across the codebase.
 * Caller passes the i18next `t` function so this stays a pure JS module
 * (no React/hook dependency at the base layer).
 *
 * Usage (non-React):
 *   import { timeAgo } from '@/lib/timeAgo'
 *   timeAgo(article.publishedAt, t)        // "5m ago"
 *
 * Usage (React):
 *   import { useTimeAgo } from '@/lib/timeAgo'
 *   const fmtAgo = useTimeAgo()
 *   fmtAgo(article.publishedAt)            // "5m ago"
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/**
 * Normalize a date-like input into a millisecond timestamp.
 * Returns NaN if the input cannot be parsed.
 */
function toMs(input) {
  if (input == null) return NaN
  if (input instanceof Date) return input.getTime()
  if (typeof input === 'number') return input < 1e12 ? input * 1000 : input
  if (typeof input === 'string') {
    const parsed = Date.parse(input)
    return Number.isNaN(parsed) ? NaN : parsed
  }
  return NaN
}

/**
 * Format an "X ago" string using i18next translations.
 *
 * @param {Date|number|string} date     - The past timestamp
 * @param {Function}            t       - i18next translation function
 * @param {Object}              [options]
 * @param {Date}                [options.now] - Reference "now" (defaults to current time)
 * @param {boolean}             [options.short=true] - Reserved for future long-form variant
 * @returns {string} Translated relative time string, e.g. "5m ago"
 */
export function timeAgo(date, t, options = {}) {
  if (typeof t !== 'function') {
    // Defensive fallback - returning empty string is safer than throwing in a render path
    return ''
  }

  const ms = toMs(date)
  if (Number.isNaN(ms)) return ''

  const now = options.now instanceof Date ? options.now.getTime() : Date.now()
  const diff = Math.max(0, now - ms)

  if (diff < 45 * SECOND) {
    return t('time.ago.justNow', 'just now')
  }
  if (diff < MINUTE) {
    const n = Math.max(1, Math.floor(diff / SECOND))
    return t('time.ago.seconds', '{{count}}s ago', { count: n })
  }
  if (diff < HOUR) {
    const n = Math.floor(diff / MINUTE)
    return t('time.ago.minutes', '{{count}}m ago', { count: n })
  }
  if (diff < DAY) {
    const n = Math.floor(diff / HOUR)
    return t('time.ago.hours', '{{count}}h ago', { count: n })
  }
  if (diff < WEEK) {
    const n = Math.floor(diff / DAY)
    return t('time.ago.days', '{{count}}d ago', { count: n })
  }
  if (diff < MONTH) {
    const n = Math.floor(diff / WEEK)
    return t('time.ago.weeks', '{{count}}w ago', { count: n })
  }
  if (diff < YEAR) {
    const n = Math.floor(diff / MONTH)
    return t('time.ago.months', '{{count}}mo ago', { count: n })
  }
  const n = Math.floor(diff / YEAR)
  return t('time.ago.years', '{{count}}y ago', { count: n })
}

/**
 * React hook variant - returns a stable formatter bound to the current i18n context.
 *
 * @returns {(date: Date|number|string, opts?: object) => string}
 */
export function useTimeAgo() {
  const { t } = useTranslation()
  return useCallback((date, opts) => timeAgo(date, t, opts), [t])
}

export default timeAgo
