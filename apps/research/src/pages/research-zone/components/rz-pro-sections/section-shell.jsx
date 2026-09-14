/**
 * SectionShell — Welcome-page language section wrapper for Research Zone Pro tabs.
 *
 * Replaces TabSection/TabHeader. Matches the cab-terminal / aim visual language
 * from apps/research/src/pages/home/components/brief-tab.css and ai-market-panel.css.
 *
 * API:
 *   <SectionShell
 *     id="intel-analysis"                  // collapsible state key (localStorage)
 *     label="OVERVIEW · AI ANALYSIS"       // eyebrow label (uppercase)
 *     title="AI Analysis"                  // optional big title under eyebrow
 *     subtitle="Cross-signal synthesis"    // optional subtitle
 *     liveBadge aiBadge newBadge           // optional chips (green/white/amber)
 *     timestamp={new Date()}               // optional mono timestamp
 *     rightSlot={<TrendBadge/>}            // optional custom right content
 *     collapsible                          // enable collapse UX (default open)
 *     defaultOpen={false}                  // override default open state
 *     hero                                 // taller padding for flagship sections
 *     tight                                // reduced inner padding
 *   >
 *     {children}
 *   </SectionShell>
 */
import React, { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import './section-shell.css'

// ── Persisted collapse state ────────────────────────────────────────────────

const STORAGE_KEY = 'rz-collapsed-sections'

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {} }
  catch { return {} }
}

export function useCollapsibleState(id, defaultOpen = true) {
  const [isOpen, setIsOpen] = useState(() => {
    if (!id) return defaultOpen
    const stored = readStore()
    return stored[id] !== undefined ? stored[id] : defaultOpen
  })
  const toggle = useCallback(() => {
    setIsOpen(prev => {
      const next = !prev
      if (id) {
        const stored = readStore()
        stored[id] = next
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)) } catch {}
      }
      return next
    })
  }, [id])
  return { isOpen, toggle }
}

// ── Chevron ─────────────────────────────────────────────────────────────────

const Chevron = ({ open }) => (
  <svg
    className={`rzss-chev ${open ? '' : 'rzss-chev--closed'}`}
    width="12" height="12" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
)

// ── Timestamp formatter ─────────────────────────────────────────────────────

function fmtTime(ts) {
  if (!ts) return ''
  const d = ts instanceof Date ? ts : new Date(ts)
  if (isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

// ── Badges ──────────────────────────────────────────────────────────────────

const Badge = React.memo(({ kind, children }) => (
  <span className={`rzss-badge rzss-badge--${kind}`}>{children}</span>
))
Badge.displayName = 'SectionShell.Badge'

// ── SectionShell ────────────────────────────────────────────────────────────

const SectionShell = React.memo(function SectionShell({
  id,
  label,
  title,
  subtitle,
  liveBadge = false,
  aiBadge = false,
  newBadge = false,
  timestamp,
  rightSlot,
  collapsible = false,
  defaultOpen = true,
  hero = false,
  tight = false,
  className = '',
  children,
}) {
  const { t } = useTranslation()
  const { isOpen, toggle } = useCollapsibleState(collapsible ? id : null, defaultOpen)

  const time = useMemo(() => fmtTime(timestamp), [timestamp])

  const handleHeaderKey = useCallback((e) => {
    if (!collapsible) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() }
  }, [collapsible, toggle])

  const hasEyebrow = label || liveBadge || aiBadge || newBadge || timestamp || rightSlot || collapsible

  const shellClasses = [
    'rzss',
    hero ? 'rzss--hero' : '',
    tight ? 'rzss--tight' : '',
    collapsible && !isOpen ? 'rzss--closed' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <section className={shellClasses} data-section-id={id || undefined}>
      <span className="rzss-hairline" aria-hidden="true" />

      {hasEyebrow && (
        <header
          className={`rzss-eyebrow ${collapsible ? 'rzss-eyebrow--clickable' : ''}`}
          onClick={collapsible ? toggle : undefined}
          onKeyDown={handleHeaderKey}
          role={collapsible ? 'button' : undefined}
          tabIndex={collapsible ? 0 : undefined}
          aria-expanded={collapsible ? isOpen : undefined}
        >
          <div className="rzss-eyebrow-left">
            {label && (
              <>
                <span className="rzss-pulse" />
                <span className="rzss-label">{label}</span>
              </>
            )}
          </div>

          <div className="rzss-eyebrow-right">
            {liveBadge && <Badge kind="live">{t('researchPro.sectionShell.sectionshell.live', "LIVE")}</Badge>}
            {aiBadge && <Badge kind="ai">{t('researchPro.sectionShell.sectionshell.ai', "AI")}</Badge>}
            {newBadge && <Badge kind="new">{t('researchPro.sectionShell.sectionshell.new', "NEW")}</Badge>}
            {rightSlot}
            {time && <span className="rzss-timestamp">{time}</span>}
            {collapsible && <Chevron open={isOpen} />}
          </div>
        </header>
      )}

      {(title || subtitle) && (
        <div className="rzss-heading">
          {title && <h2 className="rzss-title">{title}</h2>}
          {subtitle && <p className="rzss-subtitle">{subtitle}</p>}
        </div>
      )}

      <div
        className={`rzss-body ${collapsible && !isOpen ? 'rzss-body--closed' : ''}`}
        aria-hidden={collapsible ? !isOpen : undefined}
      >
        <div className="rzss-body-inner">
          {children}
        </div>
      </div>
    </section>
  )
})

export default SectionShell
