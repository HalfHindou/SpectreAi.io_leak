import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sanitizeAiText } from '@/lib/sanitizeAiText'

// A different reading layout for the local comparison. Payload and ordering
// are unchanged. Bar lengths encode token counts, never inferred conviction.
export default function XDRefinedBrief({ headline, html, sectors = [] }) {
  const { t, i18n } = useTranslation()
  const [readOpen, setReadOpen] = useState(false)
  const readId = useId()
  const visibleSectors = sectors.filter((s) => s?.sector).slice(0, 4)
  const counts = visibleSectors.map((s) => s.token_count == null ? null : Number(s.token_count))
  const maxCount = Math.max(1, ...counts.filter((n) => Number.isFinite(n) && n >= 0))
  return (
    <div className={`xd-refined-brief${visibleSectors.length ? '' : ' xd-refined-brief--solo'}`}>
      <div className="xd-refined-brief__story">
        {headline && <h3 className="xd-refined-brief__headline">{headline}</h3>}
        {html && <>
          <div id={readId} className={`xd-refined-brief__copy${readOpen ? ' is-open' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
          <button type="button" className="xd-refined-brief__read" aria-expanded={readOpen} aria-controls={readId} onClick={() => setReadOpen((v) => !v)}>
            {readOpen ? t('xDash.refined.less', 'Show less') : t('xDash.refined.read', 'Read the briefing')}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ transform: readOpen ? 'rotate(180deg)' : undefined }}><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </>}
      </div>
      {visibleSectors.length > 0 && <aside className="xd-refined-brief__sectors" aria-label={t('xDash.refined.sectors', 'Sectors in this read')}>
        <div className="xd-refined-brief__sector-heading"><span>{t('xDash.refined.sectors', 'Sectors in this read')}</span><span>{t('xDash.refined.tokens', 'Tokens')}</span></div>
        {visibleSectors.map((sector, i) => {
          const count = counts[i]
          const valid = Number.isFinite(count) && count >= 0
          return <div className="xd-refined-brief__sector" key={`${sector.sector}-${i}`}>
            <div className="xd-refined-brief__sector-label"><span>{sanitizeAiText(String(sector.sector))}</span><b>{valid ? count.toLocaleString(i18n.language) : '—'}</b></div>
            {valid && <div className="xd-refined-brief__track" aria-hidden="true"><span style={{ width: `${100 * count / maxCount}%` }} /></div>}
          </div>
        })}
      </aside>}
    </div>
  )
}
