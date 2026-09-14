/**
 * KOL Endorsement Bubbles — a packed-bubble field of the KOL's endorsements.
 *
 * Each project is a circle: radius scaled by `weight` (how hard the KOL pushed
 * it), fill + ring colored by `health.tone` (green = alive, amber = cooling,
 * red = dead/rug, grey = unknown). The project logo sits centered (falls back
 * to $SYMBOL text). Hover surfaces a tooltip "$SYM · 7d ±x% · <state>"; click
 * opens the project (onOpenProject(cg_id)).
 *
 * Layout is deterministic: a flex-wrap of pre-sized bubbles (largest weight
 * first, so the field reads top-left → down). No layout library, no physics —
 * cheap, responsive, and stable across renders. Bubbles stagger-scale in.
 *
 * This is the ONE KOL Radar surface where bull/bear color accents are correct:
 * project health is genuinely up/down, so --bull / --bear / --amber carry it.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/* tone → modifier class. Unknown / missing health reads as muted grey. */
const TONE_CLASS = {
  green: 'keb-bubble--green',
  amber: 'keb-bubble--amber',
  red: 'keb-bubble--red',
  grey: 'keb-bubble--grey',
}

/* state → short human label for the tooltip. */
const STATE_LABEL = {
  alive: { key: 'kolRadar.health.alive', fallback: 'alive' },
  cooling: { key: 'kolRadar.health.cooling', fallback: 'cooling' },
  dead: { key: 'kolRadar.health.dead', fallback: 'dead' },
  unknown: { key: 'kolRadar.health.unknown', fallback: 'no data' },
}

/* Map a 0..1-ish weight to a pixel diameter. Endorsements carry weight in a
   loose range; clamp so the field stays scannable (small caps don't vanish,
   heavyweights don't swallow the row). */
function bubbleSize(weight) {
  const w = Number(weight)
  const safe = Number.isFinite(w) && w > 0 ? w : 0.4
  // weight is typically 0..1.5; lerp into a 46..92px diameter band.
  const clamped = Math.max(0.2, Math.min(1.6, safe))
  return Math.round(46 + (clamped / 1.6) * 46)
}

function fmtChange(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

function Bubble({ endorsement, index, onOpenProject, t }) {
  const health = endorsement.health || {}
  const tone = TONE_CLASS[health.tone] || TONE_CLASS.grey
  const size = bubbleSize(endorsement.weight)
  const sym = endorsement.symbol ? `$${String(endorsement.symbol).toUpperCase()}` : (endorsement.name || '?')
  const logo = endorsement.image || endorsement.image_small || endorsement.image_url
  const cgId = endorsement.cg_id

  const change = fmtChange(health.change7d)
  const stateMeta = STATE_LABEL[health.state] || STATE_LABEL.unknown
  const stateLabel = t(stateMeta.key, stateMeta.fallback)
  const tip = [sym, change ? t('kolRadar.bubbles.tip7d', '7d {{change}}', { change }) : null, stateLabel]
    .filter(Boolean)
    .join(' · ')

  // logo font scales with bubble so the fallback symbol fits.
  const labelSize = Math.max(9, Math.round(size * 0.18))

  return (
    <button
      type="button"
      className={`keb-bubble ${tone}`}
      style={{
        width: size,
        height: size,
        animationDelay: `${Math.min(index * 28, 420)}ms`,
      }}
      onClick={() => cgId && onOpenProject && onOpenProject(cgId)}
      disabled={!cgId}
      title={tip}
      aria-label={tip}
    >
      <span className="keb-bubble__inner">
        {logo ? (
          <img
            className="keb-bubble__logo"
            src={logo}
            alt=""
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <span className="keb-bubble__sym" style={{ fontSize: labelSize }}>{sym}</span>
        )}
      </span>
    </button>
  )
}

export default function KolEndorsementBubbles({ endorsements, onOpenProject }) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)

  const list = (Array.isArray(endorsements) ? endorsements : [])
    .filter((e) => e && (e.symbol || e.name))

  if (list.length === 0) {
    return (
      <p className="keb-empty">
        {t('kolRadar.bubbles.empty', 'No tracked endorsements for this KOL yet.')}
      </p>
    )
  }

  // Heaviest pushes first so the field reads largest → smallest.
  const sorted = [...list].sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
  const CAP = 24
  const shown = showAll ? sorted : sorted.slice(0, CAP)
  const hidden = sorted.length - shown.length

  return (
    <div className="keb">
      <div className="keb-field">
        {shown.map((e, i) => (
          <Bubble
            key={e.cg_id || e.symbol || i}
            endorsement={e}
            index={i}
            onOpenProject={onOpenProject}
            t={t}
          />
        ))}
      </div>

      <div className="keb-foot">
        <div className="keb-legend" aria-hidden="true">
          <span className="keb-legend__item"><span className="keb-legend__dot keb-legend__dot--green" />{t('kolRadar.health.alive', 'alive')}</span>
          <span className="keb-legend__item"><span className="keb-legend__dot keb-legend__dot--amber" />{t('kolRadar.health.cooling', 'cooling')}</span>
          <span className="keb-legend__item"><span className="keb-legend__dot keb-legend__dot--red" />{t('kolRadar.health.dead', 'dead')}</span>
        </div>
        {hidden > 0 && !showAll && (
          <button type="button" className="keb-more" onClick={() => setShowAll(true)}>
            {t('kolRadar.bubbles.more', '+{{count}} more', { count: hidden })}
          </button>
        )}
      </div>
    </div>
  )
}
