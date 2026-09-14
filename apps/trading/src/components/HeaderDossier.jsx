/**
 * HeaderDossier — Iteration 3 §5. The AI Dossier moves out of the
 * right-rail Intelligence Card and into the centre token header.
 *
 * What's removed from the old card: the NeedleGauge, score chips,
 * strength/risk callouts, "● LIVE" badge, "Updated 2m ago" stamp.
 *
 * What's left here: the AI narrative itself, displayed editorially.
 *   • "AI DOSSIER" eyebrow in --accent with a small mark
 *   • Lead sentence in --text-1, larger and brighter
 *   • Streaming reveal (latched per token, reduced-motion bypassed)
 *   • Entity highlights inline in --accent on the symbol, chain name,
 *     and numeric tokens
 *   • Faint accent-wash bloom behind the text
 *   • "Read full analysis ⌄" expander when body > 240 chars
 *
 * Source: useDossier(token).data?.lore?.communityNarrative — same
 * payload the right-rail card consumed; only the rendering changes.
 */

import React, { useMemo, useState } from 'react'
import useDossier from '../hooks/useDossier'
import useStreamingText from '../hooks/useStreamingText'
import { firstSentence, highlightEntities } from '../lib/textUtils'
import { getNetworkName } from '../services/codexApi'
import './HeaderDossier.css'

/**
 * `actions` is an optional toolbar slot (the banner's social/alert/share
 * rail). It renders at the right end of the dossier's label line in both
 * states, and it is rendered even when there is no prose - the rail must
 * never disappear with the text.
 */
function HeaderDossier({ token, actions = null }) {
  const { data } = useDossier(token)
  const narrative = data?.lore?.communityNarrative
  const fallbackBio = data?.socials?.twitterBio
  const projectDescription = data?.lore?.projectDescription
  // Show the project description first ("what this token is") so users understand
  // the project, not the market/flow commentary. X bio + community narrative are
  // last-resort fallbacks. The token's own Codex description is the final
  // fallback so a token the dossier service hasn't indexed (e.g. newer chains
  // like Robinhood) still shows *something* instead of a blank header.
  const rawProse = projectDescription || fallbackBio || narrative || token?.description || ''

  const [expanded, setExpanded] = useState(false)

  // OL Iteration 3 compact header: collapsed shows ONE lead sentence,
  // JS-truncated (not CSS line-clamp) so the "Read full analysis" link can
  // tuck inline right at the "…" cut point instead of costing its own line.
  // Full narrative reveals on expand.
  const leadFull = useMemo(() => firstSentence(rawProse), [rawProse])
  const LEAD_MAX = 180
  const leadTrunc = useMemo(() => {
    if (leadFull.length <= LEAD_MAX) return leadFull
    const cut = leadFull.slice(0, LEAD_MAX)
    const sp = cut.lastIndexOf(' ')
    return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + '…'
  }, [leadFull])
  const hasMore = leadFull.length > LEAD_MAX || rawProse.length > leadFull.length + 10

  const latchKey = token?.address
    ? `${token.networkId || ''}:${token.address.toLowerCase()}`
    : null
  const { display: leadStreamed, isStreaming } = useStreamingText(leadTrunc, {
    speedCps: 80,
    latchKey,
    enabled: !!leadTrunc,
  })

  const chainName = getNetworkName(token?.networkId)
  const tokenSymbol = token?.symbol

  // Apply entity highlights only AFTER streaming finishes — during
  // streaming the partial string can't be safely matched without
  // breaking word boundaries.
  const leadRendered = useMemo(() => {
    if (isStreaming) return leadStreamed
    return highlightEntities(leadStreamed, { tokenSymbol, chainName })
  }, [leadStreamed, isStreaming, tokenSymbol, chainName])

  // Expanded view: the FULL prose split into logical paragraphs (by sentence,
  // tiny trailing fragments merged into the previous one) so it reads as
  // organized body copy instead of one wall of text. Each paragraph keeps the
  // engraved-gradient "cover" effect via .hd-lead-inner (consistent with the
  // collapsed teaser), not flat plain text.
  const fullParagraphs = useMemo(() => {
    const parts = (rawProse.match(/[^.!?]+[.!?]+["')\]]?\s*/g) || [rawProse])
      .map((s) => s.trim())
      .filter(Boolean)
    const grouped = []
    let buf = ''
    for (const s of parts) {
      buf = buf ? `${buf} ${s}` : s
      if (buf.length >= 150) { grouped.push(buf); buf = '' }
    }
    if (buf) {
      if (grouped.length && buf.length < 70) grouped[grouped.length - 1] += ` ${buf}`
      else grouped.push(buf)
    }
    const final = grouped.length ? grouped : [rawProse]
    return final.map((p) => highlightEntities(p, { tokenSymbol, chainName }))
  }, [rawProse, tokenSymbol, chainName])

  if (!token?.address) return null

  // The rail is a SIBLING of the dossier well, on its left, so the well can
  // be its own recessed surface (the banner row is the flex line).
  const actionsSlot = actions ? <div className="hd-actions">{actions}</div> : null

  // No dossier prose: the rail alone.
  if (!rawProse) return actionsSlot

  const glyph = (
    <span className="hd-glyph" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <path d="M8 2 L13 5 L13 11 L8 14 L3 11 L3 5 Z" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <circle cx="8" cy="8" r="2" fill="currentColor" />
      </svg>
    </span>
  )

  return (
    <>
      {actionsSlot}
      {/* The well: a recessed reading surface one step below the banner
          panel (the header's search-field grammar). Collapsed it is a
          30px strip - label, one ellipsized line, "Read more" key at the
          end; expanded it holds the label line and the paragraphs. */}
      <section className={`hd ${!expanded ? 'hd--teaser' : ''}`} aria-label="AI Dossier">
        <span className="hd-bloom" aria-hidden="true" />
        <span className="hd-scanline" aria-hidden="true" />

      {!expanded ? (
        <div className="hd-row">
          <header className="hd-head hd-head--inline">
            {glyph}
            <span className="hd-eyebrow">AI Dossier</span>
          </header>
          <p className={['hd-lead', 'hd-lead--row', isStreaming && 'hd-lead--streaming'].filter(Boolean).join(' ')}>
            <span className="hd-lead-inner">
              {leadRendered}
              {isStreaming && <span className="hd-caret" aria-hidden="true" />}
            </span>
          </p>
          {hasMore && !isStreaming && (
            <button
              type="button"
              className="hd-expander hd-expander--row"
              onClick={() => setExpanded(true)}
            >
              Read more
            </button>
          )}
        </div>
      ) : (
        <>
          <header className="hd-head hd-head--bar">
            {glyph}
            <span className="hd-eyebrow">AI Dossier</span>
          </header>
          <div className="hd-text">
            {fullParagraphs.map((para, i) => (
              i === 0 ? (
                // The lead reads one tone brighter than the rest.
                <p key={i} className="hd-lead hd-para">
                  <span className="hd-lead-inner">{para}</span>
                </p>
              ) : (
                <p key={i} className="hd-rest hd-para">{para}</p>
              )
            ))}
            <button
              type="button"
              className="hd-expander"
              onClick={() => setExpanded(false)}
            >
              Show less
            </button>
          </div>
        </>
      )}
      </section>
    </>
  )
}

export default React.memo(HeaderDossier)
