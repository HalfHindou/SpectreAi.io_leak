/**
 * NewsCategoryTabs — premium horizontal pill bar with SVG icons
 * Matching Apple Cinematic Design System — no emojis
 */

/* ── SVG Icon Components ── */

function IconAll({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function IconTech({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
    </svg>
  )
}

function IconAI({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" /><path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z" /><circle cx="12" cy="6" r="1" fill="currentColor" />
    </svg>
  )
}

function IconScience({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6v6l4 8H5l4-8V3z" /><path d="M10 3h4" />
    </svg>
  )
}

function IconBusiness({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><path d="M12 12h.01" />
    </svg>
  )
}

function IconFinance({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" />
    </svg>
  )
}

function IconWorld({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function IconMacro({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" /><path d="M4 21V10" /><path d="M20 21V10" /><path d="M8 21v-7" /><path d="M12 21v-7" /><path d="M16 21v-7" /><path d="M2 10l10-6 10 6" />
    </svg>
  )
}

function IconCrypto({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042.348-1.97M7.48 15.93l3.94.694m0 0-.346 1.965m.346-1.965-3.94-.694" />
    </svg>
  )
}

function IconTokenized({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /><circle cx="16" cy="15" r="2" />
    </svg>
  )
}

function IconRWA({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /><path d="M9 9h.01" /><path d="M15 9h.01" /><path d="M9 13h.01" /><path d="M15 13h.01" />
    </svg>
  )
}

const ICON_MAP = {
  all: IconAll,
  tech: IconTech,
  ai: IconAI,
  science: IconScience,
  business: IconBusiness,
  finance: IconFinance,
  world: IconWorld,
  macro: IconMacro,
  crypto: IconCrypto,
  'tokenized-assets': IconTokenized,
  rwa: IconRWA,
}

import { useTranslation } from 'react-i18next'

const CATEGORIES = [
  { key: 'all',               labelKey: 'all',                labelFallback: 'All',               color: '#8B5CF6' },
  { key: 'tech',              labelKey: 'tech',               labelFallback: 'Tech',              color: '#3B82F6' },
  { key: 'ai',                labelKey: 'ai',                 labelFallback: 'AI',                color: '#8B5CF6' },
  { key: 'science',           labelKey: 'science',            labelFallback: 'Science',           color: '#10B981' },
  { key: 'business',          labelKey: 'business',           labelFallback: 'Business',          color: '#F59E0B' },
  { key: 'finance',           labelKey: 'finance',            labelFallback: 'Finance',           color: '#22C55E' },
  { key: 'world',             labelKey: 'world',              labelFallback: 'World',             color: '#EF4444' },
  { key: 'crypto',            labelKey: 'crypto',             labelFallback: 'Crypto',            color: '#F7931A' },
  { key: 'tokenized-assets',  labelKey: 'tokenizedAssets',    labelFallback: 'Tokenized Assets',  color: '#14B8A6' },
  { key: 'rwa',               labelKey: 'rwa',                labelFallback: 'RWA',               color: '#0EA5E9' },
  // Spectre's own desk sits apart from the generic categories: last slot,
  // teal identity (sn-tabs__pill--macro).
  { key: 'macro',             labelKey: 'macro',              labelFallback: 'Macro Wire',        color: '#2DD4BF' },
]

export default function NewsCategoryTabs({ active, onChange }) {
  const { t } = useTranslation()
  return (
    <nav className="sn-tabs" aria-label={t('newsPage.categoriesLabel', 'News categories')}>
      <div className="sn-tabs__track">
        {CATEGORIES.map(cat => {
          const isActive = active === cat.key
          const Icon = ICON_MAP[cat.key]
          return (
            <button
              key={cat.key}
              type="button"
              className={`sn-tabs__pill${cat.key === 'macro' ? ' sn-tabs__pill--macro' : ''}${isActive ? ' sn-tabs__pill--active' : ''}`}
              onClick={() => onChange(cat.key)}
              aria-pressed={isActive}
            >
              <span className="sn-tabs__icon">
                {Icon && <Icon size={15} />}
              </span>
              <span className="sn-tabs__label">{t(`newsPage.categories.${cat.labelKey}`, cat.labelFallback)}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
