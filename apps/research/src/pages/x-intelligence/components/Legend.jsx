/**
 * Legend — Bottom-left compact glass panel showing graph symbology.
 *
 * The graph encodes AUTHENTICITY in colour (size still = influence):
 *   • Project hubs are coloured on an organic→noisy authenticity scale.
 *   • KOL nodes are coloured by author class (Official / Commentator /
 *     Promoter / Media); promoters also get a distinct dashed ring so a
 *     cluster of paid amplifiers reads as a red flag.
 */
import {
  AUTHENTICITY_COLORS,
  AUTHOR_CLASS_COLORS,
  AUTHOR_CLASS_LABELS,
} from '../data/zigchainGraph'

const AUTHOR_CLASS_KEYS = ['official', 'commentator', 'promoter', 'media']

export default function Legend({ dayMode, filterCollapsed = false }) {
  return (
    <div className={`xi-legend xi-glass${filterCollapsed ? ' xi-legend--filter-collapsed' : ''}`}>
      <div className="xi-legend__title">Authenticity</div>

      {/* Project authenticity scale: organic → noisy */}
      <div className="xi-legend__row xi-legend__row--scale">
        <span
          className="xi-legend__scale"
          style={{
            background: `linear-gradient(90deg, ${AUTHENTICITY_COLORS.organic} 0%, ${AUTHENTICITY_COLORS.mixed} 50%, ${AUTHENTICITY_COLORS.noisy} 100%)`,
          }}
        />
      </div>
      <div className="xi-legend__row xi-legend__scale-labels">
        <span className="xi-legend__item">Organic</span>
        <span className="xi-legend__item">Noisy</span>
      </div>

      <div className="xi-legend__title xi-legend__title--sub">Voices</div>

      {/* Author-class swatches */}
      <div className="xi-legend__row xi-legend__row--wrap">
        {AUTHOR_CLASS_KEYS.map((key) => (
          <span key={key} className="xi-legend__item">
            <span
              className={`xi-legend__dot${key === 'promoter' ? ' xi-legend__dot--promoter' : ''}`}
              style={{ background: AUTHOR_CLASS_COLORS[key] }}
            />
            {AUTHOR_CLASS_LABELS[key]}
          </span>
        ))}
      </div>

      <div className="xi-legend__note">Size = influence</div>
    </div>
  )
}
