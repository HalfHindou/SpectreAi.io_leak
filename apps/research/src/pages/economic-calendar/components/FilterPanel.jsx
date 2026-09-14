/**
 * FilterPanel — Dropdown filter menu rendered via portal.
 * Positioned below the filter button using a ref for anchor coordinates.
 * Compact floating panel with multi-select pill toggles.
 */

import React, { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import './FilterPanel.css'

const buildFilterSections = (t) => [
  {
    hookKey: 'impact',
    label: t('economicCalendar.filterImpactLevel', 'IMPACT LEVEL'),
    options: [
      { display: t('economicCalendar.impactLow', 'Low'), value: 'low' },
      { display: t('economicCalendar.impactMedium', 'Medium'), value: 'medium' },
      { display: t('economicCalendar.impactHigh', 'High'), value: 'high' },
      { display: t('economicCalendar.impactCritical', 'Critical'), value: 'critical' },
    ],
  },
  {
    hookKey: 'currency',
    label: t('economicCalendar.filterCurrencyRegion', 'CURRENCY / REGION'),
    options: [
      { display: 'USD', value: 'USD' },
      { display: 'EUR', value: 'EUR' },
      { display: 'GBP', value: 'GBP' },
      { display: 'JPY', value: 'JPY' },
      { display: 'CNY', value: 'CNY' },
      { display: 'AUD', value: 'AUD' },
      { display: 'CAD', value: 'CAD' },
      { display: 'CHF', value: 'CHF' },
    ],
  },
  {
    hookKey: 'category',
    label: t('economicCalendar.filterCategory', 'CATEGORY'),
    // One pill per value the API can emit (ALL_CATEGORIES). A category with no
    // pill is a category the user can never switch back on — the 'Speeches'
    // pill used to sit here matching nothing while Energy/Other events were
    // dropped invisibly.
    options: [
      { display: t('economicCalendar.catInterestRate', 'Interest Rate'), value: 'Interest Rate' },
      { display: t('economicCalendar.catInflation', 'Inflation'), value: 'Inflation' },
      { display: t('economicCalendar.catEmployment', 'Employment'), value: 'Employment' },
      { display: 'GDP', value: 'GDP' },
      { display: t('economicCalendar.catHousing', 'Housing'), value: 'Housing' },
      { display: t('economicCalendar.catManufacturing', 'Manufacturing'), value: 'Manufacturing' },
      { display: t('economicCalendar.catConsumer', 'Consumer'), value: 'Consumer' },
      { display: t('economicCalendar.catTrade', 'Trade'), value: 'Trade' },
      { display: t('economicCalendar.catEnergy', 'Energy'), value: 'Energy' },
      { display: t('economicCalendar.catSpeeches', 'Speeches'), value: 'Speeches' },
      { display: t('economicCalendar.catCrypto', 'Crypto'), value: 'Crypto' },
      { display: t('economicCalendar.catGovernance', 'Governance'), value: 'Governance' },
      { display: t('economicCalendar.catEarnings', 'Earnings'), value: 'Earnings' },
      { display: t('economicCalendar.catOther', 'Other'), value: 'Other' },
    ],
  },
]

const FilterPanel = ({ filters, onToggle, onReset, onClose, anchorRef }) => {
  const { t } = useTranslation()
  const FILTER_SECTIONS = buildFilterSections(t)
  const panelRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })

  // Position below the anchor button
  useLayoutEffect(() => {
    if (!anchorRef?.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    })
  }, [anchorRef])

  // Click outside to close
  useEffect(() => {
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        if (anchorRef?.current?.contains(e.target)) return
        onClose()
      }
    }
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose, anchorRef])

  const isActive = (hookKey, value) => {
    const set = filters[`${hookKey}Filters`]
    if (!set) return false
    return set.has(value)
  }

  const totalActive = FILTER_SECTIONS.reduce((acc, section) => {
    const set = filters[`${section.hookKey}Filters`]
    if (!set) return acc
    return acc + (section.options.length - set.size)
  }, 0)

  const dropdown = (
    <>
      <div className="filter-dropdown__backdrop" onClick={onClose} />
      <div
        className="filter-dropdown"
        ref={panelRef}
        style={{ top: pos.top, right: pos.right }}
      >
        <div className="filter-dropdown__top">
          <span className="filter-dropdown__heading">{t('economicCalendar.filters', 'Filters')}</span>
          {totalActive > 0 && (
            <button className="filter-dropdown__reset" onClick={onReset}>
              {t('economicCalendar.reset', 'Reset')}
            </button>
          )}
        </div>

        <div className="filter-dropdown__sections">
          {FILTER_SECTIONS.map((section) => (
            <div key={section.hookKey} className="filter-dropdown__section">
              <span className="filter-dropdown__label">{section.label}</span>
              <div className="filter-dropdown__pills">
                {section.options.map((opt) => (
                  <button
                    key={opt.value}
                    className={`filter-dropdown__pill${isActive(section.hookKey, opt.value) ? ' filter-dropdown__pill--active' : ''}`}
                    onClick={() => onToggle(section.hookKey, opt.value)}
                  >
                    {opt.display}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )

  return createPortal(dropdown, document.body)
}

export default FilterPanel
