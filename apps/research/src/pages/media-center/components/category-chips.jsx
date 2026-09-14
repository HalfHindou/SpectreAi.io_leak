/**
 * CategoryChips — filter rail for the Discover feed.
 * Controlled: `active` is a category label or 'all'.
 */
import { useTranslation } from 'react-i18next'

const CategoryChips = ({ categories = [], active = 'all', onChange }) => {
  const { t } = useTranslation()
  if (!categories.length) return null

  return (
    <div className="mcx-chips" role="tablist" aria-label={t('mediaCenter.categoriesAria', 'Categories')}>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'all'}
        className={`mcx-chip${active === 'all' ? ' is-active' : ''}`}
        onClick={() => onChange?.('all')}
      >
        {t('mediaCenter.categories.all')}
      </button>
      {categories.map(cat => (
        <button
          key={cat}
          type="button"
          role="tab"
          aria-selected={active === cat}
          className={`mcx-chip${active === cat ? ' is-active' : ''}`}
          data-cat={cat}
          onClick={() => onChange?.(cat)}
        >
          <span className="mcx-chip-dot" aria-hidden="true" />
          {cat}
        </button>
      ))}
    </div>
  )
}

export default CategoryChips
