/**
 * useFilters Hook
 * Manages calendar filter state with localStorage persistence.
 * Supports impact, currency, category filters + low-impact toggle.
 */

import { useState, useCallback, useEffect, useMemo } from 'react'

// v2 (2026-08-24): the category list is now the CLOSED set the API's
// categorizeEvent() can emit. Before this, the API produced 'Other' and
// 'Energy' — which this list never contained — so `applyFilters` dropped every
// one of those events with no pill to switch them back on. In the week of
// Aug 24 that silently deleted 30 of 77 events, Jackson Hole and the Fed
// Chair's keynote among them. The reverse hole existed too: 'Speeches' was
// listed here but the API never emitted it, and 'Crypto' matched nothing
// because crypto rows arrived title-cased as 'Governance' / 'Unlock'.
// Bumping the storage key migrates users off the truncated stored set.
const STORAGE_KEY = 'spectre:calendar-filters:v2'
const LEGACY_STORAGE_KEY = 'spectre:calendar-filters'

const DEFAULT_IMPACT = ['low', 'medium', 'high', 'critical']
const DEFAULT_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF']

// Every value apps/research/api/_lib/handlers/calendar-api.js can emit.
export const ALL_CATEGORIES = [
  'Interest Rate',
  'Inflation',
  'Employment',
  'GDP',
  'Housing',
  'Manufacturing',
  'Consumer',
  'Trade',
  'Energy',
  'Speeches',
  'Crypto',
  'Governance',
  'Earnings',
  'Other',
]

// Governance is the one category off by default: Snapshot carries ~85 DAO
// votes a month ("Should @X be banned from the forum") and they bury the
// releases this page exists for. Every other category ships on, so nothing
// disappears without the user having asked for it.
const DEFAULT_CATEGORIES = ALL_CATEGORIES.filter((c) => c !== 'Governance')

function getDefaults() {
  return {
    impactFilters: new Set(DEFAULT_IMPACT),
    currencyFilters: new Set(DEFAULT_CURRENCIES),
    categoryFilters: new Set(DEFAULT_CATEGORIES),
    showLowImpact: false,
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // Migrate a v1 set: keep the user's impact/currency choices, but rebuild
      // categories from the current defaults. A stored v1 category array can
      // only be the old 11-value list (or a subset of it), and replaying it
      // would re-hide Speeches/Energy/Other forever.
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (!legacy) return null
      const old = JSON.parse(legacy)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      return {
        impactFilters: new Set(old.impactFilters || DEFAULT_IMPACT),
        currencyFilters: new Set(old.currencyFilters || DEFAULT_CURRENCIES),
        categoryFilters: new Set(DEFAULT_CATEGORIES),
        showLowImpact: Boolean(old.showLowImpact),
      }
    }
    const parsed = JSON.parse(raw)
    return {
      impactFilters: new Set(parsed.impactFilters || DEFAULT_IMPACT),
      currencyFilters: new Set(parsed.currencyFilters || DEFAULT_CURRENCIES),
      categoryFilters: new Set(parsed.categoryFilters || DEFAULT_CATEGORIES),
      showLowImpact: Boolean(parsed.showLowImpact),
    }
  } catch {
    return null
  }
}

function saveToStorage(state) {
  try {
    const serializable = {
      impactFilters: Array.from(state.impactFilters),
      currencyFilters: Array.from(state.currencyFilters),
      categoryFilters: Array.from(state.categoryFilters),
      showLowImpact: state.showLowImpact,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable))
  } catch {
    // Silently fail on storage errors
  }
}

export default function useFilters() {
  const [filters, setFilters] = useState(() => loadFromStorage() || getDefaults())

  // Persist on every change
  useEffect(() => {
    saveToStorage(filters)
  }, [filters])

  const toggleFilter = useCallback((type, value) => {
    setFilters((prev) => {
      const key = `${type}Filters`
      const current = prev[key]
      if (!current) return prev

      const next = new Set(current)
      if (next.has(value)) {
        next.delete(value)
      } else {
        next.add(value)
      }

      return { ...prev, [key]: next }
    })
  }, [])

  const toggleShowLowImpact = useCallback(() => {
    setFilters((prev) => ({ ...prev, showLowImpact: !prev.showLowImpact }))
  }, [])

  const resetFilters = useCallback(() => {
    const defaults = getDefaults()
    setFilters(defaults)
  }, [])

  const applyFilters = useCallback(
    (events) => {
      if (!Array.isArray(events)) return []

      return events.filter((event) => {
        // Impact filter
        if (!filters.showLowImpact && event.impact === 'low') return false
        if (!filters.impactFilters.has(event.impact)) return false

        // Currency filter
        if (event.currency && !filters.currencyFilters.has(event.currency)) return false

        // Category filter — FAILS OPEN. A category this build doesn't know
        // about (new API value, an older cached payload) must still render:
        // failing closed on an unknown value is precisely what deleted
        // Jackson Hole, the Fed Chair keynote and 28 other events from the
        // week of 2026-08-24 with no pill to bring them back.
        if (
          event.category &&
          ALL_CATEGORIES.includes(event.category) &&
          !filters.categoryFilters.has(event.category)
        ) return false

        return true
      })
    },
    [filters]
  )

  // Whether anything differs from the shipped defaults — drives the "filters
  // are on" dot. Callers used to hardcode the option counts (`size < 11`),
  // which silently lies the moment a category is added or removed.
  const isModified = useMemo(() => {
    const d = getDefaults()
    const sameSet = (a, b) => a.size === b.size && [...a].every((v) => b.has(v))
    return (
      !sameSet(filters.impactFilters, d.impactFilters) ||
      !sameSet(filters.currencyFilters, d.currencyFilters) ||
      !sameSet(filters.categoryFilters, d.categoryFilters) ||
      filters.showLowImpact !== d.showLowImpact
    )
  }, [filters])

  return useMemo(
    () => ({
      ...filters,
      isModified,
      toggleFilter,
      toggleShowLowImpact,
      resetFilters,
      applyFilters,
    }),
    [filters, isModified, toggleFilter, toggleShowLowImpact, resetFilters, applyFilters]
  )
}
