/**
 * CategoryFilter - Horizontal category pills with colored squares.
 * Props: active (string), onChange (fn)
 */
import { useTranslation } from 'react-i18next'
import '../Intelligence.css'

const CATEGORY_KEYS = [
  { key: 'all',        i18nKey: 'categoryAll',        fallback: 'All',        color: '#8B5CF6' },
  { key: 'spectre',    i18nKey: 'categorySpectre',    fallback: 'Spectre AI', color: '#00E5A0' },
  { key: 'bitcoin',    i18nKey: 'categoryBitcoin',    fallback: 'Bitcoin',    color: '#F7931A' },
  { key: 'ethereum',   i18nKey: 'categoryEthereum',   fallback: 'Ethereum',   color: '#627EEA' },
  { key: 'defi',       i18nKey: 'categoryDefi',       fallback: 'DeFi',       color: '#10B981' },
  { key: 'stocks',     i18nKey: 'categoryStocks',     fallback: 'Stocks',     color: '#3B82F6' },
  { key: 'macro',      i18nKey: 'categoryMacro',      fallback: 'Macro',      color: '#F59E0B' },
  { key: 'regulation', i18nKey: 'categoryRegulation', fallback: 'Regulation', color: '#EF4444' },
  { key: 'ai',         i18nKey: 'categoryAi',         fallback: 'AI',         color: '#A855F7' },
]

export default function CategoryFilter({ active = 'all', onChange }) {
  const { t } = useTranslation()
  const CATEGORIES = CATEGORY_KEYS.map(c => ({ ...c, label: t(`intelligencePage.${c.i18nKey}`, c.fallback) }))
  return (
    <nav className="st-categories" aria-label={t('intelligencePage.filterByCategory', 'Filter by category')}>
      {CATEGORIES.map(cat => {
        const isActive = active === cat.key
        return (
          <button
            key={cat.key}
            className={`st-category-pill${isActive ? ' st-category-pill--active' : ''}`}
            onClick={() => onChange?.(cat.key)}
            aria-pressed={isActive}
          >
            <span
              className="st-category-pill__square"
              style={{ background: cat.color }}
              aria-hidden="true"
            />
            {cat.label}
          </button>
        )
      })}
    </nav>
  )
}
