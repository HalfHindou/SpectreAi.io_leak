/**
 * DeltaChip — short signal-value chip used wherever a small `%` renders.
 *
 * Why this exists: small percentages (`+0.00%`, `-6.14%`, `+1.45%`) used
 * to render in Geist Mono via `var(--font-mono)`. Geist Mono's slashed
 * zero turns a string like `+0.00%` into a wall of crossed circles that
 * fights legibility at chip sizes. This component centralises the fix:
 *   - Geist sans via `var(--font-num-chip)`
 *   - `tabular-nums` so digits + `+`/`-` keep consistent widths (no jiggle
 *     on tick updates)
 *   - `font-feature-settings: 'zero' 0` to disable the slashed zero where
 *     the font supports the alternate
 *   - explicit `+` prefix for positive values so direction reads instantly
 *
 * Geist Mono STAYS in use for column-aligned prices, addresses, wallet
 * hashes, full data tables. This component is ONLY for short delta chips.
 *
 * Usage:
 *   <DeltaChip value={1.45} />              // → "+1.45%" in --bull
 *   <DeltaChip value={-6.14} />             // → "-6.14%" in --bear
 *   <DeltaChip value={0} />                 // → "+0.00%" in --text-3
 *   <DeltaChip value={null} />              // → "—"
 *   <DeltaChip value={42.1} format="plain" sign={false} />  // → "42.10"
 *   <DeltaChip value={3.2} tone="accent" /> // → "+3.20%" in --accent-bright
 *
 * Props:
 *   value      number | null      raw delta (e.g. -6.14 for -6.14%)
 *   format     'pct' | 'plain'    default 'pct' — appends '%' when 'pct'
 *   sign       boolean            default true — prepends '+' on positives
 *   tone       'auto' | 'bull' | 'bear' | 'flat' | 'accent'
 *                                 default 'auto' (sign-driven)
 *   size       'sm' | 'md'        default 'sm' (chips) — 'md' for header delta
 *   decimals   number             default 2
 *   className  string             passthrough
 */

import './DeltaChip.css'

export default function DeltaChip({
  value,
  format = 'pct',
  sign = true,
  tone = 'auto',
  size = 'sm',
  decimals = 2,
  className = '',
}) {
  // Null / NaN guard — render a clean em-dash instead of "NaN%"
  if (value == null || (typeof value === 'number' && Number.isNaN(value))) {
    return (
      <span className={`delta-chip delta-chip--flat delta-chip--${size} ${className}`.trim()}>—</span>
    )
  }
  const v = Number(value)
  const resolvedTone = tone === 'auto'
    ? (v > 0 ? 'bull' : v < 0 ? 'bear' : 'flat')
    : tone
  const prefix = sign && v > 0 ? '+' : ''
  const body = format === 'pct'
    ? `${prefix}${v.toFixed(decimals)}%`
    : `${prefix}${v.toFixed(decimals)}`
  return (
    <span className={`delta-chip delta-chip--${resolvedTone} delta-chip--${size} ${className}`.trim()}>
      {body}
    </span>
  )
}
