/**
 * Band furniture — the rhythm every section on the page shares.
 *
 * WstBand   a <section> that reveals once on scroll.
 * WstHead   eyebrow left, as_of / n right (shared voice §9, matching the
 *           BrainSectionHead rhythm). Heads are INERT — nothing on this page
 *           collapses, so a head is never a button.
 * WstNone   the honest-absence line. A band whose data is missing still
 *           renders its head and then one sentence naming what is absent.
 *           Sections never vanish.
 * WstFoot   the permanent provenance caption: source and lag, always visible.
 */
import React from 'react'
import useInView from './use-in-view'

export function WstBand({ id, label, changed, children, className = '' }) {
  const { ref, inView } = useInView()
  return (
    <section
      id={id}
      ref={ref}
      aria-label={label}
      data-changed={changed ? 'true' : undefined}
      className={`wst-band${inView ? ' is-in' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </section>
  )
}

export function WstHead({ eyebrow, meta, sub, control, changed }) {
  return (
    <header className="wst-hd">
      <div className="wst-hd-l">
        <div className="wst-hd-eb">
          <span className="wst-eyebrow">{eyebrow}</span>
          {/* 30s mark on a band whose data actually differs this edition. Not
              a live indicator — it expires and never returns on its own. */}
          {changed && <span className="wst-mark" title="changed in this edition" />}
        </div>
        {sub && <span className="wst-hd-sub">{sub}</span>}
      </div>
      <div className="wst-hd-r">
        {control}
        {meta && <span className="wst-hd-meta wst-num">{meta}</span>}
      </div>
    </header>
  )
}

export function WstNone({ children }) {
  return <p className="wst-none">{children}</p>
}

export function WstFoot({ children }) {
  return <p className="wst-foot">{children}</p>
}
