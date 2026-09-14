/**
 * RZM Dossier Sheet — the full desktop DossierPanel surfaced on mobile as an
 * iOS-style bottom sheet.
 *
 * Mobile's Sentiment tab already shows RzProjectDossier (the "what IS this
 * project" fundamentals/narrative brief from /api/project-dossier). This sheet
 * adds the SEPARATE on-chain intel dossier the desktop right rail carries
 * (dossierApi.lookup): live candle chart + market KPIs, 24h buy/sell flows +
 * smart money, safety (honeypot/tax/LP/owner/mint/proxy), liquidity pools,
 * BubbleMaps holder clusters, holders & mindshare, scanner signals, Brain takes.
 *
 * DossierPanel self-fetches from chain+ca and collapses fluidly (flex-column
 * KPIs, fluid lightweight-charts hero, its own shimmer skeleton + day-mode CSS),
 * so it is REUSED verbatim inside a `.rzdp-wrap` mobile scope — no fork.
 */
import { Suspense, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import lazy from '@/lib/lazy-with-retry'
import { createPortal } from 'react-dom'
import './rzm-dossier-sheet.css'

const DossierPanel = lazy(() => import('@/components/dossier-panel'))

function DossierSheetSkeleton() {
  return (
    <div className="rzdp-skel" aria-hidden>
      <div className="rzdp-skel-shimmer rzdp-skel-chart" />
      <div className="rzdp-skel-kpis">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rzdp-skel-kpi" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="rzdp-skel-shimmer rzdp-skel-line rzdp-skel-line--label" />
            <div className="rzdp-skel-shimmer rzdp-skel-line rzdp-skel-line--val" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RzmDossierSheet({ open, onClose, sym, chain = 'asset', tokenName, dayMode }) {
  const { t } = useTranslation()
  // Scroll-lock the page body while the sheet is up (restore exactly on close).
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Close on hardware/Esc back.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const ca = (sym || '').toUpperCase()

  return createPortal(
    <div className={`rzdp-sheet-root${dayMode ? ' rzdp-day' : ''}`} role="dialog" aria-modal="true" aria-label={t('researchPro.mdossierSheet.rzmdossiersheet.ariaTokenDossier', "Token dossier")}>
      <div className="rzdp-backdrop" onClick={onClose} />
      <div className="rzdp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="rzdp-grab" onClick={onClose} />
        <header className="rzdp-sheet-head">
          <div className="rzdp-sheet-titles">
            <span className="rzdp-sheet-title">{t('researchPro.mdossierSheet.rzmdossiersheet.dossier', "Dossier")}</span>
            <span className="rzdp-sheet-sub">{tokenName || ca}</span>
          </div>
          <button type="button" className="rzdp-close" onClick={onClose} aria-label={t('researchPro.mdossierSheet.rzmdossiersheet.ariaCloseDossier', "Close dossier")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        <div className="rzdp-sheet-body">
          <div className="rzdp-wrap">
            <Suspense fallback={<DossierSheetSkeleton />}>
              <DossierPanel chain={chain} ca={ca} pollMs={0} />
            </Suspense>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
