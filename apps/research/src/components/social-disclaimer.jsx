/*
 * SocialDisclaimer - a slim, non-invasive risk / NFA footer.
 *
 * Collapsed: a single muted line with a shield glyph. Click "Risk notice" (or
 * the row) to expand the full not-financial-advice + security wording. Used on
 * the social surfaces (X Dash, X Intelligence) and Potential Gainers.
 *
 * Copy is centralised here so every surface uses the same approved wording. An
 * optional `note` prop appends a surface-specific line inside the expanded
 * panel (e.g. Potential Gainers' historical-exit-model note).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import './social-disclaimer.css'

function ShieldGlyph() {
  return (
    <svg className="sdisc__glyph" width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  )
}

export default function SocialDisclaimer({ note, className = '' }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const summary = t(
    'disclaimer.summary',
    'Educational market data, not financial advice. Crypto is high-risk.',
  )
  const body = t(
    'disclaimer.body',
    'Spectre surfaces social attention, on-chain activity and market data for research and education only. Nothing here is financial, investment, legal or tax advice, or a recommendation to buy or sell any asset. Crypto is extremely volatile and high-risk - you can lose your entire position. Signals, scores and AI reads can be wrong, delayed or manipulated, and social hype is not value. Spectre never takes custody of your funds and never trades for you - always verify contract addresses yourself, protect your keys, and do your own research. Only risk what you can afford to lose.',
  )

  return (
    <footer className={`sdisc${open ? ' sdisc--open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="sdisc__row"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ShieldGlyph />
        <span className="sdisc__summary">{summary}</span>
        <span className="sdisc__toggle">
          {open ? t('disclaimer.less', 'Hide') : t('disclaimer.more', 'Risk notice')}
          <span className={`sdisc__chev${open ? ' sdisc__chev--up' : ''}`} aria-hidden="true">›</span>
        </span>
      </button>
      {open && (
        <div className="sdisc__panel">
          <p className="sdisc__text">{body}</p>
          {note && <p className="sdisc__note">{note}</p>}
        </div>
      )}
    </footer>
  )
}
