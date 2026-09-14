/**
 * RZ Project Dossier — the "what IS this project" fundamentals brief that
 * frames the sentiment read. Answers what the crowd read assumes: what the
 * project does, what it does for the space, and where it honestly sits.
 *
 * Data: /api/project-dossier — Spectre's own market/social feeds (description,
 * categories, market standing, TVL, official links) distilled by a low-cost LLM
 * into a structured read. Presented as Spectre's own intelligence; upstream
 * providers are never named. Deterministic facts always render, so the panel is
 * never empty even when the AI read is still generating or unavailable.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SpectreLoader from '@/components/spectre-loader'
import useProjectDossier from '@/hooks/useProjectDossier'
import { TwitterXIcon, GlobeIcon } from '../data/rz-icons.jsx'
import './rz-project-dossier.css'

/* Bold $amounts, %s and $TICKERs inside AI copy (shared XDThesis pattern) */
function boldenNumbers(text) {
  if (!text) return null
  const parts = String(text).split(/(\$[\d,.]+[BMKT]?|[+-]?\d+(?:\.\d+)?%|\$[A-Z]{2,10}\b|#\d+|\b\d+(?:\.\d+)?x\b)/g)
  return parts.map((part, i) =>
    /^(\$[\d,.]+[BMKT]?|[+-]?\d+(?:\.\d+)?%|\$[A-Z]{2,10}|#\d+|\d+(?:\.\d+)?x)$/.test(part)
      ? <strong key={i}>{part}</strong>
      : part
  )
}

const STAGE_META = {
  bluechip: { label: 'Blue Chip', cls: 'blue' },
  established: { label: 'Established', cls: 'blue' },
  emerging: { label: 'Emerging', cls: 'neutral' },
  early: { label: 'Early', cls: 'warn' },
  speculative: { label: 'Speculative', cls: 'warn' },
}

function fmtLaunched(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

// Reference / project-link chips — only the links that actually resolved.
const CGIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
)
const DocIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" />
  </svg>
)

const RzProjectDossier = React.memo(function RzProjectDossier({ sym, cgId, name, dayMode }) {
  const { t } = useTranslation()
  const { dossier, loading, error, refetch } = useProjectDossier(sym, cgId)

  const generatedAgo = useMemo(() => {
    if (!dossier?.generatedAt) return null
    const mins = Math.max(0, Math.round((Date.now() - new Date(dossier.generatedAt).getTime()) / 60000))
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
    return `${Math.floor(mins / 1440)}d ago`
  }, [dossier])

  if (loading && !dossier) {
    return (
      <div className={`rz-dos rz-dos--loading ${dayMode ? 'rz-dos--day' : ''}`}>
        <SpectreLoader variant="logo" size="md" label={t('researchPro.projectDossier.rzprojectdossier.label', "Building the dossier")} />
      </div>
    )
  }

  const facts = dossier?.facts
  if (!facts) {
    return (
      <div className={`rz-dos ${dayMode ? 'rz-dos--day' : ''}`}>
        <div className="rz-dos-empty">
          A dossier for ${sym} isn't available right now{error ? '' : ''} — the market and sentiment signals below still stand on their own.
        </div>
      </div>
    )
  }

  const read = dossier.read || null
  const stage = STAGE_META[facts.stage] || null
  const oneLiner = read?.one_liner || (facts.category ? `${facts.category}` : null)
  const body = read?.what_it_does || dossier.summary || null
  const links = facts.links || {}
  const launched = fmtLaunched(facts.launched)

  const factCells = [
    facts.category ? { k: 'Category', v: facts.category } : null,
    facts.rank != null ? { k: 'Rank', v: `#${facts.rank}`, mono: true } : null,
    facts.marketCapFmt ? { k: 'Market Cap', v: facts.marketCapFmt, mono: true } : null,
    facts.tvlFmt ? { k: 'TVL', v: facts.tvlFmt, mono: true } : null,
    facts.chain ? { k: 'Chain', v: facts.chain } : null,
    launched ? { k: 'Launched', v: launched, mono: true } : null,
  ].filter(Boolean)

  const sourceChips = [
    links.website ? { label: 'Website', url: links.website, icon: <GlobeIcon size={13} /> } : null,
    links.twitter ? { label: 'X', url: links.twitter, icon: <TwitterXIcon size={12} /> } : null,
    links.whitepaper ? { label: 'Docs', url: links.whitepaper, icon: <DocIcon /> } : null,
    facts.tvl != null && links.defillama ? { label: 'DefiLlama', url: links.defillama, icon: <CGIcon /> } : null,
    links.coinmarketcap ? { label: 'CoinMarketCap', url: links.coinmarketcap, icon: <CGIcon /> } : null,
  ].filter(Boolean)

  return (
    <div className={`rz-dos ${dayMode ? 'rz-dos--day' : ''}`}>
      <div className="rz-dos-head">
        <div className="rz-dos-titles">
          <span className="rz-dos-name">{facts.name || name || sym}</span>
          <span className="rz-dos-sym mono">${facts.symbol}</span>
        </div>
        <div className="rz-dos-tags">
          {stage && <span className={`rz-dos-badge rz-dos-badge--${stage.cls}`}>{stage.label}</span>}
          {((read?.tags?.length ? read.tags : facts.categories) || []).slice(0, 3).map((t) => (
            <span className="rz-dos-chip" key={t}>{t}</span>
          ))}
        </div>
      </div>

      {oneLiner && <p className="rz-dos-oneliner">{oneLiner}</p>}
      {body && <p className="rz-dos-body">{boldenNumbers(body)}</p>}

      {(read?.sector_read || read?.utility_read || read?.narrative_read) && (
        <div className="rz-dos-reads">
          {read.sector_read && (
            <div className="rz-dos-read">
              <span className="rz-dos-read-label">Sector &amp; Positioning</span>
              <p>{boldenNumbers(read.sector_read)}</p>
            </div>
          )}
          {read.utility_read && (
            <div className="rz-dos-read rz-dos-read--utility">
              <span className="rz-dos-read-label">{t('researchPro.projectDossier.rzprojectdossier.tangibleUtility', "Tangible Utility")}</span>
              <p>{boldenNumbers(read.utility_read)}</p>
            </div>
          )}
          {read.narrative_read && (
            <div className="rz-dos-read">
              <span className="rz-dos-read-label">Narrative &amp; Meta</span>
              <p>{boldenNumbers(read.narrative_read)}</p>
            </div>
          )}
        </div>
      )}

      {read?.investor_take && (
        <div className="rz-dos-take">
          <span className="rz-dos-take-label">{t('researchPro.projectDossier.rzprojectdossier.investorTake', "Investor Take")}</span>
          <p>{boldenNumbers(read.investor_take)}</p>
        </div>
      )}

      {read?.red_flags?.length > 0 && (
        <div className="rz-dos-flags">
          <span className="rz-dos-flags-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            {t('researchPro.projectDossier.rzprojectdossier.redFlags', "Red Flags")}
          </span>
          <div className="rz-dos-flags-chips">
            {read.red_flags.map((f) => <span className="rz-dos-flag" key={f}>{f}</span>)}
          </div>
        </div>
      )}

      {factCells.length > 0 && (
        <div className="rz-dos-facts">
          {factCells.map((c) => (
            <div className="rz-dos-fact" key={c.k}>
              <span className="rz-dos-fact-label">{c.k}</span>
              <span className={`rz-dos-fact-val ${c.mono ? 'mono' : ''}`}>{c.v}</span>
            </div>
          ))}
        </div>
      )}

      {read?.comparable_to?.length > 0 && (
        <div className="rz-dos-compare">
          <span className="rz-dos-compare-label">{t('researchPro.projectDossier.rzprojectdossier.inTheVeinOf', "In the vein of")}</span>
          {read.comparable_to.map((c) => <span className="rz-dos-chip rz-dos-chip--compare" key={c}>{c}</span>)}
        </div>
      )}

      <div className="rz-dos-foot">
        {sourceChips.length > 0 && (
          <div className="rz-dos-sources">
            {sourceChips.map((s) => (
              <a key={s.label} href={s.url} target="_blank" rel="noopener noreferrer" className="rz-dos-source" title={s.label}>
                {s.icon}<span>{s.label}</span>
              </a>
            ))}
          </div>
        )}
        <div className="rz-dos-meta">
          <span>{read ? 'Spectre dossier' : 'Dossier generating'}</span>
          {generatedAgo && <span>· {generatedAgo}</span>}
          <button type="button" onClick={refetch} className="rz-dos-refresh">{t('researchPro.projectDossier.rzprojectdossier.refresh', "Refresh")}</button>
        </div>
      </div>
    </div>
  )
})

export default RzProjectDossier
