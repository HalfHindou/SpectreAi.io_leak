/**
 * YouTemplates — slide-over template picker.
 *
 * Six archetypal dashboards from /apps/research/src/registry/templates.js.
 * Each card shows: name, tagline, 16:9 preview area (gradient placeholder
 * if image not yet built), tier badge, Apply button.
 *
 * Apply flow:
 *   1. Confirm if the user has unsaved changes (current dashboard non-empty)
 *   2. Replace dashboard layout with the template's layout
 *   3. Fire TEMPLATE_APPLIED event
 *   4. Show toast: "Applied {template_name}. You can customize anything."
 *
 * Open triggers (wired upstream in apps/research/src/pages/you/index.jsx):
 *   - YouEmptyState "Start from a template" CTA
 *   - YouHeader template button
 */

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { TEMPLATES } from '@/registry'
import { useYouTracking } from '@/hooks/useYouTracking'
import YouTemplatePreview from './YouTemplatePreview'
import './YouTemplates.css'

const TIER_LABEL = {
  0: 'Free',
  500: '500 $SPECTRE',
  1000: '1,000 $SPECTRE',
  7000: '7,000 $SPECTRE',
}

export default function YouTemplates({ open, onClose, onApply, hasExistingLayout, dashboardId }) {
  const { track, EVENT_TYPES } = useYouTracking()
  const [confirming, setConfirming] = useState(null) // template id pending confirm
  const [toast, setToast] = useState(null)

  // Fire TEMPLATE_VIEWED on open + reset internal state on close
  useEffect(() => {
    if (open) {
      track(EVENT_TYPES.TEMPLATE_VIEWED, { dashboard_id: dashboardId })
    } else {
      setConfirming(null)
    }
  }, [open, track, EVENT_TYPES, dashboardId])

  useEffect(() => {
    if (!open) return undefined
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(t)
  }, [toast])

  const applyTemplate = useCallback((template) => {
    onApply(template)
    track(EVENT_TYPES.TEMPLATE_APPLIED, {
      template_id: template.id,
      dashboard_id: dashboardId,
      payload: { archetype: template.archetype },
    })
    setToast(`Applied ${template.name}. You can customize anything.`)
    setConfirming(null)
    onClose()
  }, [onApply, track, EVENT_TYPES, dashboardId, onClose])

  const handleApplyClick = useCallback((template) => {
    if (hasExistingLayout) {
      setConfirming(template.id)
      return
    }
    applyTemplate(template)
  }, [hasExistingLayout, applyTemplate])

  if (!open && !toast) return null

  const dialog = open ? (
    <div className="you-tpl-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="you-tpl-panel" role="dialog" aria-label="Choose a template">
        <div className="you-tpl-header">
          <div>
            <div className="you-tpl-eyebrow">Templates</div>
            <h2 className="you-tpl-title">Pick a starting point.</h2>
            <p className="you-tpl-subtitle">Each one is a complete dashboard. Customize anything after.</p>
          </div>
          <button className="you-tpl-close" onClick={onClose} title="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" />
              <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
            </svg>
          </button>
        </div>

        <div className="you-tpl-grid">
          {TEMPLATES.map((tpl) => (
            <article key={tpl.id} className={`you-tpl-card you-tpl-card--${tpl.archetype}`}>
              <div className="you-tpl-preview" aria-hidden="true">
                <YouTemplatePreview archetype={tpl.archetype} />
              </div>
              <div className="you-tpl-meta">
                <div className="you-tpl-eyebrow-row">
                  <span className="you-tpl-archetype">{tpl.archetype}</span>
                  <span className="you-tpl-tier">{TIER_LABEL[tpl.tier_min] ?? `${tpl.tier_min} $SPECTRE`}</span>
                </div>
                <h3 className="you-tpl-name">{tpl.name}</h3>
                <p className="you-tpl-tagline">{tpl.tagline}</p>
                <p className="you-tpl-desc">{tpl.description}</p>
                <div className="you-tpl-foot">
                  <span className="you-tpl-count">{tpl.layout.length} widgets</span>
                  {confirming === tpl.id ? (
                    <div className="you-tpl-confirm">
                      <span>Replace current dashboard?</span>
                      <button className="you-tpl-btn-secondary" onClick={() => setConfirming(null)}>Cancel</button>
                      <button className="you-tpl-btn-primary" onClick={() => applyTemplate(tpl)}>Replace</button>
                    </div>
                  ) : (
                    <button className="you-tpl-btn-primary" onClick={() => handleApplyClick(tpl)}>Apply</button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  ) : null

  return createPortal(
    <>
      {dialog}
      {toast && (
        <div className="you-tpl-toast" role="status">{toast}</div>
      )}
    </>,
    document.body,
  )
}
